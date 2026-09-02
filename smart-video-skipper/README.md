# SmartVideoSkipper Pro

A dependency-free WebExtension for Firefox, Chrome, Chromium, Edge, Brave, and other Manifest V3 browsers. It adds HTML5 video skip controls, auto-skip, playback-speed controls, bookmarks, progress seeking, hotkeys, and an in-page settings panel.

![SmartVideoSkipper logo](icons/icon-128.png)

## Install in Firefox (development)

From the repository root, the automated method is:

```sh
./scripts/firefox-dev-install.sh smart-video-skipper
```

Run `./scripts/firefox-dev-install.sh --help` for profile and Firefox-binary
options. Alternatively, load it manually:

1. Open `about:debugging#/runtime/this-firefox`.
2. Select **Load Temporary Add-on…**.
3. Choose this project's `manifest.json` (or any file in the packaged ZIP).
4. Click the toolbar icon and enable the current site and video controls.

Temporary extensions are removed when Firefox exits. For a permanent installation, the ZIP must be signed through Mozilla Add-ons unless the Firefox build permits unsigned extensions.

## Install in Chromium browsers (development)

1. Open `chrome://extensions` (use the equivalent page in Edge/Brave).
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this directory.
4. For local videos, open the extension's details and enable **Allow access to file URLs**.

## Package

Run:

```sh
make package
```

The distributable archive is written to `dist/smart-video-skipper-3.0.0.zip`.

## Notes

- Settings are shared through `storage.local` and remain local to the browser profile.
- The extension starts disabled. Use its toolbar popup to enable controls.
- The toolbar popup is the cross-browser replacement for userscript manager menu commands.
- Embedded cross-origin players work because the content script is allowed in all frames.
- **Prefer forward buffering** continuously applies the browser's strongest
  non-disruptive `preload="auto"` hint. URL-backed videos generally honor it;
  YouTube's adaptive MediaSource player can still control how many future
  segments it downloads.
- **Buffer-aware skipping** checks the active video's buffered ranges. When a
  skip target is not ready, it pauses, seeks to make the player request that
  segment, waits for playable media (up to the configured timeout), and then
  restores the prior playing state. Progress-bar and bookmark jumps stay
  immediate.

## License

MIT
