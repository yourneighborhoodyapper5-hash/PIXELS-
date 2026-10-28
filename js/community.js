const $ = id => document.getElementById(id);
const MAX_FILE_SIZE = 20 * 1024 * 1024;
const allowedTypes = new Set(['png','jpg','jpeg','webp','gif','svg','glb','gltf','obj','mtl','fbx','wav','mp3','ogg','mp4','webm','json','txt','hdr','exr','ttf','otf','css','js','zip']);
const fmt = n => n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
const el = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text !== undefined) node.textContent = text; return node; };
const ext = name => String(name).split('.').pop().toLowerCase();
const safeUrl = value => { try { const u = new URL(value, location.href); return ['https:', 'http:'].includes(u.protocol) ? u.href : ''; } catch { return ''; } };

function card({ title, description, thumbnail, url, source, author, license, buttons = [] }) {
  const root = el('article', 'community-card');
  if (thumbnail) {
    const img = el('img'); img.loading = 'lazy'; img.alt = `Preview for ${title}`; img.src = thumbnail;
    img.onerror = () => img.remove(); root.append(img);
  }
  root.append(el('strong', '', title || 'Untitled asset'));
  if (description) root.append(el('p', '', description));
  root.append(el('div', 'asset-owner', [source, author, license].filter(Boolean).join(' Â· ')));
  if (url) { const a = el('a', '', 'View source â'); a.href = safeUrl(url); a.target = '_blank'; a.rel = 'noopener noreferrer'; if (a.href) root.append(a); }
  const actions = el('div', 'actions'); buttons.forEach(button => actions.append(button));
  if (actions.children.length) root.append(actions);
  return root;
}

