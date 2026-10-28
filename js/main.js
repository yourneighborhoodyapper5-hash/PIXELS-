
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { History } from './history.js';
import { LocalProvider } from './storage.js';
import { newProject, migrate } from './project.js';
import { run as runPreview, stop as stopPreview } from './preview.js';
import { zip, downloadBlob } from './zip.js';
import { setupCommunity } from './community.js';
import {
  getCurrentUser,
  onAuthChange,
  signInOrCreate,
  signOut,
  saveCloudProject,
  listCloudProjects
} from './firebase.js';

const $ = id => document.getElementById(id);
const provider = new LocalProvider();
const history = new History(100);

let project = newProject('My First Game');
let selectedId = project.objects[1]?.id || project.objects[0]?.id || null;
let activeFile = 'game.js';
let openedFiles = new Set(['index.html', 'style.css', 'game.js']);
let dirty = false;
let saveTimer = null;
let suppressHistory = false;

let scene;
let camera;
let renderer;
let orbit;
let gizmo;
let resizeObserver;

let meshes = new Map();
let assetMeshes = new Map();
let transformMode = 'translate';
let worldSpace = true;
let snap = 0;
let community;
let sceneGeneration = 0;

function log(message, level = 'info') {
  const root = $('log');
  if (!root) return;

  const row = document.createElement('div');
  row.className = `l ${level}`;

  const time = document.createElement('i');
  time.textContent = new Date().toLocaleTimeString();

  const text = document.createElement('span');
  text.textContent = String(message);

  row.append(time, text);
  root.append(row);
  root.scrollTop = root.scrollHeight;

  const filter = $('lvl')?.value;

  if (filter === 'warn') {
    row.hidden = !['warn', 'error'].includes(level);
  }

  if (filter === 'error') {
    row.hidden = level !== 'error';
  }
}

window.addEventListener('error', event => {
  if (event.error || event.message) {
    log(
      `JavaScript error: ${event.error?.stack || event.message} ` +
      `(${event.filename || 'unknown'}:${event.lineno || 0})`,
      'error'
    );
  }
});

window.addEventListener('unhandledrejection', event => {
  log(
    `Unhandled promise: ${
      event.reason?.stack ||
      event.reason?.message ||
      String(event.reason)
    }`,
    'error'
  );
});

function setDirty() {
  dirty = true;

  if ($('save')) {
    $('save').textContent = 'Unsaved changes';
  }

  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveProject, 500);
}

async function saveProject() {
  clearTimeout(saveTimer);
  project.updated = Date.now();

  try {
    await provider.put(project);
    dirty = false;

    if ($('save')) {
      $('save').textContent = 'Saved locally';
    }
  } catch (error) {
    if ($('save')) {
      $('save').textContent = 'Save failed';
    }

    log(`Could not save locally: ${error.message}`, 'error');
  }
}

function updateUndoButtons() {
  if ($('bundo')) $('bundo').disabled = !history.canUndo;
  if ($('bredo')) $('bredo').disabled = !history.canRedo;
}

function commit() {
  if (!suppressHistory) {
    history.push(JSON.stringify(project));
  }

  setDirty();
  updateUndoButtons();
  renderTree();
  renderInspector();
  renderFiles();
  community?.renderDock();
}

function restore(serialized) {
  if (!serialized) return;

  try {
    suppressHistory = true;

    project = migrate(JSON.parse(serialized));
    selectedId = project.objects[0]?.id || null;

    activeFile =
      project.files[activeFile] != null
        ? activeFile
        : Object.keys(project.files)[0] || '';

    openedFiles = new Set(
      [...openedFiles].filter(path => path in project.files)
    );

    if (activeFile) openedFiles.add(activeFile);

    syncScene();
    renderTree();
    renderInspector();
    renderFiles();
    renderEditor();
    community?.renderDock();
    setDirty();
  } catch (error) {
    log(`Undo/redo failed: ${error.message}`, 'error');
  } finally {
    suppressHistory = false;
    updateUndoButtons();
  }
}

function addObject(type = 'box') {
  const names = {
    box: 'Cube',
    sphere: 'Sphere',
    plane: 'Plane',
    cylinder: 'Cylinder',
    cone: 'Cone',
    light: 'Point Light',
    camera: 'Camera'
  };

  const object = {
    id: `obj-${crypto.randomUUID().slice(0, 8)}`,
    name: names[type] || 'Object',
    type,
    visible: true,
    p: type === 'camera'
      ? [6, 4, 6]
      : [0, type === 'plane' ? 0 : 0.5, 0],
    r: type === 'camera'
      ? [-0.35, 0.78, 0]
      : type === 'plane'
        ? [-Math.PI / 2, 0, 0]
        : [0, 0, 0],
    s: type === 'plane' ? [4, 4, 1] : [1, 1, 1],
    color: type === 'light' ? 0xffffff : 0x9a9aa3,
    rough: 0.6,
    metal: 0
  };

  if (type === 'camera') object.fov = 60;

  project.objects.push(object);
  selectedId = object.id;

  syncScene();
  commit();
  log(`${object.name} created`, 'ok');
}

function removeSelected() {
  const object = project.objects.find(item => item.id === selectedId);
  if (!object) return;

  project.objects = project.objects.filter(item => item.id !== selectedId);
  selectedId = project.objects[0]?.id || null;

  syncScene();
  commit();
  log(`${object.name} deleted`);
}

