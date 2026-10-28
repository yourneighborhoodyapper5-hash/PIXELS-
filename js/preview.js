
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

  html = /<head[^>]*>/i.test(html)
    ? html.replace(/<head[^>]*>/i, match => match + BRIDGE)
    : BRIDGE + html;

  return { html, miss: missing };
}

function buildSceneDocument(project) {
  const safeProject = JSON.stringify(project)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
*{box-sizing:border-box}
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#171719}
body{font:12px system-ui,sans-serif;color:#eee}
#stage{position:absolute;inset:0}
#status{position:absolute;left:12px;bottom:12px;padding:7px 10px;
background:#171719dd;border:1px solid #ffffff20;border-radius:7px;
pointer-events:none}
</style>
</head>
<body>
<div id="stage"></div>
<div id="status">Starting preview…</div>
${BRIDGE}
<script type="module">
import * as THREE from
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const project = ${safeProject};
const host = document.getElementById('stage');
const status = document.getElementById('status');

try {
  const objects = Array.isArray(project.objects) ? project.objects : [];

  const mainCamera =
    objects.find(o => o.type === 'camera' &&
      o.name === 'Main Camera' && o.visible !== false) ||
    objects.find(o => o.type === 'camera' && o.visible !== false);

  if (!mainCamera) {
    throw new Error('No visible camera found. Add a Camera to the scene.');
  }

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x171719);

  const camera = new THREE.PerspectiveCamera(
    THREE.MathUtils.clamp(Number(mainCamera.fov) || 60, 20, 120),
    1,
    0.05,
    2000
  );

  camera.position.fromArray(mainCamera.p || [6, 4, 6]);
  camera.rotation.order = 'XYZ';
  camera.rotation.set(...(mainCamera.r || [0, 0, 0]));
  camera.updateProjectionMatrix();

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x45454c, 2));

  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(5, 9, 6);
  sun.castShadow = true;
  scene.add(sun);

  function geometryFor(object) {
    switch (object.type) {
      case 'plane':
        return new THREE.PlaneGeometry(1, 1);
      case 'sphere':
        return new THREE.SphereGeometry(0.5, 32, 20);
      case 'cylinder':
        return new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
      case 'cone':
        return new THREE.ConeGeometry(0.5, 1, 24);
      default:
        return new THREE.BoxGeometry(1, 1, 1);
    }
  }

  for (const object of objects) {
    if (!object || object.visible === false) continue;
    if (object.type === 'camera') continue;

    if (object.type === 'light') {
      const light = new THREE.PointLight(
        object.color ?? 0xffffff,
        2,
        15
      );

      light.position.fromArray(object.p || [0, 0, 0]);
      scene.add(light);
      continue;
    }

    const material = new THREE.MeshStandardMaterial({
      color: object.color ?? 0x9a9aa3,
      roughness: object.rough ?? 0.6,
      metalness: object.metal ?? 0,
      side: object.type === 'plane'
        ? THREE.DoubleSide
        : THREE.FrontSide
    });

    const mesh = new THREE.Mesh(geometryFor(object), material);

    mesh.position.fromArray(object.p || [0, 0, 0]);
    mesh.rotation.set(...(object.r || [0, 0, 0]));
    mesh.scale.fromArray(object.s || [1, 1, 1]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.name = object.name || object.type;

    scene.add(mesh);
  }

  function resize() {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  if ('ResizeObserver' in window) {
    new ResizeObserver(resize).observe(host);
  }

  window.addEventListener('resize', resize);
  resize();

  status.textContent = 'Camera: ' + mainCamera.name;
  console.info('3D preview ready using ' + mainCamera.name);

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
  });
} catch (error) {
  status.textContent = 'Preview failed: ' + error.message;
  console.error(error.stack || error.message);
}
<\/script>
</body>
</html>`;
}

export function buildDoc(files, project = null) {
  if (project) {
    return {
      html: buildSceneDocument(project),
      miss: []
    };
  }

  return buildCodeDocument(files);
}

export function run(frame, files, project = null) {
  const { html, miss } = buildDoc(files, project);
  frame.srcdoc = html;
  return miss;
}

export const stop = frame => {
  frame.srcdoc = '';
};
