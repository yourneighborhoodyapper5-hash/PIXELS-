// Pixelworks entry point: switches between Game Studio, Site Builder and Community.
import { initStudio } from './studio.js';
import { initSite } from './site.js';
import { initCommunity, publish } from './community.js';

const toast = document.getElementById('toast');
let toastTimer;
function flash(msg) {
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.hidden = true), 2800);
}

async function tryPublish(kind, title, data) {
  try {
    await publish(kind, title, data);
    flash(`Published "${title}" to Community`);
  } catch (err) {
    alert('Publish failed: ' + err.message);
  }
}

const studio = initStudio(document.getElementById('studio'), {
  onStatus: flash,
  onPublish: (data) => {
    const title = prompt('Name your game:', 'My game');
    if (title) tryPublish('game', title, data);
  },
});

const site = initSite(document.getElementById('site'), {
  onStatus: flash,
  onPublish: (data) => tryPublish('site', data.name, data),
});

const community = initCommunity(document.getElementById('community'), {
  open(c) {
    if (c.kind === 'game') {
      studio.setData(c.data);
      show('studio');
    } else {
      site.openProject(c.data);
      show('site');
    }
    flash(`Opened your copy of "${c.title}"`);
  },
  merge(c) {
    studio.setData(c.data, { append: true });
    show('studio');
    flash(`Added objects from "${c.title}"`);
  },
});

const MODES = ['studio', 'site', 'community'];
function show(mode) {
  if (mode !== 'studio') studio.stop();
  document.querySelectorAll('.mode').forEach((s) => s.classList.toggle('active', s.id === mode));
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  history.replaceState(null, '', '#' + mode);
  if (mode === 'community') community.refresh();
  window.dispatchEvent(new Event('resize'));
}

document.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => show(b.dataset.mode)));
const start = location.hash.slice(1);
show(MODES.includes(start) ? start : 'studio');
