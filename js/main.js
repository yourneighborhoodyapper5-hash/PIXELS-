import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { History } from './history.js';
import { LocalProvider } from './storage.js';
import { newProject, migrate } from './project.js';
import { run as runPreview, stop as stopPreview } from './preview.js';
import { zip, downloadBlob } from './zip.js';
import { setupCommunity } from './community.js';
import { getCurrentUser, onAuthChange, signInOrCreate, signOut, saveCloudProject, listCloudProjects } from './firebase.js';

const $ = id => document.getElementById(id);
const provider = new LocalProvider();
const history = new History(100);
let project = newProject('My First Game');
let selectedId = project.objects[1]?.id || project.objects[0]?.id || null;
let activeFile = 'game.js';
let openedFiles = new Set(['index.html', 'style.css', 'game.js']);
let dirty = false, saveTimer = null, suppressHistory = false;
let scene, camera, renderer, orbit, gizmo, resizeObserver;
let meshes = new Map(), assetMeshes = new Map(), transformMode = 'translate', worldSpace = true, snap = 0, sceneGeneration = 0;
let community;

function log(message, level='info') {
  const root = $('log'); if (!root) return;
  const row = document.createElement('div'); row.className = `l ${level}`;
  const time = document.createElement('i'); time.textContent = new Date().toLocaleTimeString();
  const text = document.createElement('span'); text.textContent = String(message);
  row.append(time, text); root.append(row); root.scrollTop = root.scrollHeight;
  const filter = $('lvl')?.value;
  if (filter === 'warn') row.hidden = !['warn','error'].includes(level);
  if (filter === 'error') row.hidden = level !== 'error';
}
window.addEventListener('error', e => { if (e.error || e.message) log(`JavaScript error: ${e.error?.stack || e.message} (${e.filename || 'unknown'}:${e.lineno || 0})`, 'error'); });
window.addEventListener('unhandledrejection', e => log(`Unhandled promise: ${e.reason?.stack || e.reason?.message || String(e.reason)}`, 'error'));
function setDirty() { dirty = true; if ($('save')) $('save').textContent = 'Unsaved changes'; clearTimeout(saveTimer); saveTimer = setTimeout(saveProject, 500); }
async function saveProject() {
  clearTimeout(saveTimer); project.updated = Date.now();
  try { await provider.put(project); dirty = false; $('save').textContent = 'Saved locally'; }
  catch (e) { $('save').textContent = 'Save failed'; log(`Could not save locally: ${e.message}`, 'error'); }
}
function updateUndoButtons() { $('bundo').disabled = !history.canUndo; $('bredo').disabled = !history.canRedo; }
function commit() { if (!suppressHistory) history.push(JSON.stringify(project)); setDirty(); updateUndoButtons(); renderTree(); renderInspector(); renderFiles(); community?.renderDock(); }
function restore(serialized) {
  if (!serialized) return;
  try { suppressHistory = true; project = migrate(JSON.parse(serialized)); selectedId = project.objects[0]?.id || null; activeFile = project.files[activeFile] != null ? activeFile : Object.keys(project.files)[0] || ''; openedFiles = new Set([...openedFiles].filter(p => p in project.files)); if (activeFile) openedFiles.add(activeFile); syncScene(); renderTree(); renderInspector(); renderFiles(); renderEditor(); community?.renderDock(); setDirty(); }
  catch (e) { log(`Undo/redo failed: ${e.message}`, 'error'); }
  finally { suppressHistory = false; updateUndoButtons(); }
}
function addObject(type='box') {
  const names = {box:'Cube',sphere:'Sphere',plane:'Plane',cylinder:'Cylinder',cone:'Cone',light:'Point Light',camera:'Camera'};
  const obj = {id:`obj-${crypto.randomUUID().slice(0,8)}`,name:names[type]||'Object',type,visible:true,p:type==='camera'?[6,4,6]:[0,type==='plane'?0:0.5,0],r:type==='plane'?[-Math.PI/2,0,0]:type==='camera'?[-0.35,0.78,0]:[0,0,0],s:type==='plane'?[4,4,1]:[1,1,1],color:type==='light'?0xffffff:0x9a9aa3,rough:0.6,metal:0};
  if(type==='camera') obj.fov=60;
  project.objects.push(obj); selectedId=obj.id; syncScene(); commit(); log(`${obj.name} created`, 'ok');
}
function descendantsOf(id) {
  const found = new Set([id]); let changed = true;
  while(changed){changed=false;for(const item of project.objects){if(item.parentId&&found.has(item.parentId)&&!found.has(item.id)){found.add(item.id);changed=true}}}
  return found;
}
function removeSelected() {
  const object=project.objects.find(x=>x.id===selectedId);
  if(object){const removed=descendantsOf(object.id);project.objects=project.objects.filter(x=>!removed.has(x.id));selectedId=project.objects[0]?.id||null;syncScene();commit();log(`${object.name} and its children deleted`);return}
  const asset=(project.assets||[]).find(a=>`asset-${a.id||a.name}`===selectedId);
  if(asset){project.assets=project.assets.filter(a=>a!==asset);selectedId=project.objects[0]?.id||null;syncScene();commit();log(`Deleted imported asset: ${asset.name||'Asset'}`,'ok')}
}
function setParent(childId, parentId) {
  const child=project.objects.find(x=>x.id===childId), parent=project.objects.find(x=>x.id===parentId);
  if(!child||!parent||child===parent)return;
  if(descendantsOf(childId).has(parentId)){alert('That would create a parenting loop.');return}
  const childMesh=meshes.get(childId), parentMesh=meshes.get(parentId);
  if(childMesh&&parentMesh){scene.updateMatrixWorld(true);const worldPos=childMesh.getWorldPosition(new THREE.Vector3());const localPos=parentMesh.worldToLocal(worldPos);const worldQuat=childMesh.getWorldQuaternion(new THREE.Quaternion());const parentQuat=parentMesh.getWorldQuaternion(new THREE.Quaternion());const localQuat=parentQuat.invert().multiply(worldQuat);const localRot=new THREE.Euler().setFromQuaternion(localQuat,'XYZ');const worldScale=childMesh.getWorldScale(new THREE.Vector3());const parentScale=parentMesh.getWorldScale(new THREE.Vector3());child.p=localPos.toArray();child.r=[localRot.x,localRot.y,localRot.z];child.s=[worldScale.x/(parentScale.x||1),worldScale.y/(parentScale.y||1),worldScale.z/(parentScale.z||1)];}
  child.parentId=parent.id; syncScene(); commit(); log(`${child.name} is now a child of ${parent.name}`,'ok');
}
function clearParent(childId){const child=project.objects.find(x=>x.id===childId),mesh=meshes.get(childId);if(!child||!child.parentId)return;if(mesh){scene.updateMatrixWorld(true);const p=mesh.getWorldPosition(new THREE.Vector3()),q=mesh.getWorldQuaternion(new THREE.Quaternion()),sc=mesh.getWorldScale(new THREE.Vector3()),r=new THREE.Euler().setFromQuaternion(q,'XYZ');child.p=p.toArray();child.r=[r.x,r.y,r.z];child.s=sc.toArray()}delete child.parentId;syncScene();commit();log('Parent removed','ok')}
function showContextMenu(x,y,id) {
  document.querySelectorAll('.forge-context-menu').forEach(n=>n.remove());
  selectedId=id; renderTree(); attachGizmo();
  const menu=document.createElement('div'); menu.className='forge-context-menu';
  Object.assign(menu.style,{position:'fixed',left:Math.min(x,innerWidth-210)+'px',top:Math.min(y,innerHeight-260)+'px',zIndex:20000,minWidth:'190px',padding:'5px',background:'#202024',border:'1px solid #45454c',borderRadius:'7px',boxShadow:'0 8px 28px #0008',display:'grid',gap:'3px'});
  const add=(label,fn)=>{const b=document.createElement('button');b.type='button';b.textContent=label;Object.assign(b.style,{textAlign:'left',padding:'8px',background:'transparent',color:'#eee',border:'0',borderRadius:'4px'});b.onmouseenter=()=>b.style.background='#37373d';b.onmouseleave=()=>b.style.background='transparent';b.onclick=()=>{menu.remove();fn()};menu.append(b)};
  const obj=project.objects.find(o=>o.id===id);
  add('Rename',()=>{if(!obj)return;const name=prompt('Rename object',obj.name);if(name?.trim()){obj.name=name.trim();commit()}});
  add('Delete selected',removeSelected);
  add('Unparent',()=>clearParent(id));
  add('Set parentâ¦',()=>{if(!obj)return;const choices=project.objects.filter(o=>o.id!==obj.id&&!descendantsOf(obj.id).has(o.id));if(!choices.length){alert('Create another object first.');return}const answer=prompt('Choose parent by number:
'+choices.map((o,i)=>`${i+1}. ${o.name}`).join('
'),'1');if(answer===null)return;const i=Number(answer)-1;if(Number.isInteger(i)&&choices[i])setParent(obj.id,choices[i].id);else alert('Invalid parent number.')});
  add('Duplicate',()=>{if(!obj)return;const copy=structuredClone(obj);copy.id=`obj-${crypto.randomUUID().slice(0,8)}`;copy.name=obj.name+' Copy';copy.p=[(obj.p?.[0]||0)+1,(obj.p?.[1]||0),(obj.p?.[2]||0)];delete copy.parentId;project.objects.push(copy);selectedId=copy.id;syncScene();commit()});
  document.body.append(menu);const close=e=>{if(!menu.contains(e.target)){menu.remove();document.removeEventListener('pointerdown',close)}};setTimeout(()=>document.addEventListener('pointerdown',close),0);
}
function geometryFor(o) { switch(o.type){case 'camera':return new THREE.BoxGeometry(.35,.25,.22);case 'plane':return new THREE.PlaneGeometry(1,1);case 'sphere':return new THREE.SphereGeometry(.5,24,16);case 'cylinder':return new THREE.CylinderGeometry(.5,.5,1,20);case 'cone':return new THREE.ConeGeometry(.5,1,20);default:return new THREE.BoxGeometry(1,1,1);} }
function initScene() {
  const host=$('scene'); scene=new THREE.Scene(); scene.background=new THREE.Color(0x171719); camera=new THREE.PerspectiveCamera(50,1,.1,1000); camera.position.set(8,7,10);
  renderer=new THREE.WebGLRenderer({antialias:true}); renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2)); renderer.shadowMap.enabled=true; host.replaceChildren(renderer.domElement);
  orbit=new OrbitControls(camera,renderer.domElement); orbit.enableDamping=true;
  scene.add(new THREE.HemisphereLight(0xffffff,0x45454c,2)); const sun=new THREE.DirectionalLight(0xffffff,2); sun.position.set(5,9,6); sun.castShadow=true; scene.add(sun); scene.add(new THREE.GridHelper(40,40,0x4a4a50,0x303035));
  gizmo=new TransformControls(camera,renderer.domElement); gizmo.addEventListener('dragging-changed',e=>orbit.enabled=!e.value); gizmo.addEventListener('objectChange',()=>{syncObjectFromMesh();renderInspector()}); gizmo.addEventListener('mouseUp',()=>{syncObjectFromMesh();commit()});
  // Three.js r160 requires adding the TransformControls helper, not the controls instance.
  const transformHelper = typeof gizmo.getHelper === 'function' ? gizmo.getHelper() : gizmo;
  if (transformHelper && transformHelper.isObject3D) scene.add(transformHelper);
  const resize=()=>{const w=Math.max(1,host.clientWidth),h=Math.max(1,host.clientHeight);renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix()};
  if ('ResizeObserver' in window) { resizeObserver=new ResizeObserver(resize); resizeObserver.observe(host); }
  window.addEventListener('resize',resize); resize();
  renderer.domElement.addEventListener('contextmenu',event=>{event.preventDefault();const rect=renderer.domElement.getBoundingClientRect();const mouse=new THREE.Vector2(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);const ray=new THREE.Raycaster();ray.setFromCamera(mouse,camera);const hits=ray.intersectObjects([...meshes.values(),...assetMeshes.values()],true);let id=hits.length?(hits[0].object.userData.objectId||hits[0].object.parent?.userData.objectId):selectedId;if(id)showContextMenu(event.clientX,event.clientY,id)});
  renderer.domElement.addEventListener('pointerdown',event=>{if(event.button!==0||gizmo.dragging)return;const rect=renderer.domElement.getBoundingClientRect();const mouse=new THREE.Vector2(((event.clientX-rect.left)/rect.width)*2-1,-((event.clientY-rect.top)/rect.height)*2+1);const ray=new THREE.Raycaster();ray.setFromCamera(mouse,camera);const hits=ray.intersectObjects([...meshes.values(),...assetMeshes.values()],true);if(hits.length){let target=hits[0].object;while(target&&!target.userData.objectId)target=target.parent;if(target?.userData.objectId){selectedId=target.userData.objectId;renderTree();attachGizmo()}}});
  renderer.domElement.addEventListener('dblclick',()=>{const o=project.objects.find(x=>x.id===selectedId);if(o){const name=prompt('Rename object',o.name);if(name?.trim()){o.name=name.trim();commit()}}});
  const tick=()=>{requestAnimationFrame(tick);orbit.update();renderer.render(scene,camera)}; tick(); syncScene();
}
function dispose3D(root){root.traverse?.(node=>{node.geometry?.dispose();if(Array.isArray(node.material))node.material.forEach(m=>m.dispose());else node.material?.dispose?.()})}
function syncScene() {
  if(!scene)return;
  sceneGeneration++;const generation=sceneGeneration;
  for(const m of meshes.values()){scene.remove(m);dispose3D(m)}
  for(const m of assetMeshes.values()){scene.remove(m);dispose3D(m)}
  meshes.clear();assetMeshes.clear();
  for(const o of project.objects){let m;
    if(o.type==='light'){m=new THREE.PointLight(o.color??0xffffff,2,15);m.add(new THREE.Mesh(new THREE.SphereGeometry(.12,8,6),new THREE.MeshBasicMaterial({color:o.color??0xffffff})));}
    else {m=new THREE.Mesh(geometryFor(o),new THREE.MeshStandardMaterial({color:o.type==='camera'?0xe6a36b:(o.color??0x9a9aa3),roughness:o.rough??.6,metalness:o.metal??0,side:o.type==='plane'?THREE.DoubleSide:THREE.FrontSide}));m.castShadow=true;m.receiveShadow=true;}
    m.name=o.name;m.position.fromArray(o.p||[0,0,0]);m.rotation.set(...(o.r||[0,0,0]));m.scale.fromArray(o.s||[1,1,1]);m.visible=o.visible!==false;m.userData.objectId=o.id;m.userData.objectType=o.type;scene.add(m);meshes.set(o.id,m);
  }
  // Parent transforms are stored as local transforms; child objects move with their parent.
  for(const o of project.objects){if(!o.parentId)continue;const child=meshes.get(o.id),parent=meshes.get(o.parentId);if(child&&parent){scene.remove(child);parent.add(child)}}
  loadSceneAssets(generation);attachGizmo();renderTree();
}
function loadSceneAssets(generation){
  let imageIndex=0,modelIndex=0;
  for(const asset of (Array.isArray(project.assets)?project.assets:[])){
    if(!asset?.dataUrl)continue;const name=String(asset.name||'Imported asset'),ext=name.split('.').pop().toLowerCase(),id=`asset-${asset.id||name}`;
    if(['png','jpg','jpeg','webp','gif','bmp'].includes(ext)||String(asset.type||'').startsWith('image/')){
      new THREE.TextureLoader().load(asset.dataUrl,texture=>{if(generation!==sceneGeneration){texture.dispose();return}texture.colorSpace=THREE.SRGBColorSpace;const m=new THREE.Mesh(new THREE.PlaneGeometry(2,2),new THREE.MeshBasicMaterial({map:texture,side:THREE.DoubleSide,transparent:true}));m.name=name;m.position.fromArray(asset.p||[2+imageIndex++*2.4,1,0]);m.rotation.set(...(asset.r||[0,0,0]));m.scale.fromArray(asset.s||[1,1,1]);m.userData={objectId:id,assetName:name,objectType:'asset'};scene.add(m);assetMeshes.set(id,m);renderTree()},undefined,()=>log(`Could not load asset ${name}`,'warn'));
    }else if(['glb','gltf'].includes(ext)){
      try{const raw=atob(String(asset.dataUrl).split(',')[1]||'');const bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);new GLTFLoader().parse(bytes.buffer,'',result=>{if(generation!==sceneGeneration){dispose3D(result.scene);return}const m=result.scene;m.name=name;m.position.fromArray(asset.p||[2+modelIndex++*2.5,0,0]);m.rotation.set(...(asset.r||[0,0,0]));m.scale.fromArray(asset.s||[1,1,1]);m.traverse(n=>{if(n.isMesh){n.castShadow=true;n.receiveShadow=true}n.userData.objectId=id;n.userData.assetName=name;n.userData.objectType='asset'});scene.add(m);assetMeshes.set(id,m);renderTree()},e=>log(`Could not load model ${name}: ${e.message||e}`,'warn'))}catch(e){log(`Could not decode model ${name}: ${e.message}`,'warn')}
    }
  }
}
function syncObjectFromMesh(){const o=project.objects.find(x=>x.id===selectedId),m=meshes.get(selectedId)||assetMeshes.get(selectedId);if(!m)return;const p=m.position.toArray(),r=[m.rotation.x,m.rotation.y,m.rotation.z],s=m.scale.toArray();if(o){o.p=p;o.r=r;o.s=s}else{const a=(project.assets||[]).find(x=>`asset-${x.id||x.name}`===selectedId);if(a){a.p=p;a.r=r;a.s=s}}}
function attachGizmo(){if(!gizmo){renderInspector();return}const m=meshes.get(selectedId)||assetMeshes.get(selectedId);if(transformMode==='select'||!m){gizmo.detach();renderInspector();return}gizmo.attach(m);gizmo.setMode(transformMode);gizmo.setSpace(worldSpace?'world':'local');gizmo.setTranslationSnap(snap||null);gizmo.setScaleSnap(snap||null);gizmo.setRotationSnap(snap?THREE.MathUtils.degToRad(snap*15):null);renderInspector()}
function renderTree(){const root=$('tree');if(!root)return;root.replaceChildren();const q=$('q')?.value.trim().toLowerCase()||'';for(const o of project.objects){if(q&&!o.name.toLowerCase().includes(q))continue;const row=document.createElement('div');row.className='row'+(o.id===selectedId?' sel':'');row.style.paddingLeft=o.parentId?'22px':'';const icon=document.createElement('span');icon.className='t';icon.textContent=o.parentId?'â³':o.type==='light'?'â¼':o.type==='plane'?'â±':o.type==='camera'?'â£':'â';const name=document.createElement('span');name.className='n';name.textContent=o.name;const vis=document.createElement('button');vis.type='button';vis.title='Toggle visibility';vis.textContent=o.visible===false?'â':'â';vis.onclick=e=>{e.stopPropagation();o.visible=o.visible===false;const m=meshes.get(o.id);if(m)m.visible=o.visible;commit()};row.append(icon,name,vis);row.onclick=()=>{selectedId=o.id;renderTree();attachGizmo()};row.oncontextmenu=e=>{e.preventDefault();showContextMenu(e.clientX,e.clientY,o.id)};root.append(row)}
  for(const [id,m] of assetMeshes){const nameText=m.userData.assetName||m.name||'Imported asset';if(q&&!nameText.toLowerCase().includes(q))continue;const row=document.createElement('div');row.className='row'+(id===selectedId?' sel':'');const icon=document.createElement('span');icon.className='t';icon.textContent='â§';const name=document.createElement('span');name.className='n';name.textContent=nameText;const vis=document.createElement('button');vis.type='button';vis.textContent=m.visible?'â':'â';vis.title='Toggle visibility';vis.onclick=e=>{e.stopPropagation();m.visible=!m.visible;vis.textContent=m.visible?'â':'â'};row.append(icon,name,vis);row.onclick=()=>{selectedId=id;renderTree();attachGizmo()};row.oncontextmenu=e=>{e.preventDefault();showContextMenu(e.clientX,e.clientY,id)};root.append(row)}
  if(!root.children.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No objects or imported assets';root.append(empty)}
}
function field(parent,label,value,change,type='number',step='0.1'){const wrap=document.createElement('div');wrap.className='f';const lab=document.createElement('label');lab.textContent=label;const input=document.createElement('input');input.type=type;if(type==='number'){input.step=step;input.value=Number(value??0)}else input.value=value??'';input.addEventListener('change',()=>change(type==='number'?Number(input.value):input.value));wrap.append(lab,input);parent.append(wrap);return input}
function renderInspector(){const root=$('insp');root.replaceChildren();const o=project.objects.find(x=>x.id===selectedId);if(!o){const a=assetMeshes.get(selectedId);if(a){const h=document.createElement('div');h.className='sec';const title=document.createElement('h4');title.textContent='IMPORTED ASSET';const name=document.createElement('p');name.textContent=a.userData.assetName||a.name||'Asset';h.append(title,name);root.append(h);for(const [key,label] of [['p','POSITION'],['r','ROTATION (radians)'],['s','SCALE']]){const sec=document.createElement('div');sec.className='sec';const t=document.createElement('h4');t.textContent=label;sec.append(t);['X','Y','Z'].forEach((axis,i)=>field(sec,axis,(a[key]||[0,0,0])[i],v=>{const vals=a[key]||[0,0,0];vals[i]=v;a[key]=vals;if(key==='p')a.position.fromArray(vals);else if(key==='r')a.rotation.set(...vals);else a.scale.fromArray(vals);syncObjectFromMesh();commit()}));root.append(sec)}const delA=document.createElement('button');delA.textContent='Delete imported asset';delA.onclick=removeSelected;root.append(delA);return}const msg=document.createElement('div');msg.className='empty';msg.textContent='Select an object or create one.';root.append(msg);const add=document.createElement('button');add.textContent='+ Add Cube';add.onclick=()=>addObject('box');root.append(add);return}
  const id=document.createElement('div');id.className='sec';const h=document.createElement('h4');h.textContent='OBJECT';id.append(h);field(id,'Name',o.name,v=>{o.name=v;commit()},'text');const vr=document.createElement('label');vr.className='f';vr.append(document.createTextNode('Visible'));const check=document.createElement('input');check.type='checkbox';check.checked=o.visible!==false;check.onchange=()=>{o.visible=check.checked;const m=meshes.get(o.id);if(m)m.visible=o.visible;commit()};vr.append(check);id.append(vr);root.append(id);
  for(const [key,title] of [['p','POSITION'],['r','ROTATION (radians)'],['s','SCALE']]){const sec=document.createElement('div');sec.className='sec';const t=document.createElement('h4');t.textContent=title;sec.append(t);const vals=o[key]||[0,0,0];['X','Y','Z'].forEach((axis,i)=>field(sec,axis,vals[i],v=>{o[key][i]=v;const m=meshes.get(o.id);if(m){if(key==='p')m.position.fromArray(o.p);else if(key==='r')m.rotation.set(...o.r);else m.scale.fromArray(o.s)}attachGizmo();commit()}));root.append(sec)}
  const mat=document.createElement('div');mat.className='sec';const mh=document.createElement('h4');mh.textContent=o.type==='light'?'LIGHT COLOR':'MATERIAL';mat.append(mh);field(mat,'Color','#'+(o.color??0x9a9aa3).toString(16).padStart(6,'0'),v=>{o.color=parseInt(v.slice(1),16);const m=meshes.get(o.id);if(m?.isLight){m.color.set(v);if(m.children[0]?.material)m.children[0].material.color.set(v)}else if(m?.material)m.material.color.set(v);commit()},'color');if(o.type!=='light'){field(mat,'Roughness',o.rough??.6,v=>{o.rough=Math.max(0,Math.min(1,v));const m=meshes.get(o.id);if(m?.material)m.material.roughness=o.rough;commit()});field(mat,'Metalness',o.metal??0,v=>{o.metal=Math.max(0,Math.min(1,v));const m=meshes.get(o.id);if(m?.material)m.material.metalness=o.metal;commit()})}root.append(mat);const parentSec=document.createElement('div');parentSec.className='sec';const parentTitle=document.createElement('h4');parentTitle.textContent='HIERARCHY';parentSec.append(parentTitle);const parentBtn=document.createElement('button');parentBtn.textContent=o.parentId?'Change parentâ¦':'Set parentâ¦';parentBtn.onclick=()=>showContextMenu(innerWidth/2,innerHeight/2,o.id);parentSec.append(parentBtn);root.append(parentSec);const del=document.createElement('button');del.textContent='Delete object';del.onclick=removeSelected;root.append(del)}
function renderFiles(){const root=$('flist');root.replaceChildren();const q=$('fsearch').value.toLowerCase();for(const path of Object.keys(project.files||{}).sort().filter(p=>p.toLowerCase().includes(q))){const row=document.createElement('div');row.className='row'+(path===activeFile?' sel':'');const ico=document.createElement('span');ico.className='t';ico.textContent='â¤';const name=document.createElement('span');name.className='n';name.textContent=path;row.append(ico,name);row.onclick=()=>openFile(path);root.append(row)}}
function openFile(path){if(!(path in project.files))return;activeFile=path;openedFiles.add(path);renderFiles();renderEditor();switchView('code')}
function renderEditor(){const tabs=$('ctabs');tabs.replaceChildren();for(const path of [...openedFiles].filter(p=>p in project.files)){const tab=document.createElement('div');tab.className='ct'+(path===activeFile?' on':'');const label=document.createElement('span');label.textContent=path;const close=document.createElement('button');close.type='button';close.className='tab-close';close.textContent='Ã';close.title=`Close ${path}`;close.setAttribute('aria-label',`Close ${path}`);close.onclick=e=>{e.stopPropagation();openedFiles.delete(path);if(activeFile===path)activeFile=[...openedFiles].find(p=>p in project.files)||'';renderEditor()};tab.append(label,close);tab.onclick=()=>{activeFile=path;renderEditor()};tabs.append(tab)}const host=$('monaco');host.replaceChildren();if(!activeFile||!(activeFile in project.files)){const msg=document.createElement('div');msg.className='msg';msg.textContent='No open tabs. Select a project file to open it.';host.append(msg);return}const editor=document.createElement('textarea');editor.id='editor';editor.spellcheck=false;editor.autocapitalize='off';editor.autocomplete='off';editor.value=String(project.files[activeFile]??'');editor.setAttribute('aria-label','Editing '+activeFile);editor.addEventListener('input',()=>{project.files[activeFile]=editor.value;setDirty()});editor.addEventListener('keydown',e=>{if(e.key==='Tab'){e.preventDefault();editor.setRangeText('  ',editor.selectionStart,editor.selectionEnd,'end');editor.dispatchEvent(new Event('input'))}if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveProject()}});host.append(editor)}
function switchView(view){for(const b of document.querySelectorAll('[data-v]'))b.classList.toggle('on',b.dataset.v===view);for(const id of ['scene','code','preview','community'])$(id).hidden=id!==view;if(view==='scene'&&renderer){renderer.setSize(Math.max(1,$('scene').clientWidth),Math.max(1,$('scene').clientHeight),false)}if(view==='community')community?.searchPublic?.()}
function showDock(which){document.querySelectorAll('[data-bottom]').forEach(b=>b.classList.toggle('on',b.dataset.bottom===which));$('log').hidden=which==='files';$('consoleTools').hidden=which==='files';$('projectDock').hidden=which!=='files';if(which==='files')community?.renderDock()}
function safeName(s){return String(s||'forge-project').toLowerCase().replace(/[^a-z0-9-_]+/g,'-').replace(/^-|-$/g,'')||'forge-project'}
function dataUrlToBytes(dataUrl){const raw=atob(String(dataUrl).split(',')[1]||'');const out=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)out[i]=raw.charCodeAt(i);return out}
function downloadProject(){const files={...project.files,'forge-project.json':JSON.stringify(project,null,2),'README.txt':`Forge Studio project: ${project.name}\n`};const used=new Set(Object.keys(files));for(const a of project.assets||[]){const name=String(a.name||'asset.bin').replace(/\\/g,'/').split('/').pop().replace(/[^a-zA-Z0-9._ -]/g,'_')||'asset.bin';let dest=`assets/${name}`,n=2;while(used.has(dest))dest=`assets/${n++}-${name}`;used.add(dest);try{files[dest]=dataUrlToBytes(a.dataUrl)}catch(e){log(`Could not export asset ${name}: ${e.message}`,'warn')}}downloadBlob(zip(files),safeName(project.name)+'.zip');log('Project ZIP exported','ok')}
function resetProjectUI(){selectedId=project.objects[0]?.id||null;activeFile=project.files['game.js']!==undefined?'game.js':Object.keys(project.files)[0]||'';openedFiles=new Set(Object.keys(project.files).filter(p=>['index.html','style.css','game.js'].includes(p)));if(activeFile)openedFiles.add(activeFile);history.reset(JSON.stringify(project));syncScene();renderTree();renderInspector();renderFiles();renderEditor();community?.renderDock();$('pname').textContent=project.name;dirty=false;$('save').textContent='Saved locally'}
async function newProjectFlow(){if(dirty&&!confirm('Discard unsaved changes?'))return;const name=prompt('Project name','Untitled Project');if(name===null)return;project=newProject(name.trim()||'Untitled Project');resetProjectUI();setDirty();switchView('scene')}
function importProjectFlow(){const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=async()=>{const file=input.files?.[0];if(!file)return;try{project=migrate(JSON.parse(await file.text()));resetProjectUI();setDirty();log('Project imported','ok')}catch(e){log('Project import failed: '+e.message,'error')}};input.click()}
async function openLocalProjectFlow(){try{const saved=(await provider.list()).sort((a,b)=>(b.updated||0)-(a.updated||0));if(!saved.length){alert('No saved projects found in this browser on this device.');return}const answer=prompt('Open a saved local project:\n\n'+saved.map((p,i)=>(i+1)+'. '+(p.name||'Untitled Project')).join('\n')+'\n\nEnter a number:','1');if(answer===null)return;const index=Number(answer)-1;if(!Number.isInteger(index)||index<0||index>=saved.length){alert('Invalid project number.');return}if(dirty&&!confirm('Replace the current project?'))return;project=migrate(saved[index]);resetProjectUI();log('Opened local project: '+project.name,'ok')}catch(e){log('Could not open local projects: '+e.message,'error');alert('Could not open local projects.\n'+e.message)}}
function setupMenus(){const groups=[['File',[['New project',newProjectFlow],['Import project JSON',importProjectFlow],['Open saved local project',openLocalProjectFlow],['Save now',saveProject],['Export project ZIP',downloadProject]]],['Create',[['Cube',()=>addObject('box')],['Sphere',()=>addObject('sphere')],['Plane',()=>addObject('plane')],['Cylinder',()=>addObject('cylinder')],['Cone',()=>addObject('cone')],['Point light',()=>addObject('light')],['Camera',()=>addObject('camera')],['Delete selected',removeSelected]]],['View',[['Scene',()=>switchView('scene')],['Code',()=>switchView('code')],['Preview',()=>switchView('preview')],['Community',()=>switchView('community')],['Project Files',()=>showDock('files')],['Console',()=>showDock('console')]]],['Help',[['About Forge Studio',()=>alert('Forge Studio\nBrowser-based game editor. Projects autosave in this browser. Export a ZIP for backup.')]]]];const host=$('menus');host.replaceChildren();for(const [label,actions] of groups){const b=document.createElement('button');b.type='button';b.textContent=label;b.onclick=()=>{document.querySelectorAll('.menu-pop').forEach(p=>p.remove());const pop=document.createElement('div');pop.className='menu-pop';const r=b.getBoundingClientRect();pop.style.top=Math.min(innerHeight-180,r.bottom)+'px';pop.style.left=Math.max(6,Math.min(r.left,innerWidth-220))+'px';for(const [name,action] of actions){const item=document.createElement('button');item.type='button';item.textContent=name;item.onclick=()=>{pop.remove();action()};pop.append(item)}document.body.append(pop);const close=e=>{if(!pop.contains(e.target)&&e.target!==b){pop.remove();document.removeEventListener('pointerdown',close)}};setTimeout(()=>document.addEventListener('pointerdown',close),0)};host.append(b)}}
function setupResize(){function bind(id,side){$(id).addEventListener('pointerdown',e=>{if(innerWidth<821)return;const start=e.clientX,w=side==='left'?$('explorer').offsetWidth:$('inspector').offsetWidth;const move=ev=>{const d=ev.clientX-start;if(side==='left')$('explorer').style.width=Math.max(140,Math.min(360,w+d))+'px';else $('inspector').style.width=Math.max(180,Math.min(420,w-d))+'px'};const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)})}bind('rzL','left');bind('rzR','right');$('rzB').addEventListener('pointerdown',e=>{const y=e.clientY,h=$('bottom').offsetHeight;const move=ev=>$('bottom').style.flexBasis=Math.max(65,Math.min(innerHeight*.5,h+y-ev.clientY))+'px';const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)};window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)})}
function setupAuth() {
  const header = $('menubar');
  if (!header || $('authButton')) return;
  const button = document.createElement('button');
  button.id = 'authButton'; button.type = 'button'; button.textContent = 'Sign in';
  button.style.cssText = 'margin-left:8px;white-space:nowrap';
  header.append(button);

  const panel = document.createElement('dialog');
  panel.id = 'authDialog';
  panel.style.cssText = 'background:#1b1b1f;color:#eee;border:1px solid #444;border-radius:10px;padding:20px;max-width:calc(100vw - 32px);width:340px';
  panel.innerHTML = '<form id="authForm" style="display:grid;gap:10px"><h2 id="authTitle" style="margin:0;font-size:18px">Sign in to Forge</h2><p id="authMessage" style="margin:0;color:#aaa;font-size:12px">Use your Firebase account to save projects to the cloud.</p><label>Email<input id="authEmail" type="email" required autocomplete="email" style="display:block;width:100%;box-sizing:border-box;margin-top:4px"></label><label>Password<input id="authPassword" type="password" required minlength="6" autocomplete="current-password" style="display:block;width:100%;box-sizing:border-box;margin-top:4px"></label><div style="display:flex;gap:8px;flex-wrap:wrap"><button id="authSubmit" type="submit">Sign in</button><button id="authCreate" type="button">Create account</button><button id="authCancel" type="button">Cancel</button></div></form>';
  document.body.append(panel);
  let createMode = false;
  const form = panel.querySelector('#authForm');
  const msg = panel.querySelector('#authMessage');
  const title = panel.querySelector('#authTitle');
  const submit = panel.querySelector('#authSubmit');
  const email = panel.querySelector('#authEmail');
  const password = panel.querySelector('#authPassword');
  const setMode = create => {
    createMode = create;
    title.textContent = create ? 'Create a Forge account' : 'Sign in to Forge';
    submit.textContent = create ? 'Create account' : 'Sign in';
    password.autocomplete = create ? 'new-password' : 'current-password';
    msg.textContent = create ? 'Create an account with your email and a password (6+ characters).' : 'Use your Firebase account to save projects to the cloud.';
  };
  button.onclick = () => {
    if (getCurrentUser()) {
      if (confirm('Sign out of Forge Studio?')) signOut().catch(error => log('Sign out failed: ' + error.message, 'error'));
    } else { setMode(false); panel.showModal(); }
  };
  panel.querySelector('#authCreate').onclick = () => setMode(true);
  panel.querySelector('#authCancel').onclick = () => panel.close();
  form.onsubmit = async event => {
    event.preventDefault(); submit.disabled = true;
    try {
      await signInOrCreate(email.value.trim(), password.value, createMode);
      panel.close(); password.value = '';
      log(createMode ? 'Firebase account created and signed in.' : 'Signed in to Firebase.', 'ok');
    } catch (error) { msg.textContent = error.message || 'Authentication failed.'; }
    finally { submit.disabled = false; }
  };
  onAuthChange(user => {
    button.textContent = user ? 'Sign out (' + (user.email || 'account') + ')' : 'Sign in';
    $('cloudSave').disabled = !user; $('cloudOpen').disabled = !user;
    $('cloudStatus').textContent = user ? 'Signed in Â· cloud save available' : 'Not signed in';
  });
  $('cloudSave').onclick = async () => {
    try { await saveCloudProject(project); log('Saved project to Firebase Cloud: ' + project.name, 'ok'); $('cloudStatus').textContent = 'Cloud saved'; }
    catch (error) { log('Cloud save failed: ' + error.message, 'error'); alert('Cloud save failed: ' + error.message); }
  };
  $('cloudOpen').onclick = async () => {
    try {
      const items = await listCloudProjects();
      if (!items.length) { alert('No cloud projects found for this account.'); return; }
      const answer = prompt('Open a cloud project:\n\n' + items.map((item, i) => (i + 1) + '. ' + item.name).join('\n') + '\n\nEnter a number:', '1');
      if (answer === null) return;
      const index = Number(answer) - 1;
      if (!Number.isInteger(index) || index < 0 || index >= items.length) { alert('Invalid project number.'); return; }
      if (dirty && !confirm('Replace the current project?')) return;
      project = migrate(items[index].project); resetProjectUI(); log('Opened cloud project: ' + project.name, 'ok');
    } catch (error) { log('Cloud open failed: ' + error.message, 'error'); alert('Cloud open failed: ' + error.message); }
  };
}

