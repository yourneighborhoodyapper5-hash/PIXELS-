# Security notes

- The game preview iframe intentionally omits `allow-same-origin`; treat preview code as untrusted.
- Firestore rules in `firebase/firestore.rules` restrict project reads and writes to the authenticated owner. Publish those rules in Firebase Console before enabling cloud saves.
- Firebase web configuration is public by design. Never add service-account credentials or Admin SDK private keys to this static site.
- The project is a static GitHub Pages site; there is no trusted server-side code in this repository.
