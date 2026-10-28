# Hosted app smoke tests

Open the hosted app: https://yourneighborhoodyapper5-hash.github.io/PIXELS-/

- [ ] Scene viewport appears and the hierarchy lists the starter objects.
- [ ] Select Cube in the hierarchy; inspector shows transform fields.
- [ ] Add a sphere, move it, then delete it.
- [ ] Edit `game.js`, click Run, and confirm the bouncing circle appears (Run executes the project's own HTML/CSS/JS).
- [ ] Click Stop and confirm the preview goes blank.
- [ ] Confirm preview console output appears in Console.
- [ ] Reload and confirm local autosave is available in the same browser.
- [ ] Export project ZIP and verify it contains `index.html`, `style.css`, `game.js`, and `forge-project.json`.
- [ ] Sign in, cloud-save a project, then cloud-open it.
- [ ] Test the Scene and Inspector drawers on a phone.
- [ ] Right-click a hierarchy row or an object in the viewport: Rename, Duplicate, Set Parent, Unparent, Delete Object all work.
- [ ] Parent Main Camera to the Cube; confirm it is indented under the Cube and that Unparent restores its world position.
- [ ] Try to parent an object to its own child; confirm that child is not offered.
- [ ] Select the Cube, click `+ New script`, then Play Scene; confirm the cube moves. Disable the script and confirm it stops moving.
- [ ] Put `throw new Error('x')` in `update()` and confirm one error line appears in Console naming the script and object.
- [ ] Open an older saved project and confirm assets and files are all still present.

## Automated checks

`node tests/run-tests.mjs` (Node 20+, no install, no network) checks syntax, imports/exports, element ids, hierarchy rules, project migration and preview document generation. It does not render WebGL; use the checklist above for that.
