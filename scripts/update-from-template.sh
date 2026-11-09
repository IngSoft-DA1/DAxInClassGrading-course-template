#!/usr/bin/env bash
# Pulls this course repo's app code (index.html, assets/, the Pages deploy
# workflow) up to date from the published course template repo, without
# touching grades/roster/config data. Run this from inside your course
# repo's local clone any time a fix ships upstream.
# Works unmodified on macOS and Ubuntu.
# Keep in sync with update-from-template.ps1 (Windows) if this logic changes.

set -euo pipefail

SOURCE_OWNER="IngSoft-DA1"
SOURCE_REPO="DAxInClassGrading-course-template"
DEST_REPO=""
DEST_DIR=""
DRY_RUN=0
ASSUME_YES=0

usage() {
  cat <<'EOF'
Usage: update-from-template.sh [--source-owner ORG] [--source-repo NAME] [--repo OWNER/NAME] [--dir PATH] [--dry-run] [-y|--yes] [--help]

Syncs this course repo's app code (index.html, assets/, the Pages deploy
workflow) from the published course template repo. Never touches
config/course.json, students/, grades/, or photos/ — only those three paths.

Run this from inside your course repo's local clone (the common case — no
flags needed beyond --dry-run/-y), OR pass --repo OWNER/NAME to have it
clone your course repo first.

  --source-owner ORG   Template repo owner (default: IngSoft-DA1)
  --source-repo NAME   Template repo name (default: DAxInClassGrading-course-template)
  --repo OWNER/NAME    Your course repo, if not already cloned locally
  --dir PATH           Where to clone --repo into (default: a temp dir)
  --dry-run            Print what would happen, without changing anything
  -y, --yes            Skip the confirmation prompt
  --help               Show this help
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --source-owner) SOURCE_OWNER="$2"; shift 2 ;;
    --source-repo) SOURCE_REPO="$2"; shift 2 ;;
    --repo) DEST_REPO="$2"; shift 2 ;;
    --dir) DEST_DIR="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -y|--yes) ASSUME_YES=1; shift ;;
    --help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

run() {
  echo "+ $*"
  if [ "$DRY_RUN" -eq 0 ]; then
    "$@"
  fi
}

command -v git >/dev/null 2>&1 || { echo "git is required but not found." >&2; exit 1; }

# --- Safety gate: refuse to run anywhere that isn't recognizably a --------
# --- deployed DAxInClassGrading course-repo clone -------------------------
# Always runs for real, --dry-run or not, on any directory that already
# exists on disk — this is what stops the script from being run by mistake
# against the wrong working copy (this dev repo, some unrelated repo, or
# the template repo itself).
origin_owner_repo() {
  local url
  url="$(git -C "$1" config --get remote.origin.url 2>/dev/null || true)"
  echo "$url" | sed -E 's#^git@github\.com:##; s#^https://github\.com/##; s#\.git$##'
}

verify_course_repo() {
  local dir="$1"
  if [ -f "$dir/package.json" ]; then
    echo "Refusing to run: found package.json at $dir — this looks like the DAxInClassGrading dev repo, not a deployed course repo." >&2
    exit 1
  fi
  if [ ! -f "$dir/index.html" ]; then
    echo "Refusing to run: no index.html at $dir — this doesn't look like a course-repo clone." >&2
    exit 1
  fi
  if [ ! -f "$dir/assets/js/github-api.js" ] || ! grep -q "TEMPLATE_OWNER" "$dir/assets/js/github-api.js"; then
    echo "Refusing to run: assets/js/github-api.js is missing or doesn't look like the DAxInClassGrading app at $dir." >&2
    exit 1
  fi
  local origin
  origin="$(origin_owner_repo "$dir")"
  if [ "$origin" = "$SOURCE_OWNER/$SOURCE_REPO" ]; then
    echo "Refusing to run: $dir's origin is the template repo itself ($SOURCE_OWNER/$SOURCE_REPO) — nothing to sync." >&2
    exit 1
  fi
}

# --- Resolve the working directory ----------------------------------------

WORK_DIR=""
if git rev-parse --show-toplevel >/dev/null 2>&1; then
  WORK_DIR="$(git rev-parse --show-toplevel)"
  echo "Using current repo: $WORK_DIR"
  verify_course_repo "$WORK_DIR"
elif [ -n "$DEST_REPO" ]; then
  WORK_DIR="${DEST_DIR:-$(mktemp -d)}"
  run git clone "https://github.com/$DEST_REPO.git" "$WORK_DIR"
  if [ -d "$WORK_DIR/.git" ]; then
    verify_course_repo "$WORK_DIR"
  else
    echo "[dry-run] would verify $WORK_DIR looks like a course-repo clone before syncing."
  fi
else
  echo "Not inside a git repository, and no --repo given." >&2
  echo "cd into your course repo's local clone, or pass --repo OWNER/NAME." >&2
  exit 1
fi

echo "Looks like a DAxInClassGrading course repo — proceeding."

# --- Fetch the template repo's current app code ---------------------------

SRC_DIR="$(mktemp -d)"
cleanup() { rm -rf "$SRC_DIR"; }
trap cleanup EXIT

run git clone --depth 1 "https://github.com/$SOURCE_OWNER/$SOURCE_REPO.git" "$SRC_DIR"

# --- Sync exactly the app-code paths — never grades/students/config/photos

(
  cd "$WORK_DIR"
  run rm -rf assets
  run cp -r "$SRC_DIR/assets" assets
  run cp "$SRC_DIR/index.html" index.html
  run mkdir -p .github/workflows
  run cp "$SRC_DIR/.github/workflows/deploy-pages.yml" .github/workflows/deploy-pages.yml

  if [ "$DRY_RUN" -eq 1 ]; then
    echo
    echo "[dry-run] would review changes to index.html, assets/, and"
    echo "[dry-run] .github/workflows/deploy-pages.yml, then commit and push."
    exit 0
  fi

  run git add index.html assets .github/workflows/deploy-pages.yml

  if git diff --cached --quiet -- index.html assets .github/workflows/deploy-pages.yml; then
    echo "Already up to date — nothing to sync."
    exit 0
  fi

  echo
  echo "Changes to commit:"
  git diff --cached --stat -- index.html assets .github/workflows/deploy-pages.yml

  if [ "$ASSUME_YES" -eq 0 ]; then
    echo
    read -r -p "Commit and push these changes? [y/N] " reply
    case "$reply" in
      [yY]|[yY][eE][sS]) ;;
      *) echo "Aborted (changes staged locally but not committed)."; exit 1 ;;
    esac
  fi

  run git commit -m "Sync app code from course template"
  run git push
)
