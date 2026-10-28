// Site Builder: a blank canvas with HTML/CSS/JS, live preview and templates.
const KEY = 'pixelworks.sites.v1';

export const TEMPLATES = {
  blank: { name: 'Untitled site', html: '', css: '', js: '' },
  landing: {
    name: 'Landing page',
    html: `<header class="hero">
  <h1>Your product name</h1>
  <p>One sentence that explains what you do.</p>
  <a class="btn" href="#">Get started</a>
</header>
<section class="features">
  <div class="card"><h2>Fast</h2><p>Explain a benefit.</p></div>
  <div class="card"><h2>Simple</h2><p>Explain another benefit.</p></div>
  <div class="card"><h2>Free</h2><p>Explain a third one.</p></div>
</section>
<footer>&copy; Your name</footer>`,
    css: `body { margin: 0; font-family: system-ui, sans-serif; color: #1d2330; }
.hero { padding: 80px 20px; text-align: center; background: linear-gradient(135deg, #4f8cff, #8a5cff); color: #fff; }
.hero h1 { font-size: 48px; margin: 0 0 12px; }
.btn { display: inline-block; margin-top: 20px; padding: 12px 22px; background: #fff; color: #3a4cff; border-radius: 8px; text-decoration: none; font-weight: 700; }
.features { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; padding: 40px 20px; }
.card { background: #f4f6fb; padding: 20px; border-radius: 12px; }
footer { text-align: center; padding: 20px; color: #7a8294; }`,
    js: '',
  },
  portfolio: {
    name: 'Portfolio',
    html: `<main>
  <h1>Jane Doe</h1>
  <p>Designer and developer. I build calm, useful things.</p>
  <h2>Work</h2>
  <ul class="work">
    <li><strong>Project one</strong> · A short description</li>
    <li><strong>Project two</strong> · A short description</li>
    <li><strong>Project three</strong> · A short description</li>
  </ul>
  <h2>Contact</h2>
  <p>hello@example.com</p>
</main>`,
    css: `body { margin: 0; font-family: Georgia, serif; background: #faf7f2; color: #222; }
main { max-width: 640px; margin: 60px auto; padding: 0 20px; }
h1 { font-size: 44px; margin-bottom: 4px; }
.work li { padding: 10px 0; border-bottom: 1px solid #e5dfd3; }`,
    js: '',
  },
  game: {
    name: 'Canvas mini-game',
    html: `<canvas id="game" width="480" height="320"></canvas>
<p>Arrow keys move the square. Score: <span id="score">0</span>. Click the preview first to focus it.</p>`,
    css: `body { margin: 0; padding: 16px; font-family: system-ui, sans-serif; background: #13161e; color: #e6e9f2; }
canvas { display: block; background: #1b1f2a; border-radius: 8px; max-width: 100%; }`,
    js: `const c = document.getElementById('game');
const ctx = c.getContext('2d');
const p = { x: 220, y: 140, s: 20 };
let coin = { x: 50, y: 50 };
let score = 0;
const keys = {};
addEventListener('keydown', (e) => (keys[e.key] = true));
addEventListener('keyup', (e) => (keys[e.key] = false));
function loop() {
  if (keys.ArrowLeft) p.x -= 3;
  if (keys.ArrowRight) p.x += 3;
  if (keys.ArrowUp) p.y -= 3;
  if (keys.ArrowDown) p.y += 3;
  p.x = Math.max(0, Math.min(c.width - p.s, p.x));
  p.y = Math.max(0, Math.min(c.height - p.s, p.y));
  if (Math.abs(p.x - coin.x) < p.s && Math.abs(p.y - coin.y) < p.s) {
    score++;
    document.getElementById('score').textContent = score;
    coin = { x: 8 + Math.random() * (c.width - 24), y: 8 + Math.random() * (c.height - 24) };
  }
  ctx.fillStyle = '#1b1f2a';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#4f8cff';
  ctx.fillRect(p.x, p.y, p.s, p.s);
  ctx.fillStyle = '#f2c94c';
  ctx.beginPath();
  ctx.arc(coin.x, coin.y, 8, 0, Math.PI * 2);
  ctx.fill();
  requestAnimationFrame(loop);
}
loop();`,
  },
};