function geometryFor(object) {
  switch (object.type) {
    case 'plane':
      return new THREE.PlaneGeometry(1, 1);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 24, 16);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 20);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 20);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

function disposeObject(object) {
  object.traverse?.(child => {
    child.geometry?.dispose();

    if (Array.isArray(child.material)) {
      child.material.forEach(material => material.dispose());
    } else {
      child.material?.dispose?.();
    }
  });
}

function initScene() {
  const host = $('scene');

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x171719);

  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
  camera.position.set(8, 7, 10);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  host.replaceChildren(renderer.domElement);

  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x45454c, 2));

  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(5, 9, 6);
  sun.castShadow = true;
  scene.add(sun);

  scene.add(new THREE.GridHelper(40, 40, 0x4a4a50, 0x303035));

  gizmo = new TransformControls(camera, renderer.domElement);

  gizmo.addEventListener('dragging-changed', event => {
    orbit.enabled = !event.value;
  });

  gizmo.addEventListener('objectChange', () => {
    syncObjectFromMesh();
    renderInspector();
  });

  gizmo.addEventListener('mouseUp', () => {
    syncObjectFromMesh();
    commit();
  });

  const helper =
    typeof gizmo.getHelper === 'function' ? gizmo.getHelper() : gizmo;

  if (helper?.isObject3D) scene.add(helper);

  const resize = () => {
    const width = Math.max(1, host.clientWidth);
    const height = Math.max(1, host.clientHeight);

    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  if ('ResizeObserver' in window) {
    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(host);
  }

  window.addEventListener('resize', resize);
  resize();

  renderer.domElement.addEventListener('pointerdown', event => {
    if (event.button !== 0 || gizmo.dragging) return;

    const rect = renderer.domElement.getBoundingClientRect();

    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );

    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, camera);

    const selectable = [
      ...meshes.values(),
      ...assetMeshes.values()
    ];

    const hits = raycaster.intersectObjects(
      selectable.filter(object => object.userData.objectType !== 'light'),
      true
    );

    if (hits.length) {
      let target = hits[0].object;

      while (target && !target.userData.objectId) {
        target = target.parent;
      }

      if (target?.userData.objectId) {
        selectedId = target.userData.objectId;
        renderTree();
        attachGizmo();
      }
    }
  });

  renderer.domElement.addEventListener('dblclick', () => {
    const object = project.objects.find(item => item.id === selectedId);

    if (!object) return;

    const name = prompt('Rename object', object.name);

    if (name?.trim()) {
      object.name = name.trim();
      commit();
    }
  });

  const tick = () => {
    requestAnimationFrame(tick);

    if (orbit) orbit.update();
    if (renderer && scene && camera) renderer.render(scene, camera);
  };

  tick();
  syncScene();
}

function createCameraModel(object) {
  const group = new THREE.Group();

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.35, 0.25, 0.22),
    new THREE.MeshStandardMaterial({
      color: 0xe6a36b,
      roughness: 0.5
    })
  );

  const lens = new THREE.Mesh(
    new THREE.CylinderGeometry(0.09, 0.13, 0.22, 16),
    new THREE.MeshStandardMaterial({
      color: 0x777780,
      metalness: 0.4
    })
  );

  lens.rotation.x = Math.PI / 2;
  lens.position.z = -0.19;

  const direction = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(0, 0, -2)
    ]),
    new THREE.LineBasicMaterial({ color: 0xe6a36b })
  );

  group.add(body, lens, direction);

  group.traverse(child => {
    child.userData.objectId = object.id;
    child.userData.objectType = 'camera';
  });

  return group;
}

function syncScene() {
  if (!scene) return;

  sceneGeneration++;
  const generation = sceneGeneration;

  for (const mesh of meshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }

  for (const mesh of assetMeshes.values()) {
    scene.remove(mesh);
    disposeObject(mesh);
  }

  meshes.clear();
  assetMeshes.clear();

  for (const object of project.objects) {
    let mesh;

    if (object.type === 'camera') {
      mesh = createCameraModel(object);
    } else if (object.type === 'light') {
      mesh = new THREE.PointLight(object.color ?? 0xffffff, 2, 15);

      const helper = new THREE.Mesh(
        new THREE.SphereGeometry(0.12, 8, 6),
        new THREE.MeshBasicMaterial({
          color: object.color ?? 0xffffff
        })
      );

      mesh.add(helper);
    } else {
      mesh = new THREE.Mesh(
        geometryFor(object),
        new THREE.MeshStandardMaterial({
          color: object.color ?? 0x9a9aa3,
          roughness: object.rough ?? 0.6,
          metalness: object.metal ?? 0,
          side: object.type === 'plane'
            ? THREE.DoubleSide
            : THREE.FrontSide
        })
      );

      mesh.castShadow = true;
      mesh.receiveShadow = true;
    }

    mesh.position.fromArray(object.p || [0, 0, 0]);
    mesh.rotation.set(...(object.r || [0, 0, 0]));
    mesh.scale.fromArray(object.s || [1, 1, 1]);
    mesh.visible = object.visible !== false;

    mesh.userData.objectId = object.id;
    mesh.userData.objectType = object.type;

    scene.add(mesh);
    meshes.set(object.id, mesh);
  }

  loadSceneAssets(generation);
  attachGizmo();
}

