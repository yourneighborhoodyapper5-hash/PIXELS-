import { initializeApp } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-app.js';
import { getAuth, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut as firebaseSignOut } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-auth.js';
import { getFirestore, collection, doc, getDocs, query, setDoc, where } from 'https://www.gstatic.com/firebasejs/12.4.0/firebase-firestore.js';

// Firebase web config is public by design. Never put Admin SDK credentials here.
const firebaseConfig = {
  apiKey: 'AIzaSyDNsB5nAjWzTVuP1HnWnxmBhMCZR21BYsQ',
  authDomain: 'pixel-storage-7e9bd.firebaseapp.com',
  projectId: 'pixel-storage-7e9bd',
  storageBucket: 'pixel-storage-7e9bd.firebasestorage.app',
  messagingSenderId: '617800846844',
  appId: '1:617800846844:web:442dd97c47400427ac7679',
  measurementId: 'G-TNJ48MVSCD'
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
let currentUser = null;
const listeners = new Set();
export const firebaseReady = new Promise(resolve => {
  onAuthStateChanged(auth, user => {
    currentUser = user;
    for (const fn of listeners) fn(user);
    resolve(user);
  });
});
export const getCurrentUser = () => currentUser;
export function onAuthChange(fn) {
  listeners.add(fn);
  fn(currentUser);
  return () => listeners.delete(fn);
}
export async function signInOrCreate(email, password, create) {
  if (create) return (await createUserWithEmailAndPassword(auth, email, password)).user;
  return (await signInWithEmailAndPassword(auth, email, password)).user;
}
export async function signOut() { await firebaseSignOut(auth); }
function requireUser() {
  if (!currentUser) throw new Error('Sign in first.');
  return currentUser;
}
export async function saveCloudProject(project) {
  const user = requireUser();
  const data = JSON.stringify(project);
  if (data.length >= 900000) throw new Error('This project is too large for the current Firestore document limit.');
  await setDoc(doc(db, 'creations', project.id), {
    authorId: user.uid,
    kind: 'game',
    title: String(project.name || 'Untitled').slice(0, 80),
    data,
    updated: Date.now()
  });
}
export async function listCloudProjects() {
  const user = requireUser();
  const result = await getDocs(query(collection(db, 'creations'), where('authorId', '==', user.uid)));
  return result.docs.map(item => {
    const data = item.data();
    let project;
    try { project = JSON.parse(data.data); } catch { project = null; }
    return project ? { id: item.id, name: data.title || project.name || 'Untitled', updated: data.updated || 0, project } : null;
  }).filter(Boolean).sort((a, b) => b.updated - a.updated);
}