const TAB_LABELS = { html: 'HTML', css: 'CSS', js: 'JavaScript' };

export function buildDoc(s) {
  // Escape the closing script tag so user JS can't end the wrapper early
  const js = (s.js || '').split('</scr' + 'ipt').join('<\\/scr' + 'ipt');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${s.css || ''}</style></head><body>${s.html || ''}<script>${js}</scr${'ipt'}></body></html>`;
}

export function initSite(root, opts = {}) {
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const code = $('#code');
  const frame = $('#preview');
  const list = $('#siteList');
  const nameEl = $('#siteName');
  const status = (m) => opts.onStatus?.(m);

  let sites = load();
  let current = null;
  let tab = 'html';

  function load() {
    try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
  }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(sites)); } catch { status('Storage is full or blocked'); }
  }

  let runTimer, saveTimer;
  function run() {
    clearTimeout(runTimer);
    runTimer = setTimeout(() => { if (current) frame.srcdoc = buildDoc(current); }, 350);
  }
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persist, 500);
  }

  function renderList() {
    list.replaceChildren(...sites.map((s) => {
      const li = document.createElement('li');
      li.textContent = s.name;
      li.className = s === current ? 'sel' : '';
      li.onclick = () => open(s.id);
      return li;
    }));
  }

  function open(id) {
    current = sites.find((s) => s.id === id) || null;
    if (!current) return;
    nameEl.value = current.name;
    setTab(tab);
    renderList();
    run();
  }

  function setTab(t) {
    tab = t;
    $$('[data-tab]').forEach((b) => b.classList.toggle('active', b.dataset.tab === t));
    code.value = current ? current[t] : '';
    code.placeholder = `${TAB_LABELS[t]} goes here`;
  }

  function newSite(tpl = 'blank', name) {
    const t = TEMPLATES[tpl] || TEMPLATES.blank;
    const s = { id: crypto.randomUUID(), name: name || t.name, html: t.html, css: t.css, js: t.js };
    sites.unshift(s);
    persist();
    open(s.id);
    return s;
  }

  function slug(s) {
    return (s.name || 'site').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'site';
  }

  code.addEventListener('input', () => {
    if (!current) return;
    current[tab] = code.value;
    run();
    scheduleSave();
  });
  nameEl.addEventListener('input', () => {
    if (!current) return;
    current.name = nameEl.value || 'Untitled site';
    renderList();
    scheduleSave();
  });
  $$('[data-tab]').forEach((b) => (b.onclick = () => setTab(b.dataset.tab)));
  $('#newSite').onclick = () => newSite($('#templateSel').value);
  $('#siteSave').onclick = () => { persist(); status('Site saved'); };
  $('#siteDownload').onclick = () => {
    if (!current) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([buildDoc(current)], { type: 'text/html' }));
    a.download = `${slug(current)}.html`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#sitePublish').onclick = () => {
    if (!current) return;
    opts.onPublish?.({ format: 'pixelworks-site', name: current.name, html: current.html, css: current.css, js: current.js });
  };
  $('#siteDelete').onclick = () => {
    if (!current || !confirm(`Delete "${current.name}"?`)) return;
    sites = sites.filter((s) => s !== current);
    current = null;
    persist();
    if (sites.length) open(sites[0].id);
    else newSite('blank');
  };

  // Start with the most recent site, or a blank canvas
  if (sites.length) open(sites[0].id);
  else newSite('blank');

  return {
    newSite,
    // Open a copy of a site someone else published
    openProject(d) {
      const s = newSite('blank', (d.name || 'Imported site') + ' (copy)');
      s.html = d.html || '';
      s.css = d.css || '';
      s.js = d.js || '';
      persist();
      open(s.id);
      return s;
    },
  };
}