export function setupCommunity({ getProject, markDirty, openFile, createFile, log }) {
  let publicResults = [];
  function status(message) { const node = $('communityStatus'); if (node) node.textContent = message; }

  async function importIntoProject(files) {
    const project = getProject();
    project.assets = Array.isArray(project.assets) ? project.assets : [];
    for (const file of files) {
      if (!allowedTypes.has(ext(file.name))) { log(`Skipped unsupported file: ${file.name}`, 'warn'); continue; }
      if (file.size > MAX_FILE_SIZE) { log(`Skipped ${file.name}: maximum size is 20 MB.`, 'warn'); continue; }
      if (project.assets.some(asset => asset.name === file.name)) { log(`Skipped duplicate asset name: ${file.name}`, 'warn'); continue; }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error(`Could not read ${file.name}`)); reader.readAsDataURL(file);
      });
      project.assets.push({ id: crypto.randomUUID(), name: file.name, type: file.type || 'application/octet-stream', size: file.size, dataUrl });
      log(`Imported asset: ${file.name}`, 'ok');
    }
    markDirty(); renderDock();
  }

  function renderPublic() {
    const root = $('assetGrid'); root.replaceChildren();
    if (!publicResults.length) { root.append(el('p', 'empty', 'Search Wikimedia Commons for public assets.')); return; }
    for (const item of publicResults) {
      const importButton = el('button', '', 'Import to project');
      importButton.onclick = async () => {
        importButton.disabled = true; importButton.textContent = 'Importingâ¦';
        try {
          const response = await fetch(item.download);
          if (!response.ok) throw new Error(`Download failed (HTTP ${response.status})`);
          const blob = await response.blob();
          if (blob.size > MAX_FILE_SIZE) throw new Error('Asset exceeds the 20 MB import limit.');
          const filename = `${(item.title || 'public-asset').replace(/[\\/:*?"<>|]/g, '_').slice(0, 90)}.${item.extension || 'bin'}`;
          await importIntoProject([new File([blob], filename, { type: blob.type || item.mime || 'application/octet-stream' })]);
          status(`Imported â${filename}â.`);
        } catch (error) {
          status(`Could not import this asset: ${error.message}`);
          log(`Public asset import failed: ${error.message}`, 'warn');
        } finally { importButton.disabled = false; importButton.textContent = 'Import to project'; }
      };
      root.append(card({ ...item, buttons: [importButton] }));
    }
  }

  async function searchPublic() {
    const queryText = $('assetSearch').value.trim();
    if (!queryText) { status('Type an asset name to search.'); $('assetSearch').focus(); return; }
    const button = $('communitySearch'); button.disabled = true; button.textContent = 'Searchingâ¦';
    publicResults = []; renderPublic(); status('Searching Wikimedia Commonsâ¦');
    try {
      const url = new URL('https://commons.wikimedia.org/w/api.php');
      url.search = new URLSearchParams({ action: 'query', generator: 'search', gsrsearch: queryText, gsrnamespace: '6', gsrlimit: '24', prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '360', format: 'json', origin: '*' }).toString();
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Wikimedia returned HTTP ${response.status}`);
      const data = await response.json();
      const pages = Object.values(data.query?.pages || {});
      const clean = value => String(value?.value || '').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim();
      publicResults = pages.map(page => {
        const info = page.imageinfo?.[0] || {}, meta = info.extmetadata || {};
        const title = (page.title || 'Public asset').replace(/^File:/, '');
        const mime = info.mime || '';
        const extension = title.includes('.') ? title.split('.').pop().toLowerCase() : (mime.split('/')[1] || 'bin').replace('jpeg', 'jpg');
        return { title, description: clean(meta.ImageDescription) || 'Public media from Wikimedia Commons.', thumbnail: info.thumburl || info.url, url: info.descriptionurl || info.url, download: info.url, source: 'Wikimedia Commons', author: clean(meta.Artist), license: clean(meta.LicenseShortName) || 'Check source license', extension, mime };
      }).filter(item => item.download && safeUrl(item.download) && allowedTypes.has(item.extension));
      renderPublic();
      status(`${publicResults.length} compatible result(s) found. Import downloads files into your local project; check each source license.`);
      if (!publicResults.length) status('No compatible files found. Try another search term.');
    } catch (error) {
      status(`Search failed: ${error.message}`); log(`Community search failed: ${error.message}`, 'warn');
    } finally { button.disabled = false; button.textContent = 'Search'; }
  }

  function chooseFiles(multiple = true) {
    const input = el('input'); input.type = 'file'; input.multiple = multiple;
    input.accept = [...allowedTypes].map(extension => `.${extension}`).join(',');
    input.onchange = () => importIntoProject([...(input.files || [])]).catch(error => log(error.message, 'error'));
    input.click();
  }

  function renderDock() {
    const project = getProject(), files = $('projectDockFiles'), assets = $('projectDockAssets');
    if (!files || !assets) return;
    files.replaceChildren(); assets.replaceChildren();
    const queryText = ($('dockSearch').value || '').toLowerCase();
    files.append(el('div', 'dock-section-title', 'PROJECT FILES'));
    for (const path of Object.keys(project.files || {}).sort().filter(path => path.toLowerCase().includes(queryText))) {
      const row = el('div', 'project-file'); row.append(el('span', 't', 'â¤'), el('span', 'n', path)); row.title = `Open ${path}`; row.onclick = () => openFile(path); files.append(row);
    }
    assets.append(el('div', 'dock-section-title', 'IMPORTED ASSETS'));
    const items = (project.assets || []).filter(asset => asset.name.toLowerCase().includes(queryText));
    if (!items.length) assets.append(el('div', 'empty', 'No imported assets.'));
    for (const asset of items) {
      const row = el('div', 'project-file'); row.append(el('span', 't', 'â'), el('span', 'n', `${asset.name} Â· ${fmt(asset.size)}`));
      const remove = el('button', '', 'Ã'); remove.title = 'Remove imported asset';
      remove.onclick = event => { event.stopPropagation(); if (!confirm(`Remove â${asset.name}â from this project?`)) return; project.assets = project.assets.filter(item => item.id !== asset.id); markDirty(); renderDock(); log(`Removed asset: ${asset.name}`); };
      row.append(remove); assets.append(row);
    }
  }

  $('assetSearch').addEventListener('keydown', event => { if (event.key === 'Enter') searchPublic(); });
  $('communitySearch').addEventListener('click', searchPublic);
  $('importAsset').addEventListener('click', () => chooseFiles(true));
  $('dockImport').addEventListener('click', () => chooseFiles(true));
  $('dockSearch').addEventListener('input', renderDock);
  $('dockNew').addEventListener('click', createFile);
  document.querySelectorAll('[data-bottom]').forEach(button => button.addEventListener('click', () => {
    const filesVisible = button.dataset.bottom === 'files';
    $('log').hidden = filesVisible; $('consoleTools').hidden = filesVisible; $('projectDock').hidden = !filesVisible;
    document.querySelectorAll('[data-bottom]').forEach(item => item.classList.toggle('on', item === button));
    if (filesVisible) renderDock();
  }));
  renderPublic();
  return { renderDock, importAssets: () => chooseFiles(true), searchPublic };
}
