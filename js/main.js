// Gate: checks the address before loading the app.
import { isAllowedUrl, ALLOWED_ORIGIN, ALLOWED_PATH } from './allowlist.js';

if (isAllowedUrl(location.href)) {
  import('./app.js');
} else {
  document.body.replaceChildren();
  const box = document.createElement('main');
  box.style.cssText = 'font:16px system-ui,sans-serif;color:#e6e9f2;background:#13161e;height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center';
  const inner = document.createElement('div');
  const h = document.createElement('h1');
  h.textContent = 'Pixelworks can only run on its official site';
  const p = document.createElement('p');
  p.textContent = `Open ${ALLOWED_ORIGIN}${ALLOWED_PATH}/ instead.`;
  inner.append(h, p);
  box.append(inner);
  document.body.append(box);
}