function loadSceneAssets(generation) {
  const assets = Array.isArray(project.assets) ? project.assets : [];
  let imageIndex = 0;
  let modelIndex = 0;

  for (const asset of assets) {
    if (!asset?.dataUrl || typeof asset.dataUrl !== 'string') continue;

    const name = String(asset.name || 'Asset');
    const extension = name.split('.').pop().toLowerCase();
    const mime = String(asset.type || '').toLowerCase();

    if (
      ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extension) ||
      mime.startsWith('image/')
    ) {
      const loader = new THREE.TextureLoader();

      loader.load(
        asset.dataUrl,
        texture => {
          if (generation !== sceneGeneration) {
            texture.dispose();
            return;
          }

          texture.colorSpace = THREE.SRGBColorSpace;

          const material = new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: extension === 'png' || extension === 'webp'
          });

          const mesh = new THREE.Mesh(
            new THREE.PlaneGeometry(2, 2),
            material
          );

          mesh.name = name;
          mesh.position.set(2 + imageIndex * 2.4, 1, 0);
          imageIndex++;

          mesh.userData.assetId = asset.id;
          mesh.userData.assetName = name;
          mesh.userData.objectId = `asset-${asset.id || name}`;
          mesh.userData.objectType = 'asset';

          scene.add(mesh);
          assetMeshes.set(mesh.userData.objectId, mesh);
        },
        undefined,
        error => {
          log(`Could not load image asset "${name}".`, 'warn');
        }
      );

      continue;
    }

    if (['glb', 'gltf'].includes(extension)) {
      try {
        const comma = asset.dataUrl.indexOf(',');
        const encoded = comma >= 0 ? asset.dataUrl.slice(comma + 1) : '';
        const binary = atob(encoded);
        const bytes = new Uint8Array(binary.length);

        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }

        const loader = new GLTFLoader();

        loader.parse(
          bytes.buffer,
          '',
          result => {
            if (generation !== sceneGeneration) {
              disposeObject(result.scene);
              return;
            }

            const model = result.scene;

            model.name = name;
            model.position.set(2 + modelIndex * 2.5, 0, 0);
            modelIndex++;

            model.traverse(child => {
              if (child.isMesh) {
                child.castShadow = true;
                child.receiveShadow = true;
              }

              child.userData.assetId = asset.id;
              child.userData.assetName = name;
              child.userData.objectId = `asset-${asset.id || name}`;
              child.userData.objectType = 'asset';
            });

            scene.add(model);
            assetMeshes.set(model.userData.objectId, model);
          },
          error => {
            log(`Could not load 3D model "${name}": ${error.message || error}`, 'warn');
          }
        );
      } catch (error) {
        log(`Could not decode model "${name}": ${error.message}`, 'warn');
      }
    }
  }
}

function syncObjectFromMesh() {
  const object = project.objects.find(item => item.id === selectedId);
  const mesh = meshes.get(selectedId);

  if (!object || !mesh) return;

  object.p = mesh.position.toArray();
  object.r = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z];
  object.s = mesh.scale.toArray();
}

function attachGizmo() {
  if (!gizmo) {
    renderInspector();
    return;
  }

  const mesh = meshes.get(selectedId);

  if (transformMode === 'select' || !mesh) {
    gizmo.detach();
    renderInspector();
    return;
  }

  gizmo.attach(mesh);
  gizmo.setMode(transformMode);
  gizmo.setSpace(worldSpace ? 'world' : 'local');
  gizmo.setTranslationSnap(snap || null);
  gizmo.setScaleSnap(snap || null);
  gizmo.setRotationSnap(snap ? THREE.MathUtils.degToRad(snap * 15) : null);

  renderInspector();
}

function renderTree() {
  const root = $('tree');
  if (!root) return;

  root.replaceChildren();

  const query = $('q')?.value.trim().toLowerCase() || '';

  for (const object of project.objects) {
    if (query && !object.name.toLowerCase().includes(query)) continue;

    const row = document.createElement('div');
    row.className = 'row' + (object.id === selectedId ? ' sel' : '');

    const icon = document.createElement('span');
    icon.className = 't';

    const icons = {
      light: '☼',
      plane: '▱',
      camera: '▣',
      sphere: '●',
      cylinder: '◉',
      cone: '△',
      box: '◇'
    };

    icon.textContent = icons[object.type] || '◇';

    const name = document.createElement('span');
    name.className = 'n';
    name.textContent = object.name;

    const visibility = document.createElement('button');
    visibility.type = 'button';
    visibility.title = 'Toggle visibility';
    visibility.textContent = object.visible === false ? '○' : '●';

    visibility.onclick = event => {
      event.stopPropagation();

      object.visible = object.visible === false;
      const mesh = meshes.get(object.id);

      if (mesh) mesh.visible = object.visible;

      commit();
    };

    row.append(icon, name, visibility);

    row.onclick = () => {
      selectedId = object.id;
      renderTree();
      attachGizmo();
    };

    root.append(row);
  }

  if (!root.children.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No objects';
    root.append(empty);
  }

  for (const [id, mesh] of assetMeshes) {
    const assetName = mesh.userData.assetName || 'Imported asset';

    if (query && !assetName.toLowerCase().includes(query)) continue;

    const row = document.createElement('div');
    row.className = 'row' + (id === selectedId ? ' sel' : '');

    const icon = document.createElement('span');
    icon.className = 't';
    icon.textContent = '▧';

    const name = document.createElement('span');
    name.className = 'n';
    name.textContent = assetName;

    const visibility = document.createElement('button');
    visibility.type = 'button';
    visibility.title = 'Toggle asset visibility';
    visibility.textContent = mesh.visible ? '●' : '○';

    visibility.onclick = event => {
      event.stopPropagation();
      mesh.visible = !mesh.visible;
      visibility.textContent = mesh.visible ? '●' : '○';
    };

    row.append(icon, name, visibility);

    row.onclick = () => {
      selectedId = id;
      renderTree();
      gizmo?.detach();
      renderInspector();
    };

    root.append(row);
  }
}

