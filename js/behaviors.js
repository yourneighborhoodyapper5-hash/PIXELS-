// Behavior (script component) helpers. Scripts live in project.files; objects only reference them:
//   object.scripts = [{ id, file: 'scripts/Mover.js', enabled: true }]
// Detaching a script never deletes the file, so user code is never lost by editing the hierarchy.

export const EXAMPLE_SCRIPT = `// Behavior script. Runs only inside the sandboxed Play Scene preview.
// Optional functions:
//   start(object, api)        called once when Play Scene starts
//   update(object, dt, api)   called every frame (dt = seconds since last frame)
//   stop(object, api)         called when the preview is stopped
// object is the THREE.Object3D for the scene object this script is attached to.
// api: { THREE, time, keys (Set of pressed KeyboardEvent.code values), scene, log(...) }
const speed = 1.5;    // how fast to move
const distance = 2;   // how far to move from the start position
let origin;

function start(object) {
  origin = object.position.clone();
}

function update(object, dt, api) {
  object.position.x = origin.x + Math.sin(api.time * speed) * distance;
  object.rotation.y += dt;
}
`;

export function newScriptId() {
  return 's-' + crypto.randomUUID().slice(0, 8);
}

export function safeScriptPath(name) {
  let base = String(name || '').trim().replace(/\\/g, '/').split('/').pop().replace(/\.js$/i, '');
  base = base.replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
  return base ? `scripts/${base}.js` : '';
}

export function isSafeProjectPath(path) {
  return typeof path === 'string' && path.length > 0 && !path.startsWith('/') &&
    !path.includes('\\') && !path.split('/').includes('..');
}

// Normalise one object's scripts list in place (used by migrate). Never drops a valid entry.
export function normalizeScripts(object) {
  if (object.scripts == null) return;
  if (!Array.isArray(object.scripts)) { delete object.scripts; return; }
  object.scripts = object.scripts
    .filter(s => s && typeof s === 'object' && typeof s.file === 'string' && s.file)
    .map(s => ({ id: String(s.id || newScriptId()), file: s.file, enabled: s.enabled !== false }));
}

export function attachScript(object, file) {
  if (!Array.isArray(object.scripts)) object.scripts = [];
  if (object.scripts.some(s => s.file === file)) return false;
  object.scripts.push({ id: newScriptId(), file, enabled: true });
  return true;
}

export function detachScript(object, scriptId) {
  if (!Array.isArray(object.scripts)) return;
  object.scripts = object.scripts.filter(s => s.id !== scriptId);
  if (!object.scripts.length) delete object.scripts;
}

// Collect what the preview needs: source text for every referenced script file that exists.
export function collectScripts(project) {
  const sources = {}, missing = [];
  for (const o of project.objects) {
    for (const s of o.scripts || []) {
      if (!s.enabled) continue;
      if (typeof project.files[s.file] === 'string') sources[s.file] = project.files[s.file];
      else missing.push(`${o.name}: ${s.file}`);
    }
  }
  return { sources, missing };
}
