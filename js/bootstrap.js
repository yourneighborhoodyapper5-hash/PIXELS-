const showStartupError = error => {
  const panel = document.createElement('pre');
  panel.style.cssText =
    'position:fixed;inset:12px;z-index:999999;overflow:auto;white-space:pre-wrap;' +
    'background:#171719;color:#ffb4b4;border:1px solid #a33;border-radius:8px;' +
    'padding:16px;font:13px/1.5 monospace';
  panel.textContent = 'Forge Studio failed to start. Error:\\n\\n' +
    (error?.stack || error?.message || String(error));
  document.body.append(panel);
  console.error('Forge Studio startup failure:', error);
};
window.addEventListener('error', e => {
  if (e.error) console.error('Runtime error:', e.error);
});
window.addEventListener('unhandledrejection', e => {
  console.error('Unhandled promise rejection:', e.reason);
});
import('./main.js').catch(showStartupError);
