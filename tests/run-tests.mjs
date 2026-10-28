// Run with:  node tests/run-tests.mjs      (Node 20+, no dependencies, no network)
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');
let passed = 0, failed = 0;
const test = async (name, fn) => {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; console.log('  FAIL ' + name + '\n       ' + (e.message || e).split('\n')[0]); }
};

const jsFiles = fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js'));

console.log('Static checks');
await test('every js/*.js file has valid module syntax (no stray newlines in strings etc.)', async () => {
  const { execFileSync } = await import('node:child_process');
  for (const f of jsFiles) execFileSync(process.execPath, ['--check', '--input-type=module'], { input: read('js/' + f), stdio: ['pipe', 'pipe', 'pipe'] });
});
await test('no garbled (mojibake) characters in source files', () => {
  for (const f of [...jsFiles.map(f => 'js/' + f), 'index.html', 'css/app.css']) {
    const m = read(f).match(/[\u00c2-\u00f4][\u0080-\u00bf]/);
    assert.equal(m, null, `${f} contains garbled text: ${m && JSON.stringify(m[0])}`);
  }
});
await test('index.html starts the app through js/bootstrap.js, which imports main.js', () => {
  assert.match(read('index.html'), /<script type="module" src="js\/bootstrap\.js">/);
  assert.match(read('js/bootstrap.js'), /import\('\.\/main\.js'\)\.catch\(showStartupError\)/);
});
await test('relative imports resolve to real files and named imports are really exported', () => {
  for (const f of jsFiles) {
    const src = read('js/' + f);
    for (const m of src.matchAll(/import\s*\{([^}]+)\}\s*from\s*'(\.\/[^']+)'/g)) {
      const target = path.join(root, 'js', m[2]);
      assert.ok(fs.existsSync(target), `${f}: missing ${m[2]}`);
      const exported = fs.readFileSync(target, 'utf8');
      for (let name of m[1].split(',').map(x => x.trim()).filter(Boolean)) {
        name = name.split(/\s+as\s+/)[0];
        assert.match(exported, new RegExp(`export\\s+(?:async\\s+)?(?:function|const|class|let)\\s+${name}\\b`), `${f} imports ${name} but ${m[2]} does not export it`);
      }
    }
  }
});
await test('every element id used by the scripts exists in index.html (or is created in code)', () => {
  const html = read('index.html');
  const have = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
  const created = new Set(['authButton', 'authDialog', 'editor']);
  const used = new Set();
  for (const f of ['main.js', 'community.js']) {
    const src = read('js/' + f);
    for (const m of src.matchAll(/\$\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g)) used.add(m[1]);
    for (const m of src.matchAll(/getElementById\(\s*['"]([A-Za-z0-9_-]+)['"]\s*\)/g)) used.add(m[1]);
  }
  const missing = [...used].filter(id => !have.has(id) && !created.has(id));
  assert.deepEqual(missing, [], 'ids missing from index.html: ' + missing.join(', '));
});
await test('all local asset paths in index.html exist and are relative (GitHub Pages safe)', () => {
  const html = read('index.html');
  for (const m of html.matchAll(/(?:src|href)="([^"#]+)"/g)) {
    if (/^(https?:)?\/\//.test(m[1])) continue;
    assert.ok(!m[1].startsWith('/'), 'absolute path: ' + m[1]);
    assert.ok(fs.existsSync(path.join(root, m[1])), 'missing file: ' + m[1]);
  }
});

console.log('Hierarchy');
const H = await import(pathToFileURL(path.join(root, 'js/hierarchy.js')));
const mk = (id, parentId = null) => ({ id, name: id, type: 'box', parentId, p: [0, 0, 0], r: [0, 0, 0], s: [1, 1, 1] });
await test('parenting loops are rejected (self, child, grandchild)', () => {
  const objs = [mk('a'), mk('b', 'a'), mk('c', 'b'), mk('d')];
  assert.equal(H.canParent(objs, 'a', 'a'), false);
  assert.equal(H.canParent(objs, 'a', 'b'), false);
  assert.equal(H.canParent(objs, 'a', 'c'), false);
  assert.equal(H.canParent(objs, 'a', 'd'), true);
  assert.equal(H.canParent(objs, 'd', 'c'), true);
  assert.deepEqual(H.validParents(objs, 'b').map(o => o.id).sort(), ['a', 'd']);   // not itself, not its child c
});
await test('descendantsOf returns the whole subtree including the root', () => {
  const objs = [mk('a'), mk('b', 'a'), mk('c', 'b'), mk('d')];
  assert.deepEqual([...H.descendantsOf(objs, 'a')].sort(), ['a', 'b', 'c']);
});
await test('treeRows nests children under parents with depth and honours collapsing', () => {
  const objs = [mk('cam', 'cube'), mk('cube'), mk('ground'), mk('x', 'cam')];
  const rows = H.treeRows(objs).map(r => `${r.depth}:${r.object.id}`);
  assert.deepEqual(rows, ['0:cube', '1:cam', '2:x', '0:ground']);
  assert.deepEqual(H.treeRows(objs, new Set(['cube'])).map(r => r.object.id), ['cube', 'ground']);
});
await test('treeRows never loses or loops on corrupt cyclic data', () => {
  const rows = H.treeRows([mk('a', 'b'), mk('b', 'a')]);
  assert.equal(rows.length, 2);
});
await test('cloneSubtree gives fresh ids, keeps structure, keeps the parent of the root', () => {
  const objs = [mk('p'), mk('a', 'p'), mk('b', 'a')];
  objs[1].scripts = [{ id: 's1', file: 'scripts/m.js', enabled: true }];
  let n = 0;
  const copies = H.cloneSubtree(objs, 'a', () => 'new' + n++);
  assert.equal(copies.length, 2);
  assert.equal(copies[0].parentId, 'p');
  assert.equal(copies[1].parentId, copies[0].id);
  assert.ok(!objs.some(o => copies.some(c => c.id === o.id)));
  assert.equal(copies[0].scripts[0].file, 'scripts/m.js');
  assert.notEqual(copies[0].scripts[0].id, 's1');
  assert.equal(objs[1].scripts[0].id, 's1');
});

console.log('Project format / data safety');
const P = await import(pathToFileURL(path.join(root, 'js/project.js')));
const B = await import(pathToFileURL(path.join(root, 'js/behaviors.js')));
await test('an old project (no parentId, no scripts) migrates without losing anything', () => {
  const old = { format: 1, id: 'keep-me', name: 'Old', updated: 5, objects: [{ id: 'c', name: 'Cube', type: 'box', p: [1, 2, 3], color: 255 }],
    assets: [{ id: 'a1', name: 'tex.png', type: 'image/png', size: 3, dataUrl: 'data:image/png;base64,AAAA' }], files: { 'index.html': '<p>hi</p>', 'x.js': '1' } };
  const m = P.migrate(structuredClone(old));
  assert.equal(m.id, 'keep-me'); assert.equal(m.name, 'Old');
  assert.deepEqual(m.objects[0].p, [1, 2, 3]); assert.equal(m.objects[0].color, 255); assert.equal(m.objects[0].parentId, null);
  assert.equal(m.assets[0].dataUrl, old.assets[0].dataUrl); assert.deepEqual(m.files, old.files);
  assert.equal(m.format, 1);
});
await test('migrate keeps valid scripts, drops malformed entries, and breaks parent cycles', () => {
  const m = P.migrate({ objects: [
    { id: 'a', parentId: 'b', scripts: [{ file: 'scripts/m.js' }, { nope: 1 }, null] }, { id: 'b', parentId: 'a' }, { id: 'z', parentId: 'missing' } ] });
  const a = m.objects.find(o => o.id === 'a'), b = m.objects.find(o => o.id === 'b'), z = m.objects.find(o => o.id === 'z');
  assert.equal(a.scripts.length, 1); assert.equal(a.scripts[0].enabled, true); assert.ok(a.scripts[0].id);
  assert.ok(!(a.parentId && b.parentId), 'cycle must be broken');
  assert.equal(z.parentId, null);
});
await test('project JSON round-trips (export then import) unchanged', () => {
  const p = P.newProject('RT'); const o = p.objects[1]; B.attachScript(o, 'scripts/Mover.js'); p.files['scripts/Mover.js'] = B.EXAMPLE_SCRIPT;
  const again = P.migrate(JSON.parse(JSON.stringify(p)));
  assert.deepEqual(again, p);
});
await test('script helpers: safe paths, attach is idempotent, detach never touches files', () => {
  assert.equal(B.safeScriptPath('My Mover!'), 'scripts/My_Mover.js');
  assert.equal(B.safeScriptPath('../../evil'), 'scripts/evil.js');
  assert.equal(B.safeScriptPath('///'), '');
  const o = {}; assert.equal(B.attachScript(o, 'scripts/a.js'), true); assert.equal(B.attachScript(o, 'scripts/a.js'), false);
  const files = { 'scripts/a.js': 'x' }; B.detachScript(o, o.scripts[0].id); assert.equal(o.scripts, undefined); assert.equal(files['scripts/a.js'], 'x');
});
await test('collectScripts skips disabled scripts and reports missing files', () => {
  const proj = { objects: [{ name: 'A', scripts: [{ id: '1', file: 'scripts/a.js', enabled: true }, { id: '2', file: 'scripts/off.js', enabled: false }, { id: '3', file: 'scripts/gone.js', enabled: true }] }], files: { 'scripts/a.js': 'A', 'scripts/off.js': 'B' } };
  const r = B.collectScripts(proj);
  assert.deepEqual(Object.keys(r.sources), ['scripts/a.js']); assert.equal(r.missing.length, 1);
});
await test('the example behavior script is valid JavaScript with start() and update()', () => {
  const fn = new Function('THREE', 'api', '"use strict";\n' + B.EXAMPLE_SCRIPT + '\n;return {start: typeof start==="function"?start:null, update: typeof update==="function"?update:null};');
  const hooks = fn({}, {});
  const obj = { position: { x: 0, clone() { return { x: this.x }; } }, rotation: { y: 0 } };
  hooks.start(obj, {}); hooks.update(obj, 0.5, { time: 0.5 });
  assert.ok(obj.position.x !== 0, 'object should have moved'); assert.ok(obj.rotation.y > 0);
});

console.log('Preview documents');
const V = await import(pathToFileURL(path.join(root, 'js/preview.js')));
await test('code preview inlines the project CSS and JS and installs the console bridge', () => {
  const files = P.STARTER;
  const { html, miss } = V.buildDoc(files, null, 'code');
  assert.deepEqual(miss, []); assert.match(html, /<style>[\s\S]*canvas\{/); assert.match(html, /Game started/); assert.match(html, /postMessage\(\{ forge: 1/);
  assert.ok(!/src="game\.js"/.test(html), 'external script reference must be inlined');
});
await test('code preview reports missing linked files instead of failing silently', () => {
  const { miss } = V.buildDoc({ 'index.html': '<html><head></head><body><script src="nope.js"></script></body></html>' }, null, 'code');
  assert.deepEqual(miss, ['nope.js']);
});
await test('scene preview embeds hierarchy + enabled scripts, but never imported asset data', () => {
  const p = P.newProject('S'); p.assets = [{ id: 'a', name: 'big.png', dataUrl: 'data:image/png;base64,SECRETASSETDATA' }];
  const cube = p.objects.find(o => o.id === 'cube1'), cam = p.objects.find(o => o.type === 'camera');
  cam.parentId = cube.id; B.attachScript(cube, 'scripts/Mover.js'); p.files['scripts/Mover.js'] = B.EXAMPLE_SCRIPT;
  const { html, miss } = V.buildDoc(p.files, p, 'scene');
  assert.deepEqual(miss, []); assert.ok(!html.includes('SECRETASSETDATA')); assert.ok(html.includes('"parentId":"cube1"')); assert.ok(html.includes('scripts/Mover.js'));
});
await test('user script text containing </script> cannot break out of the preview page', () => {
  const p = P.newProject('S'); const cube = p.objects[1]; B.attachScript(cube, 'scripts/e.js'); p.files['scripts/e.js'] = '// </script><img src=x onerror=alert(1)>';
  const { html } = V.buildDoc(p.files, p, 'scene');
  assert.ok(!html.includes('<img src=x'), 'raw markup from a script must be escaped inside the JSON payload');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
