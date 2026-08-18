// Help and Credits dialogs.
// Depends on: ui.js (dialog shell conventions shared with rules.js / merge.js)

// ── Credits data ─────────────────────────────────────────────────

// Kept as data rather than markup so adding a name is one line and never a chance
// to break the page. Mirrors the credits list in the Steam guide.
const CONTRIBUTORS = [
  {
    who: [
      { name: 'Jutser',          url: 'https://steamcommunity.com/id/jutser' },
      { name: 'IwannaBejutser',  url: 'https://github.com/IwannaBejutser' },
    ],
    did: ['Added the missing "Wedge" tablet'],
  },
  {
    who: [{ name: 'Kyle Paulsen', url: 'https://github.com/kylepaulsen' }],
    did: ['Added tablet search', 'Added rotated display for a tablet in the grid'],
  },
];

const ACKNOWLEDGEMENTS = [
  { for: 'Suggesting alphabetised tablet sorting',
    who: [{ name: 'Bionic Devil', url: 'https://steamcommunity.com/profiles/76561198050858104' }] },
  { for: 'Finding the merging bug where position constraints on merged tablets weren\'t inherited',
    who: [{ name: 'XenoAlvis', url: 'https://steamcommunity.com/profiles/76561198896795110' }] },
  { for: 'Reporting that the "Curse" tablet from the Skeleton costume was missing',
    who: [{ name: 'ObviousPseudonym', url: 'https://steamcommunity.com/profiles/76561198271577229' }] },
  { for: 'Suggesting a reduced grid for new players who haven\'t got the full expansion from Destiny Inscription yet',
    who: [{ name: 'TehRankzor',       url: 'https://steamcommunity.com/profiles/76561197964105762' },
          { name: 'ObviousPseudonym', url: 'https://steamcommunity.com/profiles/76561198271577229' }] },
  { for: 'Describing the tool\'s limitations and how it wasted buff in the Legacy modes, which led to Rulesets',
    who: [{ name: 'Pogey', url: 'https://steamcommunity.com/profiles/76561198050492101' }] },
  { for: 'Discovering that the total grid can be pushed much larger in game than the tool supported',
    who: [{ name: 'ObviousPseudonym', url: 'https://steamcommunity.com/profiles/76561198271577229' }] },
];

// ── Shared dialog shell ──────────────────────────────────────────

// Same shell the rules and merge dialogs use: built imperatively, click-outside and
// Escape both close, and closing is the only exit since there's nothing to save.
function openInfoDialog(id, title, build) {
  if (document.getElementById(id)) return;

  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'rules-overlay';
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });

  const dialog = document.createElement('div');
  dialog.className = 'rules-dialog info-dialog';

  const hdr = document.createElement('div');
  hdr.className = 'rules-hdr';
  const t = document.createElement('span');
  t.className = 'rules-hdr-title';
  t.textContent = title;
  const x = document.createElement('button');
  x.className = 'rules-close-btn';
  x.textContent = '×';
  x.addEventListener('click', close);
  hdr.append(t, x);
  dialog.appendChild(hdr);

  const body = document.createElement('div');
  body.className = 'rules-body info-body';
  build(body);
  dialog.appendChild(body);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
}

function infoLink(name, url) {
  const a = document.createElement('a');
  a.className = 'info-link';
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener';
  a.textContent = name;
  return a;
}

// "A aka B" for the same person under two identities, "A and B" for two people.
function nameList(who, joiner) {
  const frag = document.createDocumentFragment();
  who.forEach((w, i) => {
    if (i) frag.appendChild(document.createTextNode(` ${joiner} `));
    frag.appendChild(infoLink(w.name, w.url));
  });
  return frag;
}

function infoHeading(text) {
  const h = document.createElement('div');
  h.className = 'info-heading';
  h.textContent = text;
  return h;
}

// ── Credits ──────────────────────────────────────────────────────

function openCreditsDialog() {
  openInfoDialog('credits-overlay', '◆ Credits', body => {
    const intro = document.createElement('p');
    intro.className = 'info-p';
    intro.textContent = 'This tool is better than it would have been on its own because ' +
      'of the people below — for code, for bug reports, and for telling me when it was wrong.';
    body.appendChild(intro);

    body.appendChild(infoHeading('Contributions'));
    for (const c of CONTRIBUTORS) {
      const block = document.createElement('div');
      block.className = 'info-entry';
      const who = document.createElement('div');
      who.className = 'info-who';
      who.appendChild(nameList(c.who, 'aka'));
      block.appendChild(who);
      const ul = document.createElement('ul');
      ul.className = 'info-list';
      for (const d of c.did) {
        const li = document.createElement('li');
        li.textContent = d;
        ul.appendChild(li);
      }
      block.appendChild(ul);
      body.appendChild(block);
    }

    body.appendChild(infoHeading('Acknowledgements'));
    for (const a of ACKNOWLEDGEMENTS) {
      const block = document.createElement('div');
      block.className = 'info-entry';
      const what = document.createElement('div');
      what.className = 'info-for';
      what.textContent = a.for;
      block.appendChild(what);
      const who = document.createElement('div');
      who.className = 'info-who';
      who.appendChild(nameList(a.who, 'and'));
      block.appendChild(who);
      body.appendChild(block);
    }

    const foot = document.createElement('p');
    foot.className = 'info-p info-foot';
    foot.append('Spotted something wrong, or want to add to it? ');
    foot.appendChild(infoLink('Fork and open a PR', 'https://github.com/ForestSquirrel/SephiriaSolver'));
    foot.append('.');
    body.appendChild(foot);
  });
}

// ── Help ─────────────────────────────────────────────────────────

