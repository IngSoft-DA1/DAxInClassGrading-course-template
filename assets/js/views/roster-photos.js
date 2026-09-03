import { getContents, getContentsBase64, putContentsBase64, listDirectory, GitHubApiError } from '../github-api.js';
import { setActiveCourse, addRecentCourse } from '../session.js';
import { renderHeader } from '../components/header.js';
import { escapeHtml } from '../util.js';
import { parseRosterCsv } from '../roster.js';
import { photoPath, photoShaByStudentId, isAcceptedImageFile, PHOTOS_DIR } from '../student-photos.js';

const MAX_PHOTO_DIMENSION = 480;
const PHOTO_JPEG_QUALITY = 0.82;

export async function renderRosterPhotos(container, { org, repo }, headerEl) {
  container.innerHTML = '<p>Loading student photos…</p>';

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
    location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    return;
  }

  setActiveCourse({ org, repo, sessionId: config.sessionId });
  addRecentCourse({ org, repo, sessionId: config.sessionId });
  if (headerEl) renderHeader(headerEl, { org, repo, sessionId: config.sessionId });

  let rosterFile;
  let photoEntries;
  try {
    [rosterFile, photoEntries] = await Promise.all([
      getContents(org, repo, 'students/roster.csv'),
      listDirectory(org, repo, PHOTOS_DIR),
    ]);
  } catch (err) {
    container.innerHTML = `<p class="error">Could not load student photos: ${escapeHtml(err.message)}</p>`;
    return;
  }

  const { students, errors: rosterErrors } = parseRosterCsv(rosterFile ? rosterFile.content : '');
  if (rosterErrors.length) {
    container.innerHTML = `<p class="error">${escapeHtml(rosterErrors[0])}</p>`;
    return;
  }

  // Mutable module-local state for this render of the view.
  const photoShaById = photoShaByStudentId(photoEntries);
  const photoDataUrlById = new Map();
  let nextLocalId = 1;
  let pendingFiles = []; // { localId, file, previewUrl } — added, not yet paired
  let pairs = []; // { localId, file, previewUrl, studentId } — paired, not yet saved
  let selection = null; // { side: 'photo' | 'student', id }
  let lightboxStudentId = null; // Student ID currently shown enlarged, or null

  render();
  loadGalleryThumbnails();

  function render() {
    container.innerHTML = `
      <section class="card">
        <button type="button" class="back-link" id="back-to-course">← Back to course home</button>
        <h2>Student Photos</h2>
        <p class="field-hint">
          Add photos, then tap a photo and a student to pair them up. This is
          only to help you recognize and remember students — it isn't part
          of the roster and doesn't affect grading.
        </p>

        <div class="actions">
          <label for="photo-upload">Add photos</label>
          <input type="file" id="photo-upload" accept="image/*" multiple />
        </div>
        <p id="photos-error" class="error" hidden></p>
        <p id="photos-status" class="row-status" hidden></p>

        ${renderPairingSectionHtml()}
      </section>

      <section class="card">
        <h3>Class photos</h3>
        <p class="field-hint">Everyone in the roster, for quick review — click a photo to see it enlarged.</p>
        <div class="photo-gallery" id="photo-gallery">
          ${students.map((s) => galleryTileHtml(s)).join('') || '<p>No students in the roster yet.</p>'}
        </div>
      </section>

      ${lightboxStudentId && photoDataUrlById.has(lightboxStudentId) ? lightboxHtml() : ''}
    `;

    wireEvents();
  }

  function lightboxHtml() {
    const student = students.find((s) => s.studentId === lightboxStudentId);
    const name = student ? student.name : lightboxStudentId;
    return `
      <div class="photo-lightbox-backdrop" id="photo-lightbox-backdrop">
        <div class="photo-lightbox" role="dialog" aria-modal="true" aria-label="${escapeHtml(name)}">
          <button type="button" class="photo-lightbox-close" id="photo-lightbox-close" title="Close">×</button>
          <img src="${photoDataUrlById.get(lightboxStudentId)}" alt="${escapeHtml(name)}" />
          <p class="photo-lightbox-caption">${escapeHtml(name)}</p>
        </div>
      </div>
    `;
  }

  function renderPairingSectionHtml() {
    if (pendingFiles.length === 0 && pairs.length === 0) return '';

    const pairedIds = new Set(pairs.map((p) => p.studentId));
    const studentPool = students
      .filter((s) => !pairedIds.has(s.studentId))
      .slice()
      .sort((a, b) => {
        const aHas = photoShaById.has(a.studentId) ? 1 : 0;
        const bHas = photoShaById.has(b.studentId) ? 1 : 0;
        if (aHas !== bHas) return aHas - bHas; // students without a photo first
        return a.name.localeCompare(b.name);
      });

    return `
      <div class="photo-pairing">
        <div class="photo-pool">
          <h4>Photos to match (${pendingFiles.length})</h4>
          <div class="photo-tiles" id="photo-tiles">
            ${pendingFiles.map((p) => photoTileHtml(p)).join('') || '<p class="field-hint">All added photos are matched.</p>'}
          </div>
        </div>
        <div class="student-pool">
          <h4>Students</h4>
          <div class="student-pick-list" id="student-pick-list">
            ${studentPool.map((s) => studentPickRowHtml(s)).join('') || '<p class="field-hint">No students left to match.</p>'}
          </div>
        </div>
      </div>

      ${
        pairs.length
          ? `
        <div class="pending-pairs">
          <h4>Ready to save (${pairs.length})</h4>
          <ul class="list" id="pending-pairs-list">
            ${pairs.map((p) => pendingPairRowHtml(p)).join('')}
          </ul>
        </div>
      `
          : ''
      }

      <div class="actions">
        <button type="button" id="save-photos" ${pairs.length === 0 ? 'disabled' : ''}>
          Save ${pairs.length || ''} photo${pairs.length === 1 ? '' : 's'}
        </button>
      </div>
    `;
  }

  function photoTileHtml(p) {
    const selected = selection && selection.side === 'photo' && selection.id === p.localId;
    return `
      <div class="photo-tile ${selected ? 'selected' : ''}" data-local-id="${p.localId}">
        <button type="button" class="photo-tile-discard" data-local-id="${p.localId}" title="Remove this photo">×</button>
        <img src="${p.previewUrl}" alt="" />
        <span class="photo-tile-name">${escapeHtml(p.file.name)}</span>
      </div>
    `;
  }

  function studentPickRowHtml(s) {
    const selected = selection && selection.side === 'student' && selection.id === s.studentId;
    const hasPhoto = photoShaById.has(s.studentId);
    return `
      <button
        type="button"
        class="student-pick-row ${selected ? 'selected' : ''} ${hasPhoto ? 'has-photo' : ''}"
        data-student-id="${escapeHtml(s.studentId)}"
      >
        <span class="student-name">${escapeHtml(s.name)}</span>
        <span class="student-id">${escapeHtml(s.studentId)}</span>
        ${hasPhoto ? '<span class="badge badge-pending">Replace photo</span>' : ''}
      </button>
    `;
  }

  function pendingPairRowHtml(p) {
    const student = students.find((s) => s.studentId === p.studentId);
    return `
      <li class="pending-pair-row" data-local-id="${p.localId}">
        <img class="pending-pair-thumb" src="${p.previewUrl}" alt="" />
        <span>${escapeHtml(student ? student.name : p.studentId)}</span>
        <button type="button" class="undo-btn" data-local-id="${p.localId}">Undo</button>
      </li>
    `;
  }

  function galleryTileInnerHtml(s) {
    const cached = photoDataUrlById.get(s.studentId);
    return `
      ${
        cached
          ? `<button type="button" class="gallery-photo-btn" data-student-id="${escapeHtml(s.studentId)}"><img src="${cached}" alt="" /></button>`
          : '<div class="gallery-placeholder">No photo</div>'
      }
      <span class="student-name">${escapeHtml(s.name)}</span>
    `;
  }

  function galleryTileHtml(s) {
    return `<div class="gallery-tile" data-student-id="${escapeHtml(s.studentId)}">${galleryTileInnerHtml(s)}</div>`;
  }

  function wireEvents() {
    container.querySelector('#back-to-course').addEventListener('click', () => {
      location.hash = `#/course/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    });

    container.querySelector('#photo-upload').addEventListener('change', handleFilesSelected);

    const pairing = container.querySelector('.photo-pairing');
    if (pairing) {
      pairing.addEventListener('click', (e) => {
        const discardBtn = e.target.closest('.photo-tile-discard');
        if (discardBtn) return handleDiscardPhoto(Number(discardBtn.dataset.localId));

        const photoTile = e.target.closest('.photo-tile');
        if (photoTile) return handleSelectPhoto(Number(photoTile.dataset.localId));

        const studentRow = e.target.closest('.student-pick-row');
        if (studentRow) return handleSelectStudent(studentRow.dataset.studentId);
      });
    }

    const pendingList = container.querySelector('#pending-pairs-list');
    if (pendingList) {
      pendingList.addEventListener('click', (e) => {
        const undoBtn = e.target.closest('.undo-btn');
        if (undoBtn) handleUndoPair(Number(undoBtn.dataset.localId));
      });
    }

    const saveBtn = container.querySelector('#save-photos');
    if (saveBtn) saveBtn.addEventListener('click', handleSave);

    container.querySelector('#photo-gallery').addEventListener('click', (e) => {
      const photoBtn = e.target.closest('.gallery-photo-btn');
      if (photoBtn) handleOpenLightbox(photoBtn.dataset.studentId);
    });

    const lightboxBackdrop = container.querySelector('#photo-lightbox-backdrop');
    if (lightboxBackdrop) {
      lightboxBackdrop.addEventListener('click', (e) => {
        if (e.target === lightboxBackdrop) handleCloseLightbox();
      });
      container.querySelector('#photo-lightbox-close').addEventListener('click', handleCloseLightbox);
    }
  }

  function handleOpenLightbox(studentId) {
    if (!photoDataUrlById.has(studentId)) return;
    lightboxStudentId = studentId;
    render();
  }

  function handleCloseLightbox() {
    lightboxStudentId = null;
    render();
  }

  function handleFilesSelected(e) {
    const files = Array.from(e.target.files || []);
    e.target.value = '';

    const rejected = [];
    files.forEach((file) => {
      if (!isAcceptedImageFile(file)) {
        rejected.push(file.name);
        return;
      }
      pendingFiles.push({ localId: nextLocalId++, file, previewUrl: URL.createObjectURL(file) });
    });

    render();

    if (rejected.length) {
      const errorEl = container.querySelector('#photos-error');
      errorEl.textContent = `Skipped ${rejected.length} file(s) that aren't images: ${rejected.join(', ')}`;
      errorEl.hidden = false;
    }
  }

  function handleSelectPhoto(localId) {
    if (selection && selection.side === 'student') {
      confirmPair(localId, selection.id);
      return;
    }
    selection = selection && selection.side === 'photo' && selection.id === localId ? null : { side: 'photo', id: localId };
    render();
  }

  function handleSelectStudent(studentId) {
    if (selection && selection.side === 'photo') {
      confirmPair(selection.id, studentId);
      return;
    }
    selection =
      selection && selection.side === 'student' && selection.id === studentId ? null : { side: 'student', id: studentId };
    render();
  }

  function confirmPair(localId, studentId) {
    const index = pendingFiles.findIndex((p) => p.localId === localId);
    if (index === -1) return;
    const [file] = pendingFiles.splice(index, 1);
    pairs.push({ ...file, studentId });
    selection = null;
    render();
  }

  function handleDiscardPhoto(localId) {
    const index = pendingFiles.findIndex((p) => p.localId === localId);
    if (index === -1) return;
    URL.revokeObjectURL(pendingFiles[index].previewUrl);
    pendingFiles.splice(index, 1);
    if (selection && selection.side === 'photo' && selection.id === localId) selection = null;
    render();
  }

  function handleUndoPair(localId) {
    const index = pairs.findIndex((p) => p.localId === localId);
    if (index === -1) return;
    const [pair] = pairs.splice(index, 1);
    pendingFiles.push({ localId: pair.localId, file: pair.file, previewUrl: pair.previewUrl });
    render();
  }

  async function handleSave() {
    const saveBtn = container.querySelector('#save-photos');
    const errorEl = container.querySelector('#photos-error');
    const statusEl = container.querySelector('#photos-status');
    errorEl.hidden = true;
    statusEl.hidden = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving…';

    const toSave = pairs.slice();
    const savedLocalIds = [];
    const failures = [];

    for (const pair of toSave) {
      try {
        const base64 = await resizeToJpegBase64(pair.file, MAX_PHOTO_DIMENSION, PHOTO_JPEG_QUALITY);
        const existingSha = photoShaById.get(pair.studentId);
        const result = await putContentsBase64(
          org,
          repo,
          photoPath(pair.studentId),
          base64,
          `Add photo for ${pair.studentId}`,
          existingSha
        );
        photoShaById.set(pair.studentId, result.content.sha);
        photoDataUrlById.set(pair.studentId, `data:image/jpeg;base64,${base64}`);
        savedLocalIds.push(pair.localId);
        URL.revokeObjectURL(pair.previewUrl);
      } catch (err) {
        failures.push({ pair, err });
      }
    }

    pairs = pairs.filter((p) => !savedLocalIds.includes(p.localId));
    render();

    if (failures.length) {
      const errorEl2 = container.querySelector('#photos-error');
      errorEl2.textContent = `Saved ${savedLocalIds.length}, failed to save ${failures.length}: ${failures
        .map((f) => describeSaveError(f.err))
        .join(' ')}`;
      errorEl2.hidden = false;
    } else if (savedLocalIds.length) {
      const statusEl2 = container.querySelector('#photos-status');
      statusEl2.textContent = `Saved ${savedLocalIds.length} photo${savedLocalIds.length === 1 ? '' : 's'}.`;
      statusEl2.hidden = false;
    }
  }

  async function loadGalleryThumbnails() {
    const ids = Array.from(photoShaById.keys());
    await Promise.all(
      ids.map(async (studentId) => {
        try {
          const file = await getContentsBase64(org, repo, photoPath(studentId));
          if (!file) return;
          photoDataUrlById.set(studentId, `data:image/jpeg;base64,${file.base64}`);
          updateGalleryTile(studentId);
        } catch {
          // Leave the placeholder in place for this one — not fatal to the view.
        }
      })
    );
  }

  function updateGalleryTile(studentId) {
    const student = students.find((s) => s.studentId === studentId);
    if (!student) return;
    const tile = Array.from(container.querySelectorAll('.gallery-tile')).find(
      (el) => el.dataset.studentId === studentId
    );
    if (tile) tile.innerHTML = galleryTileInnerHtml(student);
  }

  function describeSaveError(err) {
    if (err instanceof GitHubApiError && err.status === 409) {
      return `${err.message} — reload and try again.`;
    }
    return err.message || 'unknown error';
  }
}

// Downscales `file` to at most `maxDim` on its longest edge and re-encodes
// it as JPEG, returning the raw base64 payload (no "data:" prefix) ready
// for putContentsBase64. Keeps saved photos small and always in one
// predictable format regardless of what was uploaded (see
// student-photos.js's fixed .jpg storage extension). DOM-only (Image +
// canvas), so it lives here rather than in the pure student-photos.js
// module — see AGENTS.md's logic-only vs. flow/UI test split.
function resizeToJpegBase64(file, maxDim, quality) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const scale = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
      const width = Math.max(1, Math.round(img.naturalWidth * scale));
      const height = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      // Flatten onto white first — otherwise a transparent PNG turns black
      // once re-encoded as JPEG, which has no alpha channel.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read image file "${file.name}".`));
    };
    img.src = objectUrl;
  });
}
