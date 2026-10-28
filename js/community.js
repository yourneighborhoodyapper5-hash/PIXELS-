// Community: sign-in, publish and browse shared games and sites through Firebase.
import { firebaseConfig, appCheckSiteKey } from './config.js';

const VERSION = '10.12.2';
const cdn = (name) => `https://www.gstatic.com/firebasejs/${VERSION}/firebase-${name}.js`;
const COLLECTION = 'creations';
const MAX_CHARS = 900000; // Firestore documents are capped at 1 MiB

let fb = null; // { A (auth module), S (firestore module), auth, db }

export const isConfigured = () => !!firebaseConfig;

async function init() {
  if (fb) return fb;
  if (!firebaseConfig) throw new Error('Community is not set up yet. Follow the "Turn on community" steps in README.md.');
  const [appM, authM, storeM, checkM] = await Promise.all([
    import(cdn('app')),
    import(cdn('auth')),
    import(cdn('firestore')),
    import(cdn('app-check')),
  ]);
  const app = appM.initializeApp(firebaseConfig);
  // App Check: database requests only succeed when they come from a page on a domain
  // whose reCAPTCHA key is registered (the GitHub Pages address). Enforce it in the console.
  if (appCheckSiteKey) {
    checkM.initializeAppCheck(app, {
      provider: new checkM.ReCaptchaV3Provider(appCheckSiteKey),
      isTokenAutoRefreshEnabled: true,
    });
  }
  fb = { A: authM, S: storeM, auth: authM.getAuth(app), db: storeM.getFirestore(app) };
  return fb;
}

const myUid = () => fb?.auth?.currentUser?.uid ?? null;

export async function publish(kind, title, data) {
  const { S, db, auth } = await init();
  if (!auth.currentUser) throw new Error('Sign in first (Community tab).');
  const payload = JSON.stringify(data);
  if (payload.length > MAX_CHARS) throw new Error('That project is too big to publish (limit about 900 KB).');
  await S.addDoc(S.collection(db, COLLECTION), {
    kind,
    title: (title || 'Untitled').slice(0, 80),
    data: payload,
    authorId: auth.currentUser.uid,
    authorName: auth.currentUser.displayName || 'Anonymous',
    createdAt: S.serverTimestamp(),
  });
}

async function fetchList() {
  const { S, db } = await init();
  const q = S.query(S.collection(db, COLLECTION), S.orderBy('createdAt', 'desc'), S.limit(60));
  const snap = await S.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function button(label, fn) {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = fn;
  return b;
}

export function initCommunity(root, handlers = {}) {
  const $ = (s) => root.querySelector(s);
  const $$ = (s) => [...root.querySelectorAll(s)];
  const grid = $('#creations');
  const note = $('#setupNote');
  const authBtn = $('#authBtn');
  const authState = $('#authState');
  let kind = 'all';

  if (!isConfigured()) {
    note.hidden = false;
    note.textContent = 'Community needs a free Firebase project. Follow the "Turn on community" steps in README.md, paste your config into js/config.js, and reload. The editors work without it.';
    authBtn.disabled = true;
  }

  function updateAuthUI(user) {
    authState.textContent = user ? `Signed in as ${user.displayName || 'user'}` : 'Not signed in';
    authBtn.textContent = user ? 'Sign out' : 'Sign in with Google';
  }

  authBtn.onclick = async () => {
    try {
      const { A, auth } = await init();
      if (auth.currentUser) await A.signOut(auth);
      else await A.signInWithPopup(auth, new A.GoogleAuthProvider());
    } catch (err) {
      alert(err.message);
    }
  };

  $$('[data-kind]').forEach((b) => (b.onclick = () => {
    kind = b.dataset.kind;
    $$('[data-kind]').forEach((x) => x.classList.toggle('active', x === b));
    refresh();
  }));
  $('#refreshBtn').onclick = () => refresh();

  function parsed(c) {
    return { kind: c.kind, title: c.title, data: JSON.parse(c.data) };
  }

  function card(c) {
    const el = document.createElement('article');
    el.className = 'card';
    const h = document.createElement('h3');
    h.textContent = c.title;
    const meta = document.createElement('p');
    meta.className = 'muted';
    const date = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString() : 'just now';
    meta.textContent = `${c.kind === 'game' ? 'Game' : 'Site'} · by ${c.authorName} · ${date}`;
    const row = document.createElement('div');
    row.className = 'row';
    row.append(button('Open copy', async () => {
      try { handlers.open?.(parsed(c)); } catch (err) { alert('Could not open: ' + err.message); }
    }));
    if (c.kind === 'game') {
      row.append(button('Add its objects to my game', () => {
        try { handlers.merge?.(parsed(c)); } catch (err) { alert('Could not add: ' + err.message); }
      }));
    }
    if (c.authorId && c.authorId === myUid()) {
      row.append(button('Delete', async () => {
        if (!confirm(`Delete "${c.title}" from Community?`)) return;
        try {
          const { S, db } = await init();
          await S.deleteDoc(S.doc(db, COLLECTION, c.id));
          refresh();
        } catch (err) { alert(err.message); }
      }));
    }
    el.append(h, meta, row);
    return el;
  }

  async function refresh() {
    if (!isConfigured()) return;
    grid.textContent = 'Loading…';
    try {
      const items = await fetchList();
      const shown = items.filter((c) => kind === 'all' || c.kind === kind);
      if (!shown.length) {
        const p = document.createElement('p');
        p.className = 'muted';
        p.textContent = 'Nothing shared yet. Publish a game or site from its editor to see it here.';
        grid.replaceChildren(p);
      } else {
        grid.replaceChildren(...shown.map(card));
      }
    } catch (err) {
      grid.textContent = 'Could not load creations: ' + err.message;
    }
  }

  if (isConfigured()) {
    init().then(({ A, auth }) => {
      A.onAuthStateChanged(auth, (user) => {
        updateAuthUI(user);
        refresh();
      });
    }).catch((err) => { grid.textContent = err.message; });
  }

  return { refresh };
}
