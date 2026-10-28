
const $ = id => document.getElementById(id);
const MAX_FILE_SIZE = 20 * 1024 * 1024;

const RESOURCES = [
  ['Kenney', 'Free game assets, models and UI', 'assets models sprites ui', 'https://kenney.nl/assets'],
  ['Poly Haven', 'Textures, HDRIs and 3D models', 'textures models hdr environment', 'https://polyhaven.com'],
  ['ambientCG', 'Materials and PBR textures', 'materials pbr textures', 'https://ambientcg.com'],
  ['OpenGameArt', 'Community-created game assets', 'sprites music models art', 'https://opengameart.org'],
  ['Freesound', 'Sound effects and audio', 'audio sound effects music', 'https://freesound.org'],
  ['itch.io', 'Game assets and asset packs', 'game assets packs sprites', 'https://itch.io/game-assets'],
  ['Three.js Examples', 'Interactive 3D examples', 'three js webgl 3d', 'https://threejs.org/examples/']
];

const allowedTypes = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg',
  'glb', 'gltf', 'obj', 'mtl', 'fbx',
  'wav', 'mp3', 'ogg',
  'mp4', 'webm', 'json', 'txt',
  'hdr', 'exr', 'ttf', 'otf', 'css', 'js'
]);

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function extension(name) {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
}

function formatSize(bytes) {
  return bytes < 1024 * 1024
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function readFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export function setupCommunity({
  getProject,
  markDirty,
  openFile,
  createFile,
  switchView,
  log
}) {
  const project = getProject;

  function renderCommunity() {
    const grid = $('assetGrid');
    if (!grid) return;

    const query = ($('assetSearch')?.value || '').trim().toLowerCase();
    grid.replaceChildren();

    const results = RESOURCES.filter(([name, desc, tags]) =>
      `${name} ${desc} ${tags}`.toLowerCase().includes(query)
    );

    for (const [name, description, , url] of results) {
      const card = make('article', 'asset-card');
      const title = make('strong', '', name);
      const details = make('p', '', description);
      const link = make('a', '', 'Open resource ↗');

      link.href = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';

      card.append(title, details, link);
      grid.append(card);
    }

    if (!results.length) {
      grid.append(make('p', 'empty', 'No matching resources found.'));
    }
  }

  function renderDock() {
    const current = project();
    const filesRoot = $('projectDockFiles');
    const assetsRoot = $('projectDockAssets');
    if (!filesRoot || !assetsRoot) return;

    const query = ($('dockSearch')?.value || '').toLowerCase();
    filesRoot.replaceChildren();
    assetsRoot.replaceChildren();

    filesRoot.append(make('div', 'dock-section-title', 'PROJECT FILES'));

    for (const path of Object.keys(current.files || {}).sort()) {
      if (!path.toLowerCase().includes(query)) continue;

      const row = make('div', 'project-file');
      row.append(
        make('span', 't', '▤'),
        make('span', 'n', path)
      );

      row.title = `Open ${path}`;
      row.tabIndex = 0;
      row.setAttribute('role', 'button');
      row.onclick = () => openFile(path);
      row.onkeydown = e => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openFile(path);
        }
      };

      filesRoot.append(row);
    }

    assetsRoot.append(make('div', 'dock-section-title', 'IMPORTED ASSETS'));

    const assets = Array.isArray(current.assets) ? current.assets : [];

    const filtered = assets.filter(asset =>
      asset.name.toLowerCase().includes(query)
    );

    if (!filtered.length) {
      assetsRoot.append(make('div', 'empty', 'No imported assets yet.'));
    }

    for (const asset of filtered) {
      const row = make('div', 'project-file');
      row.append(
        make('span', 't', '◇'),
        make('span', 'n', `${asset.name} · ${formatSize(asset.size)}`)
      );

      const remove = make('button', '', '×');
      remove.title = `Remove ${asset.name}`;
      remove.onclick = e => {
        e.stopPropagation();

        if (!confirm(`Remove "${asset.name}" from this project?`)) return;

        current.assets = current.assets.filter(a => a.id !== asset.id);
        markDirty();
        renderDock();
        log(`Removed asset: ${asset.name}`);
      };

      row.append(remove);
      assetsRoot.append(row);
    }
  }

  async function importAssets() {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = [...allowedTypes].map(ext => `.${ext}`).join(',');

    input.onchange = async () => {
      const files = [...(input.files || [])];
      if (!files.length) return;

      const current = project();
      if (!Array.isArray(current.assets)) current.assets = [];

      for (const file of files) {
        if (!allowedTypes.has(extension(file.name))) {
          log(`Skipped unsupported file: ${file.name}`, 'warn');
          continue;
        }

        if (file.size > MAX_FILE_SIZE) {
          log(`Skipped ${file.name}: maximum size is 20 MB per file.`, 'warn');
          continue;
        }

        if (current.assets.some(a => a.name === file.name)) {
          log(`Skipped duplicate filename: ${file.name}`, 'warn');
          continue;
        }

        try {
          current.assets.push({
            id: crypto.randomUUID(),
            name: file.name,
            type: file.type || 'application/octet-stream',
            size: file.size,
            dataUrl: await readFile(file)
          });

          log(`Imported asset: ${file.name}`, 'ok');
        } catch (error) {
          log(error.message, 'error');
        }
      }

      markDirty();
      renderDock();
    };

    input.click();
  }

  $('assetSearch')?.addEventListener('input', renderCommunity);
  $('importAsset')?.addEventListener('click', importAssets);
  $('dockImport')?.addEventListener('click', importAssets);
  $('dockSearch')?.addEventListener('input', renderDock);

  $('dockNew')?.addEventListener('click', createFile);

  document.querySelectorAll('[data-bottom]').forEach(button => {
    button.addEventListener('click', () => {
      const showFiles = button.dataset.bottom === 'files';

      document.querySelectorAll('[data-bottom]').forEach(tab => {
        tab.classList.toggle('on', tab === button);
      });

      $('log').hidden = showFiles;
      $('consoleTools').hidden = showFiles;
      $('projectDock').hidden = !showFiles;

      if (showFiles) renderDock();
    });
  });

  return {
    renderCommunity,
    renderDock,
    importAssets
  };
}