function field(parent, label, value, change, type = 'number', step = '0.1') {
  const wrap = document.createElement('div');
  wrap.className = 'f';

  const lab = document.createElement('label');
  lab.textContent = label;

  const input = document.createElement('input');
  input.type = type;

  if (type === 'number') {
    input.step = step;
    input.value = Number(value ?? 0);
  } else {
    input.value = value ?? '';
  }

  input.addEventListener('change', () => {
    change(type === 'number' ? Number(input.value) : input.value);
  });

  wrap.append(lab, input);
  parent.append(wrap);

  return input;
}

function renderInspector() {
  const root = $('insp');
  if (!root) return;

  root.replaceChildren();

  const object = project.objects.find(item => item.id === selectedId);

  if (!object) {
    const asset = assetMeshes.get(selectedId);

    if (asset) {
      const heading = document.createElement('div');
      heading.className = 'sec';

      const title = document.createElement('h4');
      title.textContent = 'IMPORTED ASSET';

      const name = document.createElement('p');
      name.textContent = asset.userData.assetName || 'Asset';

      heading.append(title, name);
      root.append(heading);
      return;
    }

    const message = document.createElement('div');
    message.className = 'empty';
    message.textContent = 'Select an object or create one.';
    root.append(message);

    const add = document.createElement('button');
    add.textContent = '+ Add Cube';
    add.onclick = () => addObject('box');
    root.append(add);

    return;
  }

  const section = document.createElement('div');
  section.className = 'sec';

  const heading = document.createElement('h4');
  heading.textContent = 'OBJECT';
  section.append(heading);

  field(section, 'Name', object.name, value => {
    object.name = value;
    commit();
  }, 'text');

  const visibilityRow = document.createElement('label');
  visibilityRow.className = 'f';
  visibilityRow.append(document.createTextNode('Visible'));

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = object.visible !== false;

  check.onchange = () => {
    object.visible = check.checked;

    const mesh = meshes.get(object.id);
    if (mesh) mesh.visible = object.visible;

    commit();
  };

  visibilityRow.append(check);
  section.append(visibilityRow);
  root.append(section);

  for (const [key, title] of [
    ['p', 'POSITION'],
    ['r', 'ROTATION (radians)'],
    ['s', 'SCALE']
  ]) {
    const transformSection = document.createElement('div');
    transformSection.className = 'sec';

    const heading = document.createElement('h4');
    heading.textContent = title;
    transformSection.append(heading);

    const values = object[key] || [0, 0, 0];

    ['X', 'Y', 'Z'].forEach((axis, index) => {
      field(transformSection, axis, values[index], value => {
        object[key][index] = value;

        const mesh = meshes.get(object.id);

        if (mesh) {
          if (key === 'p') mesh.position.fromArray(object.p);
          else if (key === 'r') mesh.rotation.set(...object.r);
          else mesh.scale.fromArray(object.s);
        }

        attachGizmo();
        commit();
      });
    });

    root.append(transformSection);
  }

  if (object.type === 'camera') {
    const cameraSection = document.createElement('div');
    cameraSection.className = 'sec';

    const heading = document.createElement('h4');
    heading.textContent = 'CAMERA SETTINGS';
    cameraSection.append(heading);

    field(cameraSection, 'Field of view', object.fov ?? 60, value => {
      object.fov = Math.max(20, Math.min(120, value));
      commit();
    }, 'number', '1');

    root.append(cameraSection);
  }

  const material = document.createElement('div');
  material.className = 'sec';

  const materialHeading = document.createElement('h4');
  materialHeading.textContent =
    object.type === 'light' ? 'LIGHT COLOR' : 'MATERIAL';

  material.append(materialHeading);

  field(
    material,
    'Color',
    '#' + (object.color ?? 0x9a9aa3).toString(16).padStart(6, '0'),
    value => {
      object.color = parseInt(value.slice(1), 16);

      const mesh = meshes.get(object.id);

      if (mesh?.isLight) {
        mesh.color.set(value);

        if (mesh.children[0]?.material) {
          mesh.children[0].material.color.set(value);
        }
      } else if (mesh?.material?.color) {
        mesh.material.color.set(value);
      } else if (mesh) {
        mesh.traverse?.(child => {
          if (child.material?.color) child.material.color.set(value);
        });
      }

      commit();
    },
    'color'
  );

  if (!['light', 'camera'].includes(object.type)) {
    field(material, 'Roughness', object.rough ?? 0.6, value => {
      object.rough = Math.max(0, Math.min(1, value));

      const mesh = meshes.get(object.id);

      if (mesh?.material) {
        mesh.material.roughness = object.rough;
      }

      commit();
    });

    field(material, 'Metalness', object.metal ?? 0, value => {
      object.metal = Math.max(0, Math.min(1, value));

      const mesh = meshes.get(object.id);

      if (mesh?.material) {
        mesh.material.metalness = object.metal;
      }

      commit();
    });
  }

  root.append(material);

  const remove = document.createElement('button');
  remove.textContent = 'Delete object';
  remove.onclick = removeSelected;
  root.append(remove);
}

