// Firebase web config is public by design. Never put Admin SDK credentials here.
const firebaseConfig = {
  apiKey: 'AIzaSyDNsB5nAjWzTVuP1HnWnxmBhMCZR21BYsQ',
  authDomain: 'pixel-storage-7e9bd.firebaseapp.com',
  projectId: 'pixel-storage-7e9bd',
  storageBucket: 'pixel-storage-7e9bd.firebasestorage.app',
  messagingSenderId: '617800846844',
  appId: '1:617800846844:web:67ad08fe50ebeb74ac7679',
  measurementId: 'G-22DYLG5M89'
};

const SDK = 'https://www.gstatic.com/firebasejs/12.4.0/';
let sdk = null, auth = null, db = null, loading = null;
let currentUser = null;
const listeners = new Set();

// The Firebase SDK is loaded lazily so a blocked or slow gstatic.com can never stop the editor itself from starting.
function loadFirebase() {
  if (!loading) {
    loading = (async () => {
      const [appMod, authMod, storeMod] = await Promise.all([
        import(SDK + 'firebase-app.js'),
        import(SDK + 'firebase-auth.js'),
        import(SDK + 'firebase-firestore.js')
      ]);
      const app = appMod.initializeApp(firebaseConfig);
      auth = authMod.getAuth(app);
      db = storeMod.getFirestore(app);
      sdk = { ...authMod, ...storeMod };
      return sdk;
    })();
    loading.catch(() => { loading = null; });
  }
  return loading;
}

export const firebaseReady = (async () => {
  try {
    await loadFirebase();
    return await new Promise(resolve => {
      sdk.onAuthStateChanged(auth, user => {
        currentUser = user;
        for (const fn of listeners) fn(user);
        resolve(user);
      });
    });
  } catch (error) {
    console.warn('Firebase unavailable; local editing still works.', error);
    return null;
  }
})();

export const getCurrentUser = () => currentUser;
export function onAuthChange(fn) {
  listeners.add(fn);
  fn(currentUser);
  return () => listeners.delete(fn);
}
export async function signInOrCreate(email, password, create) {
  await loadFirebase();
  if (create) return (await sdk.createUserWithEmailAndPassword(auth, email, password)).user;
  return (await sdk.signInWithEmailAndPassword(auth, email, password)).user;
}
export async function signOut() { await loadFirebase(); await sdk.signOut(auth); }
function requireUser() {
  if (!currentUser) throw new Error('Sign in first.');
  return currentUser;
}
export async function saveCloudProject(project) {
  const user = requireUser();
  await loadFirebase();
  const data = JSON.stringify(project);
  if (data.length >= 900000) throw new Error('This project is too large for the current Firestore document limit.');
  await sdk.setDoc(sdk.doc(db, 'creations', project.id), {
    authorId: user.uid,
    kind: 'game',
    title: String(project.name || 'Untitled').slice(0, 80),
    data,
    updated: Date.now()
  });
}
export async function listCloudProjects() {
  const user = requireUser();
  await loadFirebase();
  const result = await sdk.getDocs(sdk.query(sdk.collection(db, 'creations'), sdk.where('authorId', '==', user.uid)));
  return result.docs.map(item => {
    const data = item.data();
    let project;
    try { project = JSON.parse(data.data); } catch { project = null; }
    return project ? { id: item.id, name: data.title || project.name || 'Untitled', updated: data.updated || 0, project } : null;
  }).filter(Boolean).sort((a, b) => b.updated - a.updated);
}
