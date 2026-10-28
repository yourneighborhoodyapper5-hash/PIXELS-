
function switchView(view) {
  document.querySelectorAll('#vtabs button').forEach(b => {
    b.classList.toggle('on', b.dataset.v === view);
  });

  for (const id of ['scene', 'code', 'preview', 'community']) {
    $(id).hidden = id !== view;
  }

  if (view === 'scene' && renderer) {
    renderer.setSize(
      $('scene').clientWidth || 1,
      $('scene').clientHeight || 1,
      false
    );
  }

  if (view === 'community') renderCommunity();
}

const communityResources = [
  {
    name: 'Kenney',
    category: 'Free game assets',
    tags: 'models textures sprites ui',
    url: 'https://kenney.nl/assets'
  },
  {
    name: 'Poly Haven',
    category: 'Textures and 3D assets',
    tags: 'textures hdr environment models',
    url: 'https://polyhaven.com'
  },
  {
    name: 'ambientCG',
    category: 'Free materials',
    tags: 'pbr textures materials',
    url: 'https://ambientcg.com'
  },
  {
    name: 'OpenGameArt',
    category: 'Community game assets',
    tags: 'sprites models music sound',
    url: 'https://opengameart.org'
  },
  {
    name: 'Freesound',
    category: 'Sound effects',
    tags: 'audio music sound effects',
    url: 'https://freesound.org'
  },
  {
    name: 'itch.io Assets',
    category: 'Game asset marketplace',
    tags: 'sprites models sounds packs',
    url: 'https://itch.io/game-assets'
  },
  {
    name: 'Three.js Examples',
    category: '3D development examples',
    tags: 'three js webgl 3d code',
    url: 'https://threejs.org/examples/'
  }
];

function renderCommunity() {
  const grid = $('assetGrid');
  if (!grid) return;

  const query = ($('assetSearch')?.value || '').trim().toLowerCase();
  grid.replaceChildren();

  const results = communityResources.filter(item =>
    `${item.name} ${item.category} ${item.tags}`
      .toLowerCase()
      .includes(query)
  );

  for (const resource of results) {
    const card = document.createElement('article');
    card.className = 'asset-card';

    const title = document.createElement('strong');
    title.textContent = resource.name;

    const description = document.createElement('p');
    description.textContent = resource.category;

    const link = document.createElement('a');
    link.href = resource.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = 'Open resource ↗';

    card.append(title, description, link);
    grid.append(card);
  }

  if (!results.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No matching resources found.';
    grid.append(empty);
  }
}
