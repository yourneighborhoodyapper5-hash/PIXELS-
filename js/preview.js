import { collectScripts } from './behaviors.js';


const BRIDGE = `<script>
(() => {
  const send = (k, m) => parent.postMessage({ forge: 1, k, m }, '*');

  ['log', 'info', 'warn', 'error'].forEach(k => {
    const original = console[k];
    console[k] = (...args) => {
      send(k, args.map(value => {
        try {
          return typeof value === 'object'
            ? JSON.stringify(value)
            : String(value);
        } catch {
          return String(value);
        }
      }).join(' '));

      original.apply(console, args);
    };
  });

  addEventListener('error', event => {
    send('error', (event.message || 'Error') + ' (line ' + event.lineno + ')');
  });

  addEventListener('unhandledrejection', event => {
    send('error', 'Unhandled rejection: ' + event.reason);
  });
})();
<\/script>`;

const normalizePath = path =>
  path.replace(/^\.\//, '').split('?')[0];

function escapeHTML(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildCodeDocument(files) {
  let html = files['index.html'];

  if (html == null) {
    throw new Error('Project has no index.html');
  }

  const missing = [];

  html = html.replace(
    /<link[^>]+href=["']([^"']+\.css[^"']*)["'][^>]*>/gi,
    (match, path) => {
      const key = normalizePath(path);

      if (files[key] == null) {
        missing.push(path);
        return match;
      }

      return `<style>/* ${escapeHTML(key)} */\n${files[key]}</style>`;
    }
  );

  html = html.replace(
    /<script([^>]*?)\ssrc=["']([^"']+)["']([^>]*)><\/script>/gi,
    (match, before, path, after) => {
      const key = normalizePath(path);

      if (files[key] == null) {
        missing.push(path);
        return match;
      }

      const source = String(files[key])
        .replace(/<\/script/gi, '<\\/script');

      return `<script${before}${after}>${source}<\/script>`;
    }
  );

  if (/<head[^>]*>/i.test(html)) {
    html = html.replace(/<head[^>]*>/i, match => match + BRIDGE);
  } else if (/<html[^>]*>/i.test(html)) {
    html = html.replace(/<html[^>]*>/i, match => match + '<head>' + BRIDGE + '</head>');
  } else if (/^\s*<!doctype[^>]*>/i.test(html)) {
    html = html.replace(/^\s*<!doctype[^>]*>/i, match => match + BRIDGE);
  } else {
    html = BRIDGE + html;
  }

  return { html, miss: missing };
}

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

// Everything below runs ONLY inside the sandboxed preview iframe (sandbox without allow-same-origin),
// never in the editor page. Behavior scripts are evaluated there.
const SCENE_RUNTIME = String.raw`
const host = document.getElementById('stage');
const status = document.getElementById('status');
const say = text => { status.textContent = text; };
const instances = [];
let renderer = null;

async function main() {
  let THREE;
  try {
    THREE = await import('__THREE_URL__');
  } catch (error) {
    throw new Error('Could not load Three.js from the CDN (offline or blocked?): ' + (error && error.message || error));
  }

  const data = JSON.parse(document.getElementById('forge-data').textContent);
  const objects = Array.isArray(data.objects) ? data.objects : [];

  const camObjects = objects.filter(o => o.type === 'camera' && o.visible !== false);
  const camData = camObjects.find(o => o.name === 'Main Camera') || camObjects[0];
  if (!camData) throw new Error('No visible camera found. Add a Camera to the scene.');

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x171719);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x45454c, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(5, 9, 6);
  sun.castShadow = true;
  scene.add(sun);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  const geometryFor = o => {
    switch (o.type) {
      case 'plane': return new THREE.PlaneGeometry(1, 1);
      case 'sphere': return new THREE.SphereGeometry(0.5, 32, 20);
      case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
      case 'cone': return new THREE.ConeGeometry(0.5, 1, 24);
      default: return new THREE.BoxGeometry(1, 1, 1);
    }
  };

  const nodes = new Map();
  let mainCamera = null;
  for (const o of objects) {
    let node;
    if (o === camData) {
      node = new THREE.PerspectiveCamera(THREE.MathUtils.clamp(Number(o.fov) || 60, 20, 120), 1, 0.05, 2000);
      mainCamera = node;
    } else if (o.type === 'camera') {
      node = new THREE.Object3D();            // secondary cameras are invisible in play mode
    } else if (o.type === 'light') {
      node = new THREE.PointLight(o.color ?? 0xffffff, 2, 15);
    } else {
      node = new THREE.Mesh(geometryFor(o), new THREE.MeshStandardMaterial({
        color: o.color ?? 0x9a9aa3, roughness: o.rough ?? 0.6, metalness: o.metal ?? 0,
        side: o.type === 'plane' ? THREE.DoubleSide : THREE.FrontSide
      }));
      node.castShadow = true;
      node.receiveShadow = true;
    }
    node.name = o.name || o.type;
    node.position.fromArray(o.p || [0, 0, 0]);
    node.rotation.set(...(o.r || [0, 0, 0]));
    node.scale.fromArray(o.s || [1, 1, 1]);
    node.visible = o.visible !== false;
    nodes.set(o.id, node);
  }
  // Transforms are LOCAL, so parents must be linked before rendering.
  for (const o of objects) {
    const node = nodes.get(o.id);
    const parent = o.parentId && o.parentId !== o.id ? nodes.get(o.parentId) : null;
    (parent || scene).add(node);
  }

  const api = {
    THREE, scene, time: 0, keys: new Set(),
    log: (...args) => console.log(...args),
    find: name => { for (const [id, n] of nodes) if (n.name === name) return n; return null; }
  };
  addEventListener('keydown', e => api.keys.add(e.code));
  addEventListener('keyup', e => api.keys.delete(e.code));
  addEventListener('blur', () => api.keys.clear());
  addEventListener('pointerdown', () => window.focus());

  const hook = (inst, name, ...args) => {
    if (!inst.ok || !inst.hooks[name]) return;
    try { inst.hooks[name](inst.node, ...args, api); }
    catch (error) {
      inst.ok = false;
      console.error('[' + inst.file + '] error in ' + name + '() on "' + inst.object.name + '" (script disabled): ' + (error && error.message || error));
    }
  };

  for (const o of objects) {
    for (const s of o.scripts || []) {
      if (s.enabled === false) continue;
      const source = data.scripts[s.file];
      if (typeof source !== 'string') { console.error('Script file not found: ' + s.file + ' (attached to "' + o.name + '")'); continue; }
      try {
        const factory = new Function('THREE', 'api',
          '"use strict";\n' + source +
          '\n;/* ignore browser globals such as window.stop that a script did not define itself */' +
          '\nreturn { start: typeof start === "function" && start !== globalThis.start ? start : null, update: typeof update === "function" && update !== globalThis.update ? update : null, stop: typeof stop === "function" && stop !== globalThis.stop ? stop : null };');
        instances.push({ object: o, file: s.file, node: nodes.get(o.id), hooks: factory(THREE, api), ok: true });
      } catch (error) {
        console.error('[' + s.file + '] could not load on "' + o.name + '": ' + (error && error.message || error));
      }
    }
  }

  const resize = () => {
    const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
    renderer.setSize(w, h, false);
    mainCamera.aspect = w / h;
    mainCamera.updateProjectionMatrix();
  };
  if ('ResizeObserver' in window) new ResizeObserver(resize).observe(host);
  addEventListener('resize', resize);
  resize();

  for (const inst of instances) hook(inst, 'start');

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    api.time += dt;
    for (const inst of instances) hook(inst, 'update', dt);
    renderer.render(scene, mainCamera);
  });

  addEventListener('message', event => {
    if (event.source !== parent || !event.data || !event.data.forgeStop) return;
    renderer.setAnimationLoop(null);
    for (const inst of instances) hook(inst, 'stop');
    say('Stopped');
  });

  say('Playing \u2014 camera: ' + camData.name + ' \u2014 ' + instances.length + ' script(s)');
  console.info('Scene started: ' + objects.length + ' object(s), ' + instances.length + ' behavior(s)');
}

main().catch(error => {
  say('Preview failed: ' + (error && error.message || error));
  console.error((error && error.stack) || String(error));
});
`.replace('__THREE_URL__', THREE_URL);

function jsonForScript(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

function buildSceneDocument(project) {
  const { sources, missing } = collectScripts(project);

  // Only the scene description and script sources go to the preview; imported asset data never does.
  const payload = {
    objects: project.objects.map(o => ({ ...o })),
    scripts: sources
  };

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#171719}
body{font:12px system-ui,sans-serif;color:#eee}
#stage{position:absolute;inset:0}
#stage canvas{display:block;width:100%;height:100%}
#status{position:absolute;left:12px;bottom:12px;padding:7px 10px;background:#171719dd;border:1px solid #ffffff20;border-radius:7px;pointer-events:none}
</style>
${BRIDGE}
</head>
<body>
<div id="stage"></div>
<div id="status">Starting preview…</div>
<script type="application/json" id="forge-data">${jsonForScript(payload)}<\/script>
<script type="module">${SCENE_RUNTIME.replace(/<\/script/gi, '<\\/script')}<\/script>
</body>
</html>`;

  return { html, miss: missing };
}

// mode 'code'  -> the project's own index.html / CSS / JS
// mode 'scene' -> the 3D scene with its behavior scripts
export function buildDoc(files, project = null, mode = 'code') {
  if (mode === 'scene') {
    if (!project) throw new Error('No project to play');
    return buildSceneDocument(project);
  }
  return buildCodeDocument(files);
}

let blankTimer = null;

export function run(frame, files, project = null, mode = 'code') {
  const { html, miss } = buildDoc(files, project, mode);
  clearTimeout(blankTimer);
  frame.srcdoc = html;
  return miss;
}

// Ask the preview to run its stop() hooks and halt, then replace the document so nothing keeps running.
export function stop(frame) {
  try { frame.contentWindow?.postMessage({ forgeStop: 1 }, '*'); } catch {}
  clearTimeout(blankTimer);
  blankTimer = setTimeout(() => { frame.srcdoc = ''; blankTimer = null; }, 80);
}
