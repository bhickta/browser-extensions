#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/firefox-dev-install.sh [options] [extension-directory]

Validate and temporarily install a repository extension in Firefox.

Options:
  --profile NAME_OR_PATH  Existing Firefox profile to use
  --firefox PATH          Firefox executable (auto-detected by default)
  --in-place              Keep changes in the selected profile
  --no-lint               Skip web-ext lint
  -h, --help              Show this help

Examples:
  scripts/firefox-dev-install.sh smart-video-skipper
  scripts/firefox-dev-install.sh --profile default-release --in-place smart-video-skipper

By default, an isolated .firefox-dev-profile directory is created in the repo.
The extension is temporary and must be loaded again after Firefox restarts.
Permanent installation in standard Firefox requires a Mozilla-signed XPI.
EOF
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PROFILE=""
FIREFOX_BIN=""
IN_PLACE=0
PROFILE_CREATE=0
RUN_LINT=1
EXTENSION="smart-video-skipper"

while (($#)); do
  case "$1" in
    --profile)
      [[ $# -ge 2 ]] || { echo "--profile requires a value" >&2; exit 2; }
      PROFILE=$2
      shift 2
      ;;
    --firefox)
      [[ $# -ge 2 ]] || { echo "--firefox requires a value" >&2; exit 2; }
      FIREFOX_BIN=$2
      shift 2
      ;;
    --in-place)
      IN_PLACE=1
      shift
      ;;
    --no-lint)
      RUN_LINT=0
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    --*)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
    *)
      EXTENSION=$1
      shift
      ;;
  esac
done

if [[ -z "$PROFILE" ]]; then
  PROFILE="$REPO_DIR/.firefox-dev-profile"
  PROFILE_CREATE=1
  IN_PLACE=1
fi

if [[ "$EXTENSION" = /* ]]; then
  EXTENSION_DIR=$EXTENSION
else
  EXTENSION_DIR="$REPO_DIR/$EXTENSION"
fi

[[ -f "$EXTENSION_DIR/manifest.json" ]] || {
  echo "No manifest.json found in: $EXTENSION_DIR" >&2
  exit 1
}

if [[ -z "$FIREFOX_BIN" ]]; then
  if command -v firefox >/dev/null 2>&1; then
    FIREFOX_BIN=$(command -v firefox)
  elif command -v firefox-esr >/dev/null 2>&1; then
    FIREFOX_BIN=$(command -v firefox-esr)
  elif [[ -x "/Applications/Firefox.app/Contents/MacOS/firefox" ]]; then
    FIREFOX_BIN="/Applications/Firefox.app/Contents/MacOS/firefox"
  else
    echo "Firefox was not found; pass --firefox PATH." >&2
    exit 1
  fi
fi

command -v node >/dev/null 2>&1 || { echo "Node.js is required." >&2; exit 1; }
command -v npx >/dev/null 2>&1 || { echo "npm/npx is required." >&2; exit 1; }

if ((RUN_LINT)); then
  echo "Validating $(basename -- "$EXTENSION_DIR")…"
  npx --yes web-ext lint \
    --source-dir "$EXTENSION_DIR" \
    --ignore-files dist README.md Makefile LICENSE .gitignore
fi

if pgrep -x firefox >/dev/null 2>&1 || pgrep -x firefox-esr >/dev/null 2>&1; then
  cat >&2 <<'EOF'
Firefox is already running. Close all Firefox windows and run this command again
so the selected profile is not locked.
EOF
  exit 1
fi

ARGS=(
  --yes web-ext run
  --source-dir "$EXTENSION_DIR"
  --firefox "$FIREFOX_BIN"
  --firefox-profile "$PROFILE"
  --no-reload
  --start-url about:addons
)

if ((PROFILE_CREATE)); then
  ARGS+=(--profile-create-if-missing)
fi

if ((IN_PLACE)); then
  if ((!PROFILE_CREATE)); then
    cat <<'EOF'
WARNING: --in-place lets web-ext change the selected profile, including settings
used for remote debugging. Use a dedicated development profile when possible.
EOF
  fi
  ARGS+=(--keep-profile-changes)
fi

echo "Launching Firefox profile '$PROFILE' with $(basename -- "$EXTENSION_DIR")…"
exec npx "${ARGS[@]}"
