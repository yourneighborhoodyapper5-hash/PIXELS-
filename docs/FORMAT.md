# Forge project format v1

A project is a JSON object with `format`, `id`, `name`, `updated`, `objects`, and `files` fields. `objects` contains scene object records with `id`, `name`, `type`, `visible`, `p` (position), `r` (Euler rotation in radians), `s` (scale), and optional material properties. `files` maps relative paths to text contents.

Do not put absolute paths or `..` traversal paths in project filenames. Keep exported game files under the project root.

## Optional fields (added without changing the format version)

Older projects open unchanged; these fields are simply absent in them. `migrate()` in `js/project.js` fills in safe defaults and never removes data.

- `objects[].parentId` - id of the parent object, or `null`. `p`, `r`, `s` are **local** to the parent. Loops and dangling ids are cleared on load.
- `objects[].scripts` - optional list of behaviors: `{ "id": "s-1a2b3c4d", "file": "scripts/Mover.js", "enabled": true }`. `file` is a key in `files`. Detaching a script never deletes the file.
- `assets[]` - imported assets (`id`, `name`, `type`, `size`, `dataUrl`, optional `p`/`r`/`s`). Deleting a scene object never deletes assets.

Behavior scripts may define `start(object, api)`, `update(object, dt, api)` and `stop(object, api)`. They only run inside the sandboxed **Play Scene** preview.

