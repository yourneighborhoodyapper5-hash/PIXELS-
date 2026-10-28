# Forge project format v1

A project is a JSON object with `format`, `id`, `name`, `updated`, `objects`, and `files` fields. `objects` contains scene object records with `id`, `name`, `type`, `visible`, `p` (position), `r` (Euler rotation in radians), `s` (scale), and optional material properties. `files` maps relative paths to text contents.

Do not put absolute paths or `..` traversal paths in project filenames. Keep exported game files under the project root.
