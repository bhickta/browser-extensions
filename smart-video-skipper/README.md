# SmartVideoSkipper Pro

A dependency-free (runtime) WebExtension for Firefox, Chrome, Chromium, Edge,
Brave, and other Manifest V3 browsers. It adds a compact floating video dock
with skip, auto-skip, playback-speed, bookmark, progress, hotkey, and in-page
settings controls.

![SmartVideoSkipper logo](icons/icon-128.png)

## Build

Source lives in `src/*.ts` and compiles to `js/*.js`. The build needs Node.js
and downloads TypeScript on demand through `npx`, so no `node_modules` is
required.

```sh
make build        # compile src/*.ts -> js/*.js
make typecheck    # type-check only
make package      # compile, validate, and write dist/smart-video-skipper-<version>.zip
```

The compiled `js/` directory is generated and not tracked by Git. Build before
loading the extension manually or running the automated installer.

## Install in Firefox (development)

From the repository root:

```sh
./scripts/firefox-dev-install.sh smart-video-skipper
```

The script builds `src/*.ts`, lints, and loads the extension into an isolated
`.firefox-dev-profile`. Run `./scripts/firefox-dev-install.sh --help` for
profile and Firefox-binary options. Alternatively, load it manually:

1. Run `make build`.
2. Open `about:debugging#/runtime/this-firefox`.
3. Select **Load Temporary Add-on…** and choose `manifest.json`.
4. Click the toolbar icon and enable the current site and video controls.

Temporary extensions are removed when Firefox exits. For a permanent
installation in a profile, use Mozilla signing credentials to create and
install an unlisted signed XPI:

```sh
WEB_EXT_API_KEY=... WEB_EXT_API_SECRET=... \
  ./scripts/firefox-dev-install.sh --permanent smart-video-skipper
```

Use `--permanent --signed-xpi PATH` if you already have a signed XPI. Standard
Firefox will reject an unsigned XPI.

## Install in Chromium browsers (development)

1. Run `make build`.
2. Open `chrome://extensions` (or the Edge/Brave equivalent).
3. Enable **Developer mode**.
4. Select **Load unpacked** and choose this directory.
5. For local videos, open the extension details and enable **Allow access to file URLs**.

## The dock

The in-page control is a compact, collapsible dock, not a full-width bar, so it
does not cover the video or the native controls:

- The ⚡ handle collapses the dock to a single small button; set **Start
  collapsed** to keep it small by default.
- The dock follows the video into fullscreen when the browser reports a
  fullscreen container.
- The progress track is scoped to the dock width. Drag it (pointer or keyboard)
  to seek.
- The **↕** button moves the dock between the bottom and top edges.

## Settings

The ⚙ button (or the panel hotkey, default `` ` ``) opens grouped settings:
Core, Skipping, Speed, Hotkeys, and Overlay. Settings save to `storage.local`
and apply live across open tabs and frames — no page reload is required.

## Notes

- Settings are shared through `storage.local` and remain local to the browser profile.
- The extension starts disabled. Use its toolbar popup to enable controls on a site.
- The toolbar popup is the cross-browser replacement for userscript manager menu commands.
- Embedded cross-origin players work because the content script is allowed in all frames.
- **Prefer forward buffering** continuously applies the browser's strongest
  non-disruptive `preload="auto"` hint. URL-backed videos generally honor it;
  YouTube's adaptive MediaSource player can still control how many future
  segments it downloads.
- **Buffer-aware skipping** constrains every skip to the active video's
  currently buffered range. Near a buffer edge, the skip is shortened instead
  of pausing playback or seeking into unbuffered media. Progress-bar and
  bookmark jumps stay immediate.

## License

MIT
