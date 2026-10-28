// Pure helpers for the object hierarchy (no DOM / THREE), so they can be unit tested in Node.

export function descendantsOf(objects, id) {
  const found = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const item of objects) {
      if (item.parentId && found.has(item.parentId) && !found.has(item.id)) {
        found.add(item.id);
        changed = true;
      }
    }
  }
  return found; // includes id itself
}

// A parent is valid if it exists, is not the child itself and is not one of the child's descendants.
export function canParent(objects, childId, parentId) {
  if (!parentId || childId === parentId) return false;
  if (!objects.some(o => o.id === childId) || !objects.some(o => o.id === parentId)) return false;
  return !descendantsOf(objects, childId).has(parentId);
}

export function validParents(objects, childId) {
  return objects.filter(o => canParent(objects, childId, o.id));
}

// Flatten into display order: each root followed (depth-first) by its children, keeping array order among siblings.
export function treeRows(objects, collapsed = new Set()) {
  const ids = new Set(objects.map(o => o.id));
  const kids = new Map();
  const roots = [];
  for (const o of objects) {
    if (o.parentId && ids.has(o.parentId) && o.parentId !== o.id) {
      if (!kids.has(o.parentId)) kids.set(o.parentId, []);
      kids.get(o.parentId).push(o);
    } else roots.push(o);
  }
  const rows = [], seen = new Set();
  const walk = (o, depth) => {
    if (seen.has(o.id)) return; // defensive: never loop on bad data
    seen.add(o.id);
    const children = kids.get(o.id) || [];
    rows.push({ object: o, depth, childCount: children.length, collapsed: collapsed.has(o.id) });
    if (!collapsed.has(o.id)) for (const c of children) walk(c, depth + 1);
  };
  for (const r of roots) walk(r, 0);

  // Anything not reachable from a root (only possible with a cycle in corrupt data) is still listed, never lost.
  // Nodes hidden merely because an ancestor is collapsed are reachable and must stay hidden.
  const reachable = new Set();
  const mark = o => { if (reachable.has(o.id)) return; reachable.add(o.id); for (const c of kids.get(o.id) || []) mark(c); };
  for (const r of roots) mark(r);
  for (const o of objects) if (!reachable.has(o.id) && !seen.has(o.id)) walk(o, 0);
  return rows;
}

// Copy an object and all of its descendants with fresh ids. Returns the new objects (root first).
export function cloneSubtree(objects, rootId, makeId) {
  const ids = descendantsOf(objects, rootId);
  const idMap = new Map();
  const originals = objects.filter(o => ids.has(o.id));
  for (const o of originals) idMap.set(o.id, makeId());
  return originals.map(o => {
    const copy = structuredClone(o);
    copy.id = idMap.get(o.id);
    copy.parentId = o.id === rootId ? (o.parentId ?? null) : idMap.get(o.parentId);
    if (Array.isArray(copy.scripts)) copy.scripts = copy.scripts.map(s => ({ ...s, id: makeId() }));
    return copy;
  });
}
