
export const FORMAT = 1;

export const STARTER = {
  'index.html': '<!DOCTYPE html>\n<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>My Game</title><link rel="stylesheet" href="style.css"></head>\n<body><canvas id="c" width="480" height="320"></canvas><script src="game.js"><\/script></body></html>\n',
  'style.css': 'body{margin:0;background:#111;display:grid;place-items:center;height:100vh}canvas{background:#222;border:1px solid #444;max-width:100%;height:auto}\n',
  'game.js': "const c=document.getElementById('c'),g=c.getContext('2d');\nlet x=60,y=60,vx=2.2,vy=1.7;\nconsole.log('Game started');\nfunction tick(){x+=vx;y+=vy;if(x<10||x>470)vx=-vx;if(y<10||y>310)vy=-vy;g.clearRect(0,0,480,320);g.fillStyle='#ddd';g.beginPath();g.arc(x,y,10,0,7);g.fill();requestAnimationFrame(tick)}tick();\n"
};

function createMainCamera() {
  return {
    id: 'camera-main',
    name: 'Main Camera',
    type: 'camera',
    visible: true,
    p: [6, 4, 6],
    r: [-0.35, 0.78, 0],
    s: [1, 1, 1],
    fov: 60,
    parentId: null
  };
}

function vector(value, fallback) {
  if (!Array.isArray(value) || value.length < 3) return [...fallback];

  return value.slice(0, 3).map((item, index) => {
    const number = Number(item);
    return Number.isFinite(number) ? number : fallback[index];
  });
}

function cleanHierarchy(objects) {
  const ids = new Set(objects.map(object => object.id));

  for (const object of objects) {
    if (
      !object.parentId ||
      !ids.has(object.parentId) ||
      object.parentId === object.id
    ) {
      object.parentId = null;
      continue;
    }

    const visited = new Set([object.id]);
    let parentId = object.parentId;
    let cycle = false;

    while (parentId) {
      if (visited.has(parentId)) {
        cycle = true;
        break;
      }

      visited.add(parentId);

      const parent = objects.find(item => item.id === parentId);
      parentId = parent?.parentId || null;
    }

    if (cycle) object.parentId = null;
  }
}

export function newProject(name = 'Untitled Project') {
  return {
    format: FORMAT,
    id: crypto.randomUUID(),
    name: String(name || 'Untitled Project'),
    updated: Date.now(),

    objects: [
      {
        id: 'ground',
        name: 'Ground',
        type: 'plane',
        visible: true,
        p: [0, -0.05, 0],
        r: [-Math.PI / 2, 0, 0],
        s: [12, 12, 1],
        color: 0x3a3a40,
        rough: 0.9,
        metal: 0,
        parentId: null
      },
      {
        id: 'cube1',
        name: 'Cube',
        type: 'box',
        visible: true,
        p: [0, 0.5, 0],
        r: [0, 0, 0],
        s: [1, 1, 1],
        color: 0x9a9aa3,
        rough: 0.6,
        metal: 0.1,
        parentId: null
      },
      createMainCamera()
    ],

    assets: [],
    files: { ...STARTER }
  };
}

export function migrate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Not a Forge project');
  }

  const project = input;

  if (project.format == null) project.format = FORMAT;

  if (project.format > FORMAT) {
    throw new Error(
      `Project format ${project.format} is newer than this editor supports (${FORMAT})`
    );
  }

  if (typeof project.id !== 'string' || !project.id) {
    project.id = crypto.randomUUID();
  }

  project.name = String(project.name || 'Untitled Project');

  project.updated = Number.isFinite(Number(project.updated))
    ? Number(project.updated)
    : Date.now();

  project.objects = Array.isArray(project.objects)
    ? project.objects.filter(item => item && typeof item === 'object')
    : [];

  project.assets = Array.isArray(project.assets)
    ? project.assets.filter(item => item && typeof item === 'object')
    : [];

  project.files =
    project.files &&
    typeof project.files === 'object' &&
    !Array.isArray(project.files)
      ? project.files
      : { ...STARTER };

  for (const object of project.objects) {
    object.id = String(
      object.id || `obj-${crypto.randomUUID().slice(0, 8)}`
    );

    object.name = String(object.name || object.type || 'Object');
    object.type = String(object.type || 'box');
    object.visible = object.visible !== false;

    object.p = vector(object.p, [0, 0, 0]);
    object.r = vector(object.r, [0, 0, 0]);
    object.s = vector(object.s, [1, 1, 1]);

    object.parentId =
      object.parentId != null ? String(object.parentId) : null;
  }

  if (!project.objects.some(object => object.type === 'camera')) {
    project.objects.push(createMainCamera());
  }

  for (const object of project.objects) {
    if (object.type !== 'camera') continue;

    object.name = String(object.name || 'Main Camera');

    object.fov = Number.isFinite(Number(object.fov))
      ? Math.min(120, Math.max(20, Number(object.fov)))
      : 60;
  }

  cleanHierarchy(project.objects);

  for (const asset of project.assets) {
    asset.id = String(asset.id || crypto.randomUUID());
    asset.name = String(asset.name || 'Imported asset');
    asset.type = String(asset.type || 'application/octet-stream');

    asset.size = Number.isFinite(Number(asset.size))
      ? Number(asset.size)
      : 0;

    asset.p = vector(asset.p, [0, 1, 0]);
    asset.r = vector(asset.r, [0, 0, 0]);
    asset.s = vector(asset.s, [1, 1, 1]);
  }

  return project;
}
