// Pure, DOM-free helpers for the student-photos feature. Canvas-based
// resizing and all DOM/rendering logic live in
// views/roster-photos.js — this module only covers what plain Node can
// exercise (see AGENTS.md's logic-only vs. flow/UI test split).

export const PHOTOS_DIR = 'students/photos';

// Photos are always re-encoded to JPEG on save (see roster-photos.js), so
// storage uses a single deterministic extension — no need to search
// multiple extensions to find a student's photo, and no separate mapping
// file: the Student ID *is* the filename.
const STORED_EXTENSION = '.jpg';

const ACCEPTED_INPUT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function isAcceptedImageFile(file) {
  return !!file && ACCEPTED_INPUT_TYPES.includes(file.type);
}

export function photoPath(studentId) {
  return `${PHOTOS_DIR}/${studentId}${STORED_EXTENSION}`;
}

// `entries` is a directory listing (array of {name, sha}) as returned by
// listDirectory(org, repo, PHOTOS_DIR). Returns a Map of Student ID -> sha
// for every student who already has a saved photo, so the view can pass
// the right sha when overwriting (GitHub requires it for updates) without
// an extra round-trip per file.
export function photoShaByStudentId(entries) {
  const map = new Map();
  (entries || []).forEach((entry) => {
    const name = entry && entry.name;
    if (!name || !name.toLowerCase().endsWith(STORED_EXTENSION)) return;
    map.set(name.slice(0, -STORED_EXTENSION.length), entry.sha);
  });
  return map;
}
