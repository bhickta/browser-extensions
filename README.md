# Browser Extensions

Cross-browser extensions maintained as independent subdirectories.

## Extensions

- [`smart-video-skipper`](smart-video-skipper/) — HTML5 video skip, auto-skip, speed, bookmark, and progress controls for Firefox and Chromium browsers.

Each extension contains its own installation and packaging instructions.

## Automated Firefox development install

The repository includes a reusable launcher for any extension directory:

```sh
./scripts/firefox-dev-install.sh smart-video-skipper
```

It validates the extension and loads it into an isolated `.firefox-dev-profile`
directory that is ignored by Git. Close Firefox before running it. To
deliberately use an existing profile, pass `--profile PROFILE_NAME --in-place`;
see `--help` for details.

Development installations are temporary. Standard Firefox requires a
Mozilla-signed XPI for permanent installation.
