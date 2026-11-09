import { getContents, putContents, getOrgMembership, setOrgMembership, GitHubApiError } from '../github-api.js';
import { setActiveCourse, addRecentCourse } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv, rosterToCsv, mergeRoster, validateStudent } from '../roster.js';

const ROSTER_PATH = 'students/roster.csv';

export async function renderRoster(container, { org, repo }, headerEl) {
  container.innerHTML = '<p>Loading roster…</p>';

  let configFile;
  try {
    configFile = await getContents(org, repo, 'config/course.json');
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load course: ${escapeHtml(err.message)}</p>`;
    return;
  }
  if (!configFile) {
    container.innerHTML =
      '<p class="error">config/course.json not found. Make sure the repository exists, you have access to it, and it was created from the course template.</p>';
    return;
  }

  const config = JSON.parse(configFile.content);
  if (!config.sessionId) {
    // Unconfigured repo — send them to Course Home, which owns the
    // one-time configure form.
    location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    return;
  }

  setActiveCourse({ org, repo, sessionId: config.sessionId });
  addRecentCourse({ org, repo, sessionId: config.sessionId });
  if (headerEl) renderHeader(headerEl, { org, repo, sessionId: config.sessionId });

  let rosterFile;
  try {
    rosterFile = await getContents(org, repo, ROSTER_PATH);
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load roster: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const { students, errors: parseErrors } = parseRosterCsv(rosterFile ? rosterFile.content : '');
  if (parseErrors.length) {
    container.innerHTML = `<p class="error">${escapeHtml(parseErrors[0])}</p>`;
    return;
  }

  // Mutable module-local state for this render of the view.
  let sha = rosterFile ? rosterFile.sha : undefined;
  let workingRows = students.map((s) => ({
    ...s,
    _status: 'unchanged',
    _original: { studentId: s.studentId, name: s.name, handle: s.handle },
    _orgStatus: null,
  }));

  renderCard();
  refreshOrgStatuses();

  // Checks each already-loaded student's live GitHub org membership so the
  // roster reflects reality (registered/pending/never-invited) as soon as
  // it opens, instead of only after an explicit Register click. Read-only
  // (getOrgMembership, never setOrgMembership) — opening the roster must
  // never itself send an invite. Runs against the snapshot of rows present
  // when the roster loaded; students added afterward (Add student/Import)
  // aren't included since they weren't there yet. Updates each row's badge
  // in place as its check resolves, rather than re-rendering the whole
  // table, so it doesn't clobber an edit in progress elsewhere in the grid.
  async function refreshOrgStatuses() {
    const toCheck = workingRows.filter((r) => r._status !== 'removed' && r.handle.trim());
    for (const row of toCheck) {
      try {
        const membership = await getOrgMembership(org, row.handle.trim());
        row._orgStatus = membership ? membership.state : null;
      } catch {
        row._orgStatus = 'error';
      }
      updateOrgStatusCell(row.studentId);
    }
  }

  function updateOrgStatusCell(studentId) {
    const row = workingRows.find((r) => r.studentId === studentId);
    if (!row) return; // removed/replaced (e.g. a save) since the check started
    const el = Array.from(container.querySelectorAll('.org-status')).find(
      (span) => span.dataset.studentId === studentId
    );
    if (el) el.innerHTML = orgStatusBadge(row);
  }

  function renderCard() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Roster</h2>
        <div class="roster-table-wrap">
          <table class="roster-table">
            <thead>
              <tr>
                <th>Student ID</th>
                <th>Name</th>
                <th>GitHub Handle</th>
                <th>Org</th>
                <th></th>
              </tr>
            </thead>
            <tbody id="roster-body"></tbody>
          </table>
        </div>
        <div class="actions">
          <button type="button" id="add-student">Add student</button>
          <label for="csv-import">Import CSV</label>
          <input type="file" id="csv-import" accept=".csv" />
          <button type="button" id="register-all">Register all unregistered</button>
          <button type="button" id="save-roster" disabled>Save changes</button>
        </div>
        <p id="roster-error" class="error" hidden></p>
        <p id="roster-status" hidden></p>
      </section>
    `;

    wireStaticControls();
    renderRows();
  }

  function wireStaticControls() {
    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    });

    const tbody = container.querySelector('#roster-body');

    tbody.addEventListener('input', (e) => {
      const input = e.target.closest('input.cell');
      if (!input) return;
      const index = Number(input.dataset.rowIndex);
      const row = workingRows[index];
      row[input.dataset.field] = input.value;
      if (row._status !== 'new') row._status = 'edited';
      const tr = input.closest('tr');
      tr.classList.add('dirty');
      const registerBtn = tr.querySelector('.register-btn');
      if (registerBtn) {
        registerBtn.disabled = !row.handle.trim();
        registerBtn.title = row.handle.trim() ? '' : 'No GitHub handle — registration unavailable';
      }
      updateSaveButtonState();
    });

    tbody.addEventListener('focusout', (e) => {
      const input = e.target.closest('input.cell');
      if (!input) return;
      validateRowLive(Number(input.dataset.rowIndex));
    });

    tbody.addEventListener('click', (e) => {
      const removeBtn = e.target.closest('.remove-btn');
      if (removeBtn) return handleRemove(Number(removeBtn.dataset.rowIndex));
      const undoBtn = e.target.closest('.undo-btn');
      if (undoBtn) return handleUndo(Number(undoBtn.dataset.rowIndex));
      const registerBtn = e.target.closest('.register-btn');
      if (registerBtn) return handleRegister(Number(registerBtn.dataset.rowIndex));
    });

    container.querySelector('#add-student').addEventListener('click', () => {
      workingRows.push({ studentId: '', name: '', handle: '', _status: 'new', _original: null, _orgStatus: null });
      renderRows();
      const inputs = container.querySelectorAll('input.cell[data-field="studentId"]');
      inputs[inputs.length - 1]?.focus();
    });

    container.querySelector('#csv-import').addEventListener('change', handleImport);
    container.querySelector('#save-roster').addEventListener('click', handleSave);
    container.querySelector('#register-all').addEventListener('click', handleRegisterAll);
  }

  function renderRows() {
    const tbody = container.querySelector('#roster-body');
    tbody.innerHTML =
      workingRows.map((row, index) => rowHtml(row, index)).join('') ||
      '<tr><td colspan="5">No students yet.</td></tr>';
    updateSaveButtonState();
  }

  function rowHtml(row, index) {
    if (row._status === 'removed') {
      return `
        <tr data-row-index="${index}" class="removed">
          <td colspan="3"><s>${escapeHtml(row.studentId)} — ${escapeHtml(row.name)} (${escapeHtml(row.handle)})</s></td>
          <td></td>
          <td><button type="button" class="undo-btn" data-row-index="${index}">Undo</button></td>
        </tr>
      `;
    }
    const rowClass = row._status !== 'unchanged' ? 'dirty' : '';
    return `
      <tr data-row-index="${index}" class="${rowClass}">
        <td><input class="cell" data-field="studentId" data-row-index="${index}" value="${escapeHtml(row.studentId)}" /></td>
        <td><input class="cell" data-field="name" data-row-index="${index}" value="${escapeHtml(row.name)}" /></td>
        <td><input class="cell" data-field="handle" data-row-index="${index}" value="${escapeHtml(row.handle)}" /></td>
        <td>
          <span class="org-status" data-student-id="${escapeHtml(row.studentId)}">${orgStatusBadge(row)}</span>
          <button
            type="button"
            class="register-btn"
            data-row-index="${index}"
            ${row.handle.trim() ? '' : 'disabled'}
            title="${row.handle.trim() ? '' : 'No GitHub handle — registration unavailable'}"
          >Register</button>
        </td>
        <td><button type="button" class="remove-btn" data-row-index="${index}">Remove</button></td>
      </tr>
    `;
  }

  function orgStatusBadge(row) {
    if (!row._orgStatus) return '';
    const cls =
      row._orgStatus === 'active' ? 'badge-active' : row._orgStatus === 'pending' ? 'badge-pending' : 'badge-none';
    return `<span class="badge ${cls}">${escapeHtml(row._orgStatus)}</span>`;
  }

  function computeErrors() {
    const problems = [];
    workingRows.forEach((row, index) => {
      if (row._status === 'removed') return;
      const errors = validateStudent(
        row,
        workingRows.filter((r) => r !== row)
      );
      if (errors.length) problems.push({ index, errors });
    });
    return problems;
  }

  function validateRowLive(index) {
    const row = workingRows[index];
    if (!row || row._status === 'removed') return;
    const errors = validateStudent(
      row,
      workingRows.filter((r) => r !== row)
    );
    const tr = container.querySelector(`tr[data-row-index="${index}"]`);
    if (!tr) return;
    tr.querySelectorAll('input.cell').forEach((input) => {
      input.classList.toggle('invalid', errors.length > 0);
      input.title = errors.join(' ');
    });
    updateSaveButtonState();
  }

  function updateSaveButtonState() {
    const saveBtn = container.querySelector('#save-roster');
    if (!saveBtn) return;
    const hasPending = workingRows.some((r) => r._status !== 'unchanged');
    const errors = computeErrors();
    saveBtn.disabled = !hasPending || errors.length > 0;
    saveBtn.title = errors.length ? `${errors.length} row(s) have validation errors` : '';
  }

  function handleRemove(index) {
    workingRows[index]._status = 'removed';
    renderRows();
  }

  function handleUndo(index) {
    const row = workingRows[index];
    if (row._original) {
      const changed =
        row.studentId !== row._original.studentId ||
        row.name !== row._original.name ||
        row.handle !== row._original.handle;
      row._status = changed ? 'edited' : 'unchanged';
    } else {
      row._status = 'new';
    }
    renderRows();
  }

  async function handleImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const errorEl = container.querySelector('#roster-error');
    const statusEl = container.querySelector('#roster-status');
    errorEl.hidden = true;
    statusEl.hidden = true;

    const text = await file.text();
    const { students: imported, errors } = parseRosterCsv(text);
    if (errors.length) {
      errorEl.textContent = errors[0];
      errorEl.hidden = false;
      e.target.value = '';
      return;
    }

    const { added, updated } = mergeRoster(workingRows, imported);
    statusEl.textContent = `Imported: ${added.length} new, ${updated.length} updated. Review, then click Save changes to persist.`;
    statusEl.hidden = false;
    e.target.value = '';
    renderRows();
  }

  async function handleSave() {
    const errorEl = container.querySelector('#roster-error');
    const statusEl = container.querySelector('#roster-status');
    const saveBtn = container.querySelector('#save-roster');
    errorEl.hidden = true;
    statusEl.hidden = true;
    saveBtn.disabled = true;

    if (computeErrors().length) {
      errorEl.textContent = 'Fix the highlighted rows before saving.';
      errorEl.hidden = false;
      updateSaveButtonState();
      return;
    }

    const finalStudents = workingRows
      .filter((r) => r._status !== 'removed')
      .map((r) => ({ studentId: r.studentId.trim(), name: r.name.trim(), handle: r.handle.trim() }));

    try {
      const result = await putContents(org, repo, ROSTER_PATH, rosterToCsv(finalStudents), 'Update roster', sha);
      sha = result.content.sha;
      const orgStatusByHandle = new Map(workingRows.map((r) => [r.handle.trim(), r._orgStatus]));
      workingRows = finalStudents.map((s) => ({
        ...s,
        _status: 'unchanged',
        _original: { ...s },
        _orgStatus: orgStatusByHandle.get(s.handle) || null,
      }));
      statusEl.textContent = 'Saved.';
      statusEl.hidden = false;
      renderRows();
    } catch (err) {
      errorEl.textContent = describeSaveError(err);
      errorEl.hidden = false;
      updateSaveButtonState();
    }
  }

  async function handleRegister(index) {
    const row = workingRows[index];
    if (!row || !row.handle.trim()) return;
    try {
      const result = await setOrgMembership(org, row.handle.trim());
      row._orgStatus = result.state;
    } catch (err) {
      row._orgStatus = 'error';
      const errorEl = container.querySelector('#roster-error');
      errorEl.textContent = `Could not register ${row.handle}: ${err.message}`;
      errorEl.hidden = false;
    }
    renderRows();
  }

  async function handleRegisterAll() {
    const btn = container.querySelector('#register-all');
    const statusEl = container.querySelector('#roster-status');
    btn.disabled = true;

    let registered = 0;
    let alreadyActive = 0;
    let skipped = 0;

    for (const row of workingRows) {
      if (row._status === 'removed' || !row.handle.trim()) {
        skipped++;
        continue;
      }
      let membership;
      try {
        membership = await getOrgMembership(org, row.handle.trim());
      } catch {
        membership = null;
      }
      if (membership && membership.state === 'active') {
        row._orgStatus = 'active';
        alreadyActive++;
        continue;
      }
      try {
        const result = await setOrgMembership(org, row.handle.trim());
        row._orgStatus = result.state;
        registered++;
      } catch {
        row._orgStatus = 'error';
      }
    }

    statusEl.textContent = `Registered ${registered}, already active ${alreadyActive}, skipped ${skipped}.`;
    statusEl.hidden = false;
    btn.disabled = false;
    renderRows();
  }

  function describeSaveError(err) {
    if (err instanceof GitHubApiError && err.status === 409) {
      return 'The roster changed elsewhere since it was loaded. Reload the page and try again.';
    }
    return `Could not save roster: ${err.message}`;
  }
}