// Written as sections of prose rather than a feature list: the questions people
// actually arrive with are "what do I do first" and "why did it do that".
const HELP = [
  {
    title: 'The short version',
    paras: [
      'Add the tablets you own on the left, tell the solver what you want on the right, ' +
      'then press Solve. It searches for a whole-grid layout and shows you the best few it found.',
      'It never places tablets you don\'t own, and it will leave one out entirely if there\'s ' +
      'nowhere it can legally go.',
    ],
  },
  {
    title: 'Your collection',
    paras: [
      'Click a tablet in the picker to add a copy; click its row in the list to pick it up, ' +
      'then click a grid slot to place it by hand. Search and sorting are at the top of the picker.',
      'Merge combines two tablets into one. A merged tablet keeps both sets of effects and the ' +
      'narrower of the two position restrictions — if the two restrictions conflict, the merge is refused, ' +
      'because what the game does there isn\'t confirmed.',
    ],
  },
  {
    title: 'Rulesets — the default mode',
    paras: [
      'A rule asks for a <em>count</em> of slots at some value, without saying which slots. ' +
      '"At least 4 slots with buff ≥3" leaves the solver free to decide where those slots are, ' +
      'which is what stops it spending buff on slots nothing asked about.',
      'Rules higher in the list pick their slots first, so drag them to break ties. ' +
      'Whatever no rule claimed is scored by the "Rest of slots" setting at the bottom — ' +
      'lowest priority, and it derives its own bar from your strictest rule rather than asking for another number.',
    ],
  },
  {
    title: 'Legacy mode',
    paras: [
      'One global goal for every empty slot: perfect coverage, maximise, or a target value. ' +
      'Simpler to set up, but it treats every slot as equally worth buffing, which usually ' +
      'wastes buff on slots you were never going to use. Rulesets exists because of that.',
    ],
  },
  {
    title: 'Items',
    paras: [
      'Items occupy a slot and give no buff of their own — they care about what the slot they sit in is worth. ' +
      'Add them under Manage Rules with "+ Add Item Rule". The solver places them alongside your tablets.',
      'Each item has a full-potential value. Above it the item is at full strength, below it the item still ' +
      'works at reduced power, and <strong>below zero it does nothing at all</strong>. ' +
      'The badge on a placed item shows where it landed, in red, gold or green.',
      '<strong>Enforce</strong> means the solver must hit the number you typed. <strong>Try</strong> drops the number ' +
      'and just pushes the slot as high as it can — useful when you want the item to be good but ' +
      'not at the cost of a rule.',
    ],
  },
  {
    title: 'Items that care about their neighbours',
    paras: [
      'Some items want specific things placed near them. For a Giant Telescope or a Devotion Insignia, ' +
      'pick the Planets or Companions you actually intend to put there — the solver then holds exactly that many ' +
      'slots open and pushes each to that thing\'s own value. Those slots show a faint sprite so you can see the plan.',
      'A Multipurpose Belt keeps slots in the top row free of <em>tablets</em>; other items are welcome up there, ' +
      'which is the whole point of it. A Crystal of Harmony is placed after the search, in whichever spot has the ' +
      'richest neighbourhood, since it can\'t change where a tablet wants to go anyway.',
    ],
  },
  {
    title: 'Marks on the grid',
    paras: [
      'Use the mark tools above the grid to tag individual slots. ' +
      '<span class="help-swatch swatch-x2"></span> <strong>×2</strong> doubles that slot\'s net value, negatives included. ' +
      '<span class="help-swatch swatch-target"></span> <strong>Target</strong> pins a slot to a value; ' +
      'the solver keeps it empty so it can actually receive that buff.',
      '<span class="help-swatch swatch-exempt"></span> A <strong>cyan</strong> outline is a slot where a placed ' +
      'Link, Surge or Hospitality lets an item ignore its position restriction. ' +
      '<span class="help-swatch swatch-reserved"></span> A <strong>dashed gold</strong> outline is a slot being held ' +
      'open for a Planet, Companion or Grimoire you named.',
    ],
  },
  {
    title: 'Reading the results',
    paras: [
      'The solver keeps every distinct layout it finds, not just three. The cards show the best few; ' +
      '"Browse all results" opens a sortable, filterable table of the rest.',
      'Search time is a budget you choose. Longer doesn\'t mean a better single answer so much as more ' +
      'options to choose between — every attempt yields a different layout.',
      'If a layout misses something you asked for, a warning appears describing <em>that specific layout</em> — ' +
      'it follows whichever option you have applied, so it always matches what\'s on the grid.',
    ],
  },
  {
    title: 'When it can\'t do what you asked',
    paras: [
      'Some setups are impossible and get refused before the search starts — a Warm Stone needs an inner slot, ' +
      'so it has nowhere to go on a grid with no interior. Those show as a message under the rules.',
      'Others are merely hard, and the solver just fails to find them. That\'s reported afterwards instead, ' +
      'because failing to find a layout isn\'t proof that none exists.',
    ],
  },
];

function openHelpDialog() {
  openInfoDialog('help-overlay', '◆ How this works', body => {
    for (const sec of HELP) {
      body.appendChild(infoHeading(sec.title));
      for (const p of sec.paras) {
        const el = document.createElement('p');
        el.className = 'info-p';
        // Static strings from the table above — no user input reaches this.
        el.innerHTML = p;
        body.appendChild(el);
      }
    }
    const foot = document.createElement('p');
    foot.className = 'info-p info-foot';
    foot.append('Still stuck, or found a bug? Ask in the ');
    foot.appendChild(infoLink('Steam guide', 'https://steamcommunity.com/sharedfiles/filedetails/?id=3741701046'));
    foot.append(' comments, or open an issue on ');
    foot.appendChild(infoLink('GitHub', 'https://github.com/ForestSquirrel/SephiriaSolver'));
    foot.append('.');
    body.appendChild(foot);
  });
}
