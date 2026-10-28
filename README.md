# Forge Studio

A browser-based HTML game editor prototype with a Three.js scene viewport, hierarchy, transform inspector, text editor, sandboxed preview, local project persistence, undo/redo snapshots, and ZIP export.

## Run

Because the app uses JavaScript modules, open it through a local web server rather than `file://`. For example:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000` from the same device. Three.js is loaded from jsDelivr, so the scene viewport requires an internet connection.

## Hosting on GitHub Pages

Upload the contents of this folder to a GitHub repository, enable **Settings → Pages → Deploy from a branch**, and select the branch/root folder. No build step is required.

## Features and limitations

- Projects save to IndexedDB in the current browser/device.
- Export Project ZIP downloads the project's web files plus `forge-project.json`.
- Import Project JSON imports a Forge project data file; it does not yet import arbitrary ZIP files.
- The code editor is a lightweight textarea, not Monaco.
- Preview runs in a sandboxed iframe. Relative CSS and classic script references are inlined; relative module imports, `fetch()` of project files, binary assets, and server APIs are not bundled.
- Firebase is not connected yet. The Firebase directory is reserved for a later stage; do not put secrets in client-side files.
- This is a prototype, not a full Unity/Roblox Studio replacement.
