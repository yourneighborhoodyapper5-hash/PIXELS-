# Forge Studio

Forge Studio is a browser-based game editor hosted on GitHub Pages. Open the live app at:

**https://yourneighborhoodyapper5-hash.github.io/PIXELS-/**

## Included features

- 3D scene viewport with object hierarchy, transforms, materials, and visibility.
- Parent/child hierarchy with a right-click menu (Rename, Duplicate, Set Parent, Unparent, Delete Object).
- Script behaviors on objects (`start`/`update`/`stop`), run in the sandboxed **Play Scene** preview.
- Built-in code editor and sandboxed preview: **Run** executes the project's HTML/CSS/JS, **Stop** ends it.
- Local autosave in the current browser.
- Optional Firebase Authentication and Firestore cloud projects.
- Project JSON import and ZIP export.
- Undo/redo and mobile-friendly side panels.

## Enable cloud projects

Follow [Firebase setup](firebase/README.md). Local editing and export remain available if you don't sign in.

## Notes

- Cloud projects are private to the signed-in owner under the included Firestore rules.
- This is an evolving browser editor, not a full Unity or Roblox Studio replacement.
- The preview runs untrusted project code in a sandboxed iframe.
