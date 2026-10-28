# Firebase setup for the hosted Forge Studio

The app is hosted at https://yourneighborhoodyapper5-hash.github.io/PIXELS-/ and uses the existing Firebase project `pixel-storage-7e9bd`.

## One-time Firebase Console setup

1. Open Firebase Console and select `pixel-storage-7e9bd`.
2. Go to **Build → Authentication → Get started → Sign-in method** and enable **Email/Password**.
3. Go to **Build → Firestore Database → Create database** if a database does not exist yet.
4. In **Authentication → Settings → Authorized domains**, add `yourneighborhoodyapper5-hash.github.io` if it is not already listed.
5. Open **Firestore Database → Rules**, replace the rules with the contents of [firestore.rules](firestore.rules), then click **Publish**.

The browser Firebase configuration is in `js/firebase.js`. Firebase web config is not a secret. Never add service-account keys or Admin SDK credentials to this repository.

## Using cloud projects

- **Sign in** prompts for an email and password. On sign-in, choose whether to create a new account or use an existing one.
- **Cloud save** creates or updates the signed-in user's project.
- **Cloud open** lists that account's saved projects.
- Local autosave continues to work on the current device even when signed out.

Cloud save/load won't work until Authentication and Firestore are enabled and the rules are published. The app will show an error rather than silently pretending a cloud save succeeded.
