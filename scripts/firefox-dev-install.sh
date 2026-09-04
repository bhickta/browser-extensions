#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/firefox-dev-install.sh [options] [extension-directory]

Validate and install a repository extension in Firefox.

Options:
  --profile NAME_OR_PATH  Existing Firefox profile to use
  --firefox PATH          Firefox executable (auto-detected by default)
  --in-place              Keep changes in the selected profile
  --permanent             Sign and permanently install the extension
  --signed-xpi PATH       Permanently install this Mozilla-signed XPI
  --artifacts-dir PATH    Directory for signed XPIs (default: extension/dist/firefox)
  --no-lint               Skip web-ext lint
  -h, --help              Show this help

Examples:
  scripts/firefox-dev-install.sh smart-video-skipper
  scripts/firefox-dev-install.sh --profile default-release --in-place smart-video-skipper
  WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... \\
    scripts/firefox-dev-install.sh --permanent smart-video-skipper

By default, an isolated .firefox-dev-profile directory is created in the repo.
The extension is temporary and must be loaded again after Firefox restarts.
--permanent creates a Mozilla-signed unlisted XPI through AMO. It requires
WEB_EXT_API_KEY and WEB_EXT_API_SECRET unless --signed-xpi is supplied.
EOF
}

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REPO_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
PROFILE=""
FIREFOX_BIN=""
IN_PLACE=0
PROFILE_CREATE=0
RUN_LINT=1
PERMANENT=0
SIGNED_XPI=""
ARTIFACTS_DIR=""
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
    --permanent)
      PERMANENT=1
      shift
      ;;
    --signed-xpi)
      [[ $# -ge 2 ]] || { echo "--signed-xpi requires a value" >&2; exit 2; }
      SIGNED_XPI=$2
      shift 2
      ;;
    --artifacts-dir)
      [[ $# -ge 2 ]] || { echo "--artifacts-dir requires a value" >&2; exit 2; }
      ARTIFACTS_DIR=$2
      shift 2
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

if [[ -n "$SIGNED_XPI" && "$PERMANENT" -eq 0 ]]; then
  echo "--signed-xpi requires --permanent." >&2
  exit 2
fi

command -v node >/dev/null 2>&1 || { echo "Node.js is required." >&2; exit 1; }

if [[ -z "$PROFILE" ]]; then
  PROFILE="$REPO_DIR/.firefox-dev-profile"
  PROFILE_CREATE=1
  IN_PLACE=1
fi

if (( !PROFILE_CREATE )) && [[ "$PROFILE" != /* && "$PROFILE" != ./* && ! -d "$PROFILE" ]]; then
  PROFILES_INI="$HOME/.mozilla/firefox/profiles.ini"
  [[ -f "$PROFILES_INI" ]] || {
    echo "Firefox profile '$PROFILE' was not found and profiles.ini is unavailable." >&2
    exit 1
  }

  PROFILE_PATH=$(node -e '
    const fs = require("fs");
    const [name, iniPath] = process.argv.slice(1);
    const sections = fs.readFileSync(iniPath, "utf8").split(/\r?\n\s*\r?\n/);
    for (const section of sections) {
      const values = Object.fromEntries(section.split(/\r?\n/).flatMap((line) => {
        const index = line.indexOf("=");
        return index === -1 ? [] : [[line.slice(0, index), line.slice(index + 1)]];
      }));
      if (values.Name !== name || !values.Path) continue;
      const path = values.IsRelative === "0" ? values.Path : require("path").join(require("path").dirname(iniPath), values.Path);
      process.stdout.write(path);
      process.exit(0);
    }
    process.exit(1);
  ' "$PROFILE" "$PROFILES_INI") || {
    echo "Firefox profile '$PROFILE' was not found in: $PROFILES_INI" >&2
    exit 1
  }
  PROFILE=$PROFILE_PATH
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

if ((PERMANENT)); then
  EXTENSION_ID=$(node -e '
    const manifest = require(process.argv[1]);
    const id = manifest.browser_specific_settings?.gecko?.id;
    if (!id) process.exit(1);
    process.stdout.write(id);
  ' "$EXTENSION_DIR/manifest.json") || {
    echo "Permanent installation requires browser_specific_settings.gecko.id." >&2
    exit 1
  }

  if [[ -n "$SIGNED_XPI" ]]; then
    [[ -f "$SIGNED_XPI" ]] || { echo "Signed XPI not found: $SIGNED_XPI" >&2; exit 1; }
  else
    if [[ -z "$ARTIFACTS_DIR" ]]; then
      ARTIFACTS_DIR="$EXTENSION_DIR/dist/firefox"
    elif [[ "$ARTIFACTS_DIR" != /* ]]; then
      ARTIFACTS_DIR="$REPO_DIR/$ARTIFACTS_DIR"
    fi

    [[ -n "${WEB_EXT_API_KEY:-}" && -n "${WEB_EXT_API_SECRET:-}" ]] || {
      cat >&2 <<'EOF'
Permanent installation on standard Firefox requires a Mozilla-signed XPI.
Set WEB_EXT_API_KEY and WEB_EXT_API_SECRET for an AMO API account, or pass an
existing signed XPI with --signed-xpi PATH.
EOF
      exit 1
    }

    mkdir -p "$ARTIFACTS_DIR"
    echo "Signing $(basename -- "$EXTENSION_DIR") as an unlisted Firefox add-on…"
    npx --yes web-ext sign \
      --config "$SCRIPT_DIR/web-ext-sign-config.cjs" \
      --no-config-discovery \
      --channel unlisted \
      --source-dir "$EXTENSION_DIR" \
      --artifacts-dir "$ARTIFACTS_DIR"

    mapfile -t SIGNED_XPIS < <(find "$ARTIFACTS_DIR" -maxdepth 1 -type f -name '*.xpi' -print | sort)
    ((${#SIGNED_XPIS[@]} > 0)) || {
      echo "web-ext sign did not produce an XPI in: $ARTIFACTS_DIR" >&2
      exit 1
    }
    SIGNED_XPI=${SIGNED_XPIS[${#SIGNED_XPIS[@]} - 1]}
  fi

  mkdir -p "$PROFILE/extensions"
  install -m 0644 "$SIGNED_XPI" "$PROFILE/extensions/$EXTENSION_ID.xpi"
  echo "Installed signed XPI permanently in profile '$PROFILE'."
  echo "Firefox may ask you to enable this newly side-loaded add-on."
  echo "Launching Firefox profile '$PROFILE'…"
  exec "$FIREFOX_BIN" --new-instance --profile "$PROFILE" --new-window about:addons
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
