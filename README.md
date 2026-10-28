# Pixelworks

A browser app for making 3D games and web pages, with a shared Community.

- **Game Studio**: a Three.js scene editor. Add shapes, move/rotate/scale them, give each object a script, and press **Play** to test it.
- **Site Builder**: a blank canvas with HTML, CSS and JS, a live preview, and templates.
- **Community**: publish games and sites, browse what others shared, and open a copy or add someone's objects to your game.

Everything is plain HTML, CSS and JavaScript. There is no build step. Three.js is vendored in `vendor/`.

## Where it runs

Pixelworks only runs at:

- https://yourneighborhoodyapper5-hash.github.io/PIXELS-/

`js/allowlist.js` holds this address. On any other address, `js/main.js` shows a "can only run on its official site" message and does not load the app.

## Deploy to GitHub Pages

1. Push this folder to the `PIXELS-` repo (`https://github.com/yourneighborhoodyapper5-hash/PIXELS-.git`) so the files sit at the repo root.
2. In the repo go to **Settings → Pages**, choose **Deploy from a branch**, pick `main` and `/ (root)`.
3. Wait for the Pages build, then open the URL above.

## Turn on community (free Firebase)

GitHub Pages only serves static files, so accounts and shared content live in Firebase.

1. Go to <https://console.firebase.google.com> and create a project.
2. **Build → Authentication → Get started**, then enable the **Google** provider.
3. Under **Authentication → Settings → Authorized domains**, make sure only `yourneighborhoodyapper5-hash.github.io` (plus the default `localhost`, which you can remove) is listed.
4. **Build → Firestore Database → Create database**. Open its **Rules** tab and paste in the contents of `firestore.rules`.
5. **Project settings → General → Your apps → Web (</>)**. Register an app and copy its `firebaseConfig` into `js/config.js` (replace `null`).
6. **Build → App Check → Get started.** Register the web app with **reCAPTCHA v3** and add only `yourneighborhoodyapper5-hash.github.io` as a domain. Copy the site key into `appCheckSiteKey` in `js/config.js`.
7. In App Check, open the **Cloud Firestore** API and click **Enforce**. Requests without a valid token from the allowed domain are then rejected.

Reload the app and the Community tab will work. Test it from the live site first: enforcing App Check before the key is in place will block the Community tab.

## Game scripts

Each object can have a script that runs every frame during Play:

```js
// obj   the object's Three.js mesh (move it, rotate it, change obj.material.color)
// dt    seconds since the last frame
// t     total seconds since Play started
// input.keys            which keys are held, e.g. input.keys.KeyW, input.keys.Space
// input.player          a copy of the player's feet position
// THREE                 the Three.js namespace
obj.rotation.y += dt;
```

A **Spawn** object sets where the player starts. Solid objects (cubes, spheres, cylinders and floors) block the player. Spawn points do not.

Scripts run in the page itself, so only load code you trust. Sites in the Site Builder run inside a sandboxed iframe.

## Project layout

```
index.html          app shell and the three sections
css/style.css       styles
js/main.js          address gate, then loads the app
js/allowlist.js     the one address allowed to run the app
js/app.js           mode switching, wires the modules together
js/studio.js        Game Studio (Three.js editor and Play mode)
js/site.js          Site Builder (code editors, live preview, templates)
js/community.js     Firebase sign-in, publish and browse
js/config.js        your Firebase config and App Check key (null = community off)
firestore.rules     Firestore security rules
vendor/three/       Three.js r170 (module build + OrbitControls and TransformControls)
```

## Limits

- The address check runs in the browser, so someone who copies the files can run them elsewhere. Firebase is what protects the data: App Check (enforced for Firestore) rejects database requests from pages not on the allowed domain, and Authorized domains limits sign-in to the Pages host.
- App Check's reCAPTCHA domain list is checked by Google, not by this code, and a determined attacker can still script requests with a valid token from a domain they control. Treat it as a strong filter, not a perfect lock.
- Community uploads are stored as Firestore documents, capped at about 900 KB each. Large assets such as textures or models would need Firebase Storage (which may require the paid Blaze plan).
- Play mode uses simple box-style collisions and no physics engine.
- The editor is built for desktop screens. It is usable on a phone, but cramped.