function renderFiles() {
  const root = $('flist');
  if (!root) return;

  root.replaceChildren();

  const query = $('fsearch')?.value.toLowerCase() || '';

  for (const path of Object.keys(project.files || {})
    .sort()
    .filter(path => path.toLowerCase().includes(query))) {
    const row = document.createElement('div');

    row.className = 'row' + (path === activeFile ? ' sel' : '');

    const icon = document.createElement('span');
    icon.className = 't';
    icon.textContent = '▤';

    const name = document.createElement('span');
    name.className = 'n';
    name.textContent = path;

    row.append(icon, name);
    row.onclick = () => openFile(path);
    root.append(row);
  }
}

function openFile(path) {
  if (!(path in project.files)) return;

  activeFile = path;
  openedFiles.add(path);

  renderFiles();
  renderEditor();
  switchView('code');
}

function renderEditor() {
  const tabs = $('ctabs');
  tabs.replaceChildren();

  for (const path of [...openedFiles].filter(path => path in project.files)) {
    const tab = document.createElement('div');
    tab.className = 'ct' + (path === activeFile ? ' on' : '');

    const label = document.createElement('span');
    label.textContent = path;

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'tab-close';
    close.textContent = '×';
    close.title = `Close ${path}`;
    close.setAttribute('aria-label', `Close ${path}`);

    close.onclick = event => {
      event.stopPropagation();

      openedFiles.delete(path);

      if (activeFile === path) {
        activeFile = [...openedFiles].find(item => item in project.files) || '';
      }

      renderEditor();
    };

    tab.append(label, close);

    tab.onclick = () => {
      activeFile = path;
      renderEditor();
    };

    tabs.append(tab);
  }

  const host = $('monaco');
  host.replaceChildren();

  if (!activeFile || !(activeFile in project.files)) {
    const message = document.createElement('div');
    message.className = 'msg';
    message.textContent = 'No open tabs. Select a project file to open it.';
    host.append(message);
    return;
  }

  const editor = document.createElement('textarea');
  editor.id = 'editor';
  editor.spellcheck = false;
  editor.autocapitalize = 'off';
  editor.autocomplete = 'off';
  editor.value = String(project.files[activeFile] ?? '');
  editor.setAttribute('aria-label', 'Editing ' + activeFile);

  editor.addEventListener('input', () => {
    project.files[activeFile] = editor.value;
    setDirty();
  });

  editor.addEventListener('keydown', event => {
    if (event.key === 'Tab') {
      event.preventDefault();

      editor.setRangeText(
        '  ',
        editor.selectionStart,
        editor.selectionEnd,
        'end'
      );

      editor.dispatchEvent(new Event('input'));
    }

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      saveProject();
    }
  });

  host.append(editor);
}

function switchView(view) {
  document.querySelectorAll('[data-v]').forEach(button => {
    button.classList.toggle('on', button.dataset.v === view);
  });

  for (const id of ['scene', 'code', 'preview', 'community']) {
    $(id).hidden = id !== view;
  }

  if (view === 'scene' && renderer) {
    renderer.setSize(
      Math.max(1, $('scene').clientWidth),
      Math.max(1, $('scene').clientHeight),
      false
    );
  }

  if (view === 'community') {
    community?.searchPublic?.();
  }
}

function showDock(which) {
  document.querySelectorAll('[data-bottom]').forEach(button => {
    button.classList.toggle('on', button.dataset.bottom === which);
  });

  $('log').hidden = which === 'files';
  $('consoleTools').hidden = which === 'files';
  $('projectDock').hidden = which !== 'files';

  if (which === 'files') community?.renderDock();
}

function safeName(value) {
  return String(value || 'forge-project')
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/^-|-$/g, '') || 'forge-project';
}

function dataUrlToBytes(dataUrl) {
  const raw = atob(String(dataUrl).split(',')[1] || '');
  const output = new Uint8Array(raw.length);

  for (let i = 0; i < raw.length; i++) {
    output[i] = raw.charCodeAt(i);
  }

  return output;
}

function downloadProject() {
  const files = {
    ...project.files,
    'forge-project.json': JSON.stringify(project, null, 2),
    'README.txt': `Forge Studio project: ${project.name}\n`
  };

  const used = new Set(Object.keys(files));

  for (const asset of project.assets || []) {
    const name = String(asset.name || 'asset.bin')
      .replace(/\\/g, '/')
      .split('/')
      .pop()
      .replace(/[^a-zA-Z0-9._ -]/g, '_') || 'asset.bin';

    let destination = `assets/${name}`;
    let number = 2;

    while (used.has(destination)) {
      destination = `assets/${number++}-${name}`;
    }

    used.add(destination);

    try {
      files[destination] = dataUrlToBytes(asset.dataUrl);
    } catch (error) {
      log(`Could not export asset ${name}: ${error.message}`, 'warn');
    }
  }

  downloadBlob(zip(files), safeName(project.name) + '.zip');
  log('Project ZIP exported', 'ok');
}

function resetProjectUI() {
  selectedId = project.objects[0]?.id || null;

  activeFile = project.files['game.js'] !== undefined
    ? 'game.js'
    : Object.keys(project.files)[0] || '';

  openedFiles = new Set(
    Object.keys(project.files).filter(path =>
      ['index.html', 'style.css', 'game.js'].includes(path)
    )
  );

  if (activeFile) openedFiles.add(activeFile);

  history.reset(JSON.stringify(project));

  syncScene();
  renderTree();
  renderInspector();
  renderFiles();
  renderEditor();
  community?.renderDock();

  $('pname').textContent = project.name;
  dirty = false;
  $('save').textContent = 'Saved locally';
}