function setup(){setupMenus();setupAuth();let sceneFailed=false;try{initScene()}catch(e){sceneFailed=true;log('3D scene failed: '+(e.stack||e.message||e),'error');$('scene').textContent='3D scene unavailable. Code tools may still work.'}selectedId=project.objects.find(o=>o.id===selectedId)?.id||project.objects[0]?.id||null;activeFile=project.files[activeFile]!==undefined?activeFile:Object.keys(project.files)[0]||'';history.reset(JSON.stringify(project));renderTree();renderInspector();renderFiles();renderEditor();
  community=setupCommunity({getProject:()=>project,markDirty:()=>{setDirty();history.push(JSON.stringify(project));updateUndoButtons();syncScene();renderTree();renderInspector();community?.renderDock()},openFile,createFile:()=>$('fnew').click(),switchView,log});
  document.querySelectorAll('[data-v]').forEach(b=>b.onclick=()=>switchView(b.dataset.v));document.querySelectorAll('[data-bottom]').forEach(b=>b.onclick=()=>showDock(b.dataset.bottom));$('q').addEventListener('input',renderTree);$('fsearch').addEventListener('input',renderFiles);
  $('fnew').onclick=()=>{let path=prompt('New file path (example: scripts/player.js)');if(!path)return;path=path.trim();if(path.startsWith('/')||path.includes('\\')||path.split('/').includes('..'))return log('Use a safe relative file path without ..','warn');if(path in project.files)return log('File already exists','warn');project.files[path]='';activeFile=path;openedFiles.add(path);commit();renderEditor();switchView('code')};
  $('fren').onclick=()=>{if(!activeFile)return;const path=prompt('Rename file',activeFile)?.trim();if(!path||path===activeFile)return;if(path.startsWith('/')||path.includes('\\')||path.split('/').includes('..')||path in project.files)return log('Invalid path or file already exists','warn');project.files[path]=project.files[activeFile];delete project.files[activeFile];openedFiles.delete(activeFile);activeFile=path;openedFiles.add(path);commit();renderEditor()};
  $('fdel').onclick=()=>{if(!activeFile||!confirm('Delete '+activeFile+'?'))return;delete project.files[activeFile];openedFiles.delete(activeFile);activeFile=[...openedFiles].find(p=>p in project.files)||'';commit();renderEditor()};
  $('bundo').onclick=()=>restore(history.undo());$('bredo').onclick=()=>restore(history.redo());document.querySelectorAll('[data-t]').forEach(b=>b.onclick=()=>{transformMode=b.dataset.t;document.querySelectorAll('[data-t]').forEach(x=>x.classList.toggle('on',x===b));if(gizmo&&transformMode!=='select')gizmo.setMode(transformMode);if(transformMode==='select')gizmo?.detach()});
  $('space').onclick=()=>{worldSpace=!worldSpace;$('space').textContent=worldSpace?'World':'Local';gizmo?.setSpace(worldSpace?'world':'local')};$('snap').onchange=()=>{snap=Number($('snap').value);attachGizmo()};
  $('run').onclick=()=>{try{switchView('preview');const missing=runPreview($('pframe'),project.files,project);if(missing.length)log('Missing linked file(s): '+missing.join(', '),'warn');log('Preview started','ok')}catch(e){log('Preview failed: '+e.message,'error')}};$('stop').onclick=()=>{stopPreview($('pframe'));log('Preview stopped')};$('localOpen').onclick=openLocalProjectFlow;$('clr').onclick=()=>$('log').replaceChildren();$('lvl').onchange=()=>{for(const row of $('log').children){const level=$('lvl').value;row.hidden=level==='warn'?!['warn','error'].some(x=>row.classList.contains(x)):level==='error'?!row.classList.contains('error'):false}};
  $('mE').onclick=()=>$('explorer').classList.toggle('open');$('mI').onclick=()=>$('inspector').classList.toggle('open');
  document.addEventListener('keydown',e=>{if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return;const k=e.key.toLowerCase();if(['q','w','e','r'].includes(k)){transformMode=({q:'select',w:'translate',e:'rotate',r:'scale'})[k];document.querySelectorAll('[data-t]').forEach(b=>b.classList.toggle('on',b.dataset.t===transformMode));if(transformMode==='select')gizmo?.detach();else gizmo?.setMode(transformMode)}if(e.key==='Delete'||e.key==='Backspace')removeSelected();if((e.ctrlKey||e.metaKey)&&k==='s'){e.preventDefault();saveProject()}if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();restore(history.undo())}if((e.ctrlKey||e.metaKey)&&k==='y'){e.preventDefault();restore(history.redo())}});
  window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue=''}});window.addEventListener('message',e=>{if(e.data?.forge===1)log(e.data.m,e.data.k==='error'?'error':e.data.k==='warn'?'warn':'info')});setupResize();
  provider.list().then(list=>{if(!list.length)return;const newest=[...list].sort((a,b)=>(b.updated||0)-(a.updated||0))[0];if(confirm('Open your last saved project "'+newest.name+'"?')){project=migrate(newest);resetProjectUI()}}).catch(e=>log('IndexedDB unavailable: '+e.message,'warn'));
  $('pname').textContent=project.name;if(!sceneFailed)log('Forge Studio ready. Local autosave is enabled.','ok');else log('Forge Studio loaded with the 3D scene disabled. Other tools may still work.','warn');
}
setup();