async function newProjectFlow() {
  if (dirty && !confirm('Discard unsaved changes?')) return;

  const name = prompt('Project name', 'Untitled Project');
  if (name === null) return;

  project = newProject(name.trim() || 'Untitled Project');

  resetProjectUI();
  setDirty();
  switchView('scene');
}

function importProjectFlow() {
  const input = document.createElement('input');

  input.type = 'file';
  input.accept = '.json,application/json';

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    try {
      project = migrate(JSON.parse(await file.text()));

      resetProjectUI();
      setDirty();

      log('Project imported', 'ok');
    } catch (error) {
      log('Project import failed: ' + error.message, 'error');
    }
  };

  input.click();
}

async function openLocalProjectFlow() {
  try {
    const saved = (await provider.list()).sort(
      (a, b) => (b.updated || 0) - (a.updated || 0)
    );

    if (!saved.length) {
      alert('No saved projects found in this browser on this device.');
      return;
    }

    const answer = prompt(
      'Open a saved local project:\n\n' +
      saved.map((item, index) =>
        `${index + 1}. ${item.name || 'Untitled Project'}`
      ).join('\n') +
      '\n\nEnter a number:',
      '1'
    );

    if (answer === null) return;

    const index = Number(answer) - 1;

    if (!Number.isInteger(index) || index < 0 || index >= saved.length) {
      alert('Invalid project number.');
      return;
    }

    if (dirty && !confirm('Replace the current project?')) return;

    project = migrate(saved[index]);
    resetProjectUI();

    log('Opened local project: ' + project.name, 'ok');
  } catch (error) {
    log('Could not open local projects: ' + error.message, 'error');
    alert('Could not open local projects.\n' + error.message);
  }
}

function setupMenus() {
  const groups = [
    ['File', [
      ['New project', newProjectFlow],
      ['Import project JSON', importProjectFlow],
      ['Open saved local project', openLocalProjectFlow],
      ['Save now', saveProject],
      ['Export project ZIP', downloadProject]
    ]],
    ['Create', [
      ['Cube', () => addObject('box')],
      ['Sphere', () => addObject('sphere')],
      ['Plane', () => addObject('plane')],
      ['Cylinder', () => addObject('cylinder')],
      ['Cone', () => addObject('cone')],
      ['Point light', () => addObject('light')],
      ['Camera', () => addObject('camera')],
      ['Delete selected', removeSelected]
    ]],
    ['View', [
      ['Scene', () => switchView('scene')],
      ['Code', () => switchView('code')],
      ['Preview', () => switchView('preview')],
      ['Community', () => switchView('community')],
      ['Project Files', () => showDock('files')],
      ['Console', () => showDock('console')]
    ]],
    ['Help', [
      ['About Forge Studio', () => alert(
        'Forge Studio\nBrowser-based game editor. ' +
        'Projects autosave in this browser. Export a ZIP for backup.'
      )]
    ]]
  ];

  const host = $('menus');
  host.replaceChildren();

  for (const [label, actions] of groups) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;

    button.onclick = () => {
      document.querySelectorAll('.menu-pop').forEach(pop => pop.remove());

      const pop = document.createElement('div');
      pop.className = 'menu-pop';

      const rect = button.getBoundingClientRect();

      pop.style.top = Math.min(innerHeight - 180, rect.bottom) + 'px';
      pop.style.left = Math.max(
        6,
        Math.min(rect.left, innerWidth - 220)
      ) + 'px';

      for (const [name, action] of actions) {
        const item = document.createElement('button');

        item.type = 'button';
        item.textContent = name;

        item.onclick = () => {
          pop.remove();
          action();
        };

        pop.append(item);
      }

      document.body.append(pop);

      const close = event => {
        if (!pop.contains(event.target) && event.target !== button) {
          pop.remove();
          document.removeEventListener('pointerdown', close);
        }
      };

      setTimeout(() => document.addEventListener('pointerdown', close), 0);
    };

    host.append(button);
  }
}

function setupResize() {
  function bind(id, side) {
    $(id).addEventListener('pointerdown', event => {
      if (innerWidth < 821) return;

      const start = event.clientX;
      const width = side === 'left'
        ? $('explorer').offsetWidth
        : $('inspector').offsetWidth;

      const move = current => {
        const delta = current.clientX - start;

        if (side === 'left') {
          $('explorer').style.width =
            Math.max(140, Math.min(360, width + delta)) + 'px';
        } else {
          $('inspector').style.width =
            Math.max(180, Math.min(420, width - delta)) + 'px';
        }
      };

      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
      };

      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  bind('rzL', 'left');
  bind('rzR', 'right');

  $('rzB').addEventListener('pointerdown', event => {
    const startY = event.clientY;
    const height = $('bottom').offsetHeight;

    const move = current => {
      $('bottom').style.flexBasis = Math.max(
        65,
        Math.min(innerHeight * 0.5, height + startY - current.clientY)
      ) + 'px';
    };

    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
}

function setupAuth() {
  const header = $('menubar');

  if (!header || $('authButton')) return;

  const button = document.createElement('button');
  button.id = 'authButton';
  button.type = 'button';
  button.textContent = 'Sign in';
  button.style.cssText = 'margin-left:8px;white-space:nowrap';
  header.append(button);

  const panel = document.createElement('dialog');
  panel.id = 'authDialog';

  panel.style.cssText =
    'background:#1b1b1f;color:#eee;border:1px solid #444;' +
    'border-radius:10px;padding:20px;max-width:calc(100vw - 32px);width:340px';

  panel.innerHTML = `
    <form id="authForm" style="display:grid;gap:10px">
      <h2 id="authTitle" style="margin:0;font-size:18px">Sign in to Forge</h2>
      <p id="authMessage" style="margin:0;color:#aaa;font-size:12px">
        Use your Firebase account to save projects to the cloud.
      </p>
      <label>Email
        <input id="authEmail" type="email" required autocomplete="email"
          style="display:block;width:100%;box-sizing:border-box;margin-top:4px">
      </label>
      <label>Password
        <input id="authPassword" type="password" required minlength="6"
          autocomplete="current-password"
          style="display:block;width:100%;box-sizing:border-box;margin-top:4px">
      </label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button id="authSubmit" type="submit">Sign in</button>
        <button id="authCreate" type="button">Create account</button>
        <button id="authCancel" type="button">Cancel</button>
      </div>
    </form>`;

  document.body.append(panel);

  let createMode = false;

  const form = panel.querySelector('#authForm');
  const message = panel.querySelector('#authMessage');
  const title = panel.querySelector('#authTitle');
  const submit = panel.querySelector('#authSubmit');
  const email = panel.querySelector('#authEmail');
  const password = panel.querySelector('#authPassword');

  const setMode = create => {
    createMode = create;

    title.textContent = create
      ? 'Create a Forge account'
      : 'Sign in to Forge';

    submit.textContent = create ? 'Create account' : 'Sign in';

    password.autocomplete = create
      ? 'new-password'
      : 'current-password';

    message.textContent = create
      ? 'Create an account with your email and a password (6+ characters).'
      : 'Use your Firebase account to save projects to the cloud.';
  };

  button.onclick = () => {
    if (getCurrentUser()) {
      if (confirm('Sign out of Forge Studio?')) {
        signOut().catch(error =>
          log('Sign out failed: ' + error.message, 'error')
        );
      }
    } else {
      setMode(false);
      panel.showModal();
    }
  };

  panel.querySelector('#authCreate').onclick = () => setMode(true);
  panel.querySelector('#authCancel').onclick = () => panel.close();

  form.onsubmit = async event => {
    event.preventDefault();
    submit.disabled = true;

    try {
      await signInOrCreate(email.value.trim(), password.value, createMode);

      panel.close();
      password.value = '';

      log(
        createMode
          ? 'Firebase account created and signed in.'
          : 'Signed in to Firebase.',
        'ok'
      );
    } catch (error) {
      message.textContent = error.message || 'Authentication failed.';
    } finally {
      submit.disabled = false;
    }
  };

  onAuthChange(user => {
    button.textContent = user
      ? 'Sign out (' + (user.email || 'account') + ')'
      : 'Sign in';

    $('cloudSave').disabled = !user;
    $('cloudOpen').disabled = !user;

    $('cloudStatus').textContent = user
      ? 'Signed in · cloud save available'
      : 'Not signed in';
  });

  $('cloudSave').onclick = async () => {
    try {
      await saveCloudProject(project);

      log('Saved project to Firebase Cloud: ' + project.name, 'ok');
      $('cloudStatus').textContent = 'Cloud saved';
    } catch (error) {
      log('Cloud save failed: ' + error.message, 'error');
      alert('Cloud save failed: ' + error.message);
    }
  };

  $('cloudOpen').onclick = async () => {
    try {
      const items = await listCloudProjects();

      if (!items.length) {
        alert('No cloud projects found for this account.');
        return;
      }

      const answer = prompt(
        'Open a cloud project:\n\n' +
        items.map((item, index) => `${index + 1}. ${item.name}`).join('\n') +
        '\n\nEnter a number:',
        '1'
      );

      if (answer === null) return;

      const index = Number(answer) - 1;

      if (!Number.isInteger(index) || index < 0 || index >= items.length) {
        alert('Invalid project number.');
        return;
      }

      if (dirty && !confirm('Replace the current project?')) return;

      project = migrate(items[index].project);
      resetProjectUI();

      log('Opened cloud project: ' + project.name, 'ok');
    } catch (error) {
      log('Cloud open failed: ' + error.message, 'error');
      alert('Cloud open failed: ' + error.message);
    }
  };
}

function setup() {
  setupMenus();
  setupAuth();

  let sceneFailed = false;

  try {
    initScene();
  } catch (error) {
    sceneFailed = true;

    log(
      '3D scene failed: ' + (error.stack || error.message || error),
      'error'
    );

    $('scene').textContent =
      '3D scene unavailable. Code tools may still work.';
  }

  selectedId =
    project.objects.find(object => object.id === selectedId)?.id ||
    project.objects[0]?.id ||
    null;

  activeFile = project.files[activeFile] !== undefined
    ? activeFile
    : Object.keys(project.files)[0] || '';

  history.reset(JSON.stringify(project));

  renderTree();
  renderInspector();
  renderFiles();
  renderEditor();

  community = setupCommunity({
    getProject: () => project,
    markDirty: () => {
      setDirty();
      history.push(JSON.stringify(project));
      updateUndoButtons();
      syncScene();
      renderTree();
      renderInspector();
    },
    openFile,
    createFile: () => $('fnew').click(),
    switchView,
    log
  });

  document.querySelectorAll('[data-v]').forEach(button => {
    button.onclick = () => switchView(button.dataset.v);
  });

  document.querySelectorAll('[data-bottom]').forEach(button => {
    button.onclick = () => showDock(button.dataset.bottom);
  });

  $('q').addEventListener('input', renderTree);
  $('fsearch').addEventListener('input', renderFiles);

  $('fnew').onclick = () => {
    let path = prompt('New file path (example: scripts/player.js)');
    if (!path) return;

    path = path.trim();

    if (
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').includes('..')
    ) {
      return log('Use a safe relative file path without ..', 'warn');
    }

    if (path in project.files) {
      return log('File already exists', 'warn');
    }

    project.files[path] = '';
    activeFile = path;
    openedFiles.add(path);

    commit();
    renderEditor();
    switchView('code');
  };

  $('fren').onclick = () => {
    if (!activeFile) return;

    const path = prompt('Rename file', activeFile)?.trim();

    if (!path || path === activeFile) return;

    if (
      path.startsWith('/') ||
      path.includes('\\') ||
      path.split('/').includes('..') ||
      path in project.files
    ) {
      return log('Invalid path or file already exists', 'warn');
    }

    project.files[path] = project.files[activeFile];
    delete project.files[activeFile];

    openedFiles.delete(activeFile);
    activeFile = path;
    openedFiles.add(path);

    commit();
    renderEditor();
  };

  $('fdel').onclick = () => {
    if (!activeFile || !confirm('Delete ' + activeFile + '?')) return;

    delete project.files[activeFile];
    openedFiles.delete(activeFile);

    activeFile =
      [...openedFiles].find(path => path in project.files) || '';

    commit();
    renderEditor();
  };

  $('bundo').onclick = () => restore(history.undo());
  $('bredo').onclick = () => restore(history.redo());

  document.querySelectorAll('[data-t]').forEach(button => {
    button.onclick = () => {
      transformMode = button.dataset.t;

      document.querySelectorAll('[data-t]').forEach(item => {
        item.classList.toggle('on', item === button);
      });

      if (gizmo && transformMode !== 'select') {
        gizmo.setMode(transformMode);
      }

      if (transformMode === 'select') gizmo?.detach();
    };
  });

  $('space').onclick = () => {
    worldSpace = !worldSpace;
    $('space').textContent = worldSpace ? 'World' : 'Local';
    gizmo?.setSpace(worldSpace ? 'world' : 'local');
  };

  $('snap').onchange = () => {
    snap = Number($('snap').value);
    attachGizmo();
  };

  $('run').onclick = () => {
    try {
      switchView('preview');

      const missing = runPreview(
        $('pframe'),
        project.files,
        project
      );

      if (missing.length) {
        log('Missing linked file(s): ' + missing.join(', '), 'warn');
      }

      log('3D camera preview started', 'ok');
    } catch (error) {
      log('Preview failed: ' + error.message, 'error');
    }
  };

  $('stop').onclick = () => {
    stopPreview($('pframe'));
    log('Preview stopped');
  };

  $('localOpen').onclick = openLocalProjectFlow;
  $('clr').onclick = () => $('log').replaceChildren();

  $('lvl').onchange = () => {
    for (const row of $('log').children) {
      const level = $('lvl').value;

      row.hidden = level === 'warn'
        ? !['warn', 'error'].some(item => row.classList.contains(item))
        : level === 'error'
          ? !row.classList.contains('error')
          : false;
    }
  };

  $('mE').onclick = () => $('explorer').classList.toggle('open');
  $('mI').onclick = () => $('inspector').classList.toggle('open');

  document.addEventListener('keydown', event => {
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(
      document.activeElement?.tagName
    )) return;

    const key = event.key.toLowerCase();

    if (['q', 'w', 'e', 'r'].includes(key)) {
      transformMode = {
        q: 'select',
        w: 'translate',
        e: 'rotate',
        r: 'scale'
      }[key];

      document.querySelectorAll('[data-t]').forEach(button => {
        button.classList.toggle('on', button.dataset.t === transformMode);
      });

      if (transformMode === 'select') {
        gizmo?.detach();
      } else {
        gizmo?.setMode(transformMode);
      }
    }

    if (event.key === 'Delete' || event.key === 'Backspace') {
      removeSelected();
    }

    if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      saveProject();
    }

    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.preventDefault();
      restore(history.undo());
    }

    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      event.preventDefault();
      restore(history.redo());
    }
  });

  window.addEventListener('beforeunload', event => {
    if (dirty) {
      event.preventDefault();
      event.returnValue = '';
    }
  });

  window.addEventListener('message', event => {
    if (event.data?.forge === 1) {
      log(
        event.data.m,
        event.data.k === 'error'
          ? 'error'
          : event.data.k === 'warn'
            ? 'warn'
            : 'info'
      );
    }
  });

  setupResize();

  provider.list().then(list => {
    if (!list.length) return;

    const newest = [...list].sort(
      (a, b) => (b.updated || 0) - (a.updated || 0)
    )[0];

    if (confirm('Open your last saved project "' + newest.name + '"?')) {
      project = migrate(newest);
      resetProjectUI();
    }
  }).catch(error => {
    log('IndexedDB unavailable: ' + error.message, 'warn');
  });

  $('pname').textContent = project.name;

  if (!sceneFailed) {
    log('Forge Studio ready. Local autosave is enabled.', 'ok');
  } else {
    log(
      'Forge Studio loaded with the 3D scene disabled. Other tools may still work.',
      'warn'
    );
  }
}

setup();
