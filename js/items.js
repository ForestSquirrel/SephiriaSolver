// Items — entities the solver places that occupy a cell but emit no buff.
// Depends on: state.js, engine.js (weights ITEM_W / ITEM_MISS_W / SOFT_BUDGET /
// RULE_W live in solver.js and are read at call time, not load time).

// Offsets everywhere in this file use the tablets.json `effects` convention:
// [dx, dy] with +dx right and +dy UP, applied to the grid as (row - dy, col + dx).

// ── Registry ─────────────────────────────────────────────────────

// Registers one dialog entry as its own TABLET_MAP token. Two copies of the same
// item need distinct ids or signature() would collapse them and per-copy config
// would collide, so the entry's uid — not the item id — is what identifies it.
// Mirrors how merge.js registers merged tablets.
function itemTokenId(uid) {
  return `item:${uid}`;
}

function itemDefOf(itemId) {
  return ITEMS_DATA ? ITEMS_DATA.items.find(i => i.id === itemId) : null;
}

function itemSpritePath(def) {
  return `itemSprites/${encodeURIComponent(def.sprite)}.png`;
}

function entityRoster(name) {
  return (ITEMS_DATA && ITEMS_DATA[name]) || [];
}

function entityValue(roster, name) {
  const e = entityRoster(roster).find(x => x.name === name);
  return e ? e.value : 0;
}

// Sync TABLET_MAP with the current solverItems list: every entry gets a token,
// and tokens for entries that went away are dropped. Called on Apply, the same
// point merged tablets are registered.
function registerSolverItems(entries) {
  const live = new Set(entries.map(e => itemTokenId(e.uid)));

  for (const k of Object.keys(TABLET_MAP))
    if (typeof k === 'string' && k.startsWith('item:')) delete TABLET_MAP[k];

  // A token that's gone must not stay on the grid — every renderer resolves a
  // placement through TABLET_MAP, so a stale id would be a dangling lookup. Same
  // contract merged tablets have when they're removed.
  for (const [key, p] of Object.entries(gridPlacements))
    if (typeof p.tabletId === 'string' && p.tabletId.startsWith('item:') && !live.has(p.tabletId))
      delete gridPlacements[key];

  for (const e of entries) {
    const def = itemDefOf(e.itemId);
    if (!def) continue;
    TABLET_MAP[itemTokenId(e.uid)] = {
      id:      itemTokenId(e.uid),
      kind:    'item',
      name:    def.name,
      sprite:  itemSpritePath(def),
      // Items never rotate — this also makes localSearch's rotate move skip them.
      disableRotate: true,
      // Deliberately no effects/lineBuff/parityBuff: getTabletContributions then
      // returns [] and computeBuffMap needs no item special case at all.
    };
  }
}

// ── Resolved plan ────────────────────────────────────────────────

// Hoisted once per solve, like restCeil — the scorer runs tens of thousands of
// times and must not re-resolve config out of the dialog's data shape.
let itemPlan      = null;   // token -> cfg
// The region claim is a single global pass, so the order items are visited in
// changes who gets which cell. Object key order is *insertion* order, which
// differs between two physically identical boards — so the scorer would stop
// being a pure function of `placements` and the hill-climber would accept and
// revert no-op moves. This canonical order is what prevents that.
let itemOrder     = [];
// Counted once over everything planned, placed or not: normalising by a count
// that shifts during scoring would make the soft tier an *average*, where adding
// a half-met objective lowers the score and an unplaced item raises it.
let itemSoftUnits = 0;

// Pure — returns a plan without touching any global. The dialog validates a *draft*
// on every keystroke, and having that quietly re-point itemOrder at draft tokens the
// live itemPlan doesn't contain would crash the very next render.
function buildItemPlan(entries) {
  const plan = {};

  for (const e of entries) {
    const def = itemDefOf(e.itemId);
    if (!def) continue;

    const pins = (def.pins || []).map((p, i) => {
      const src = e.pins?.[i] || {};
      return {
        dx: p.dx, dy: p.dy,
        group: p.group || null,
        glyph: p.glyph || null,
        grimoire: !!p.grimoire,
        value: Number.isInteger(src.value) ? src.value : 0,
        hard:  src.mode !== 'soft',
        entity: src.entity || null,   // so the grid can draw the Grimoire you chose
      };
    });

    // Pins sharing a group are graded as a set, not per side — White Paper's two
    // values aren't tied to left or right.
    const pinGroups = [];
    const seen = new Map();
    pins.forEach((p, i) => {
      if (!p.group) { pinGroups.push([i]); return; }
      if (!seen.has(p.group)) { seen.set(p.group, pinGroups.length); pinGroups.push([]); }
      pinGroups[seen.get(p.group)].push(i);
    });

    let region = null;
    if (def.region && def.region.kind === 'entities') {
      const names = e.region?.entities || [];
      region = {
        kind: 'entities',
        roster: def.region.roster,
        entities: names.map(n => ({ name: n, value: entityValue(def.region.roster, n) })),
        wants: names.map(n => entityValue(def.region.roster, n)),
        hard: e.region?.mode !== 'soft',
      };
    } else if (def.region && def.region.kind === 'neighborBuff') {
      region = { kind: 'neighborBuff' };
    } else if (def.region && def.region.kind === 'keepClear') {
      const scopeMax = COLS;   // every keepClear scope today is a row
      const n = Number.isInteger(e.region?.keepClear) ? e.region.keepClear : scopeMax;
      region = { kind: 'keepClear', need: Math.max(0, Math.min(n, scopeMax)) };
    }

    plan[itemTokenId(e.uid)] = {
      token:    itemTokenId(e.uid),
      itemId:   def.id,
      name:     def.name,
      sprite:   itemSpritePath(def),
      // Two different numbers, and conflating them draws the wrong bar on the grid:
      // `want` is the target the user asked for, `full` is the item's intrinsic
      // full-potential bracket from items.json.
      want:     Number.isInteger(e.self?.value) ? Math.max(0, e.self.value) : def.value,
      full:     def.value,
      hard:     e.self?.mode !== 'soft',
      posClass: def.posClass || null,
      phase:    Number.isInteger(e.phase) ? e.phase : 0,
      pins, pinGroups,
      exclude:  def.exclude || [],
      scope:    def.scope || null,
      // Some items can't usefully influence where the tablets go — they just want to
      // sit somewhere good once everything else is settled. Those are kept out of the
      // search entirely and placed in a pass afterwards.
      posthoc:  def.placement === 'posthoc',
      region,
    };
  }

  return plan;
}

function planSoftUnits(plan) {
  let n = 0;
  for (const t of Object.keys(plan)) {
    const c = plan[t];
    if (!c.hard) n++;
    for (const p of c.pins) if (!p.hard) n++;
    if (c.region?.kind === 'entities' && !c.region.hard) n += c.region.entities.length;
  }
  return n;
}

// The one place a plan becomes the live one. Everything the hot path reads —
// itemPlan, itemOrder, itemSoftUnits, the geometry cache — is set together here so
// the four can never disagree.
function installItemPlan(entries) {
  itemGeomCache = new Map();
  if (!entries || !entries.length) {
    itemPlan = null; itemOrder = []; itemSoftUnits = 0;
    return null;
  }
  itemPlan      = buildItemPlan(entries);
  itemOrder     = Object.keys(itemPlan).sort();
  itemSoftUnits = planSoftUnits(itemPlan);
  return itemPlan;
}

// How many cells an item reserves out of its scope.
function itemNeed(cfg) {
  if (!cfg.region) return 0;
  if (cfg.region.kind === 'entities')  return cfg.region.entities.length;
  if (cfg.region.kind === 'keepClear') return cfg.region.need;
  return 0;   // neighborBuff holds nothing back — it only reads what's already there
}

// ── Geometry ─────────────────────────────────────────────────────

// Scope and zone cell lists are pure functions of (item, cell, grid), and the
// scorer asked for them tens of thousands of times a second — rebuilding eight
// template-literal keys and calling isActiveCell on each was ~10% of a scorer
// call per region item. Cleared whenever the plan is rebuilt.
let itemGeomCache = new Map();

// Nested token -> cellIndex -> cells, on a NUMERIC cell index. A compound string key
// would rebuild a template literal on every lookup, which is the whole cost this
// cache exists to avoid.
function geomSlot(kind, token) {
  let byToken = itemGeomCache.get(kind);
  if (!byToken) { byToken = new Map(); itemGeomCache.set(kind, byToken); }
  let byCell = byToken.get(token);
  if (!byCell) { byCell = new Map(); byToken.set(token, byCell); }
  return byCell;
}

// COLS is 6, so this is collision-free and stays a small integer.
function cellIndex(row, col) { return row * 16 + col; }

function itemScopeCells(cfg, row, col, maxRow) {
  if (!cfg.scope) return [];
  const slot = geomSlot('s', cfg.token);
  const ci   = cellIndex(row, col);
  const hit  = slot.get(ci);
  if (hit) return hit;

  const out = [];
  const push = (r, c) => { if (r <= maxRow && isActiveCell(r, c)) out.push(`${r},${c}`); };
  if (cfg.scope === 'neighbors8') {
    for (let dr = -1; dr <= 1; dr++)
      for (let dc = -1; dc <= 1; dc++)
        if (dr || dc) push(row + dr, col + dc);
  } else if (cfg.scope === 'ownRow') {
    for (let c = 1; c <= COLS; c++) if (c !== col) push(row, c);
  } else if (cfg.scope === 'topRow') {
    for (let c = 1; c <= COLS; c++) if (row !== 1 || c !== col) push(1, c);
  }
  slot.set(ci, out);
  return out;
}

// Cells that must stay unoccupied whatever happens: hard exclusions, plus the
// cells the item's own pins target (a pinned neighbour with a tablet on it is
// meaningless — the same reason pinScore skips occupied cells).
//
// Scope cells are deliberately NOT here. Reserving a whole scope is what the old
// model did; now only `need` of them are held, and which ones is a search
// decision — see the quota groups in makeBoardCtx.
function itemZoneCells(cfg, row, col, maxRow) {
  const slot = geomSlot('z', cfg.token);
  const ci   = cellIndex(row, col);
  const hit  = slot.get(ci);
  if (hit) return hit;

  const out = [];
  const push = (r, c) => { if (r <= maxRow && isActiveCell(r, c)) out.push(`${r},${c}`); };
  for (const [dx, dy] of cfg.exclude) push(row - dy, col + dx);
  for (const p of cfg.pins)           push(row - p.dy, col + p.dx);
  slot.set(ci, out);
  return out;
}

// Would this item work here, given what's already on the board? Its fixed zone
// must be clear and its scope must still be able to give up `need` cells.
function itemPlaceable(cfg, row, col, maxRow, placements) {
  for (const k of itemZoneCells(cfg, row, col, maxRow))
    if (placements[k]) return false;

  const need = itemNeed(cfg);
  if (!need) return true;
  const tabletsOnly = cfg.region.kind === 'keepClear';
  let free = 0;
  for (const k of itemScopeCells(cfg, row, col, maxRow))
    if (!itemCellTaken(placements, k, tabletsOnly)) free++;
  return free >= need;
}

// "Taken" depends on what the group is protecting against. A keepClear scope only
// forbids TABLETS — items are exactly what the Multipurpose Belt wants up there
// (confirmed in-game), so a Magic Carrot in the top row helps it rather than
// competing with it. An entities scope forbids everything, because the planet or
// companion the user named is the cell's implied occupant.
function itemCellTaken(placements, key, tabletsOnly) {
  const p = placements[key];
  if (!p) return false;
  if (!tabletsOnly) return true;
  return TABLET_MAP[p.tabletId]?.kind !== 'item';
}

// ── Shared claim pass ────────────────────────────────────────────

// Assign `wants` to `cellVals` so as many wants as possible are met, and the
// shortfall on the rest is as small as possible.
//
// Cheapest-satisfying-first, the same reasoning ruleTally uses: taking the
// highest cells first would spend a +7 slot on a Collin (needs 2) while a +2 sat
// unclaimed.
//
// NOTE the returned `claim` is shared scratch — read it before calling again.
// Scratch, reused across calls: this runs a few times per scorer call and the
// scorer runs tens of thousands of times a second, so five fresh arrays per call
// was pure allocation churn. Not reentrant, and doesn't need to be.
const _cgCells = [], _cgWants = [], _cgUsed = [], _cgClaim = [], _cgShort = [];

// Insertion sort — n is at most 8 here, where a comparator sort loses on setup.
function sortIdxByValue(idx, n, vals) {
  for (let i = 1; i < n; i++) {
    const v = idx[i], key = vals[v];
    let j = i - 1;
    while (j >= 0 && vals[idx[j]] > key) { idx[j + 1] = idx[j]; j--; }
    idx[j + 1] = v;
  }
}

function claimGreedy(cellVals, wants) {
  const nc = cellVals.length, nw = wants.length;
  for (let i = 0; i < nc; i++) { _cgCells[i] = i; _cgUsed[i] = false; }
  for (let i = 0; i < nw; i++) { _cgWants[i] = i; _cgClaim[i] = -1; }
  sortIdxByValue(_cgCells, nc, cellVals);
  sortIdxByValue(_cgWants, nw, wants);

  let met = 0, dist = 0, ns = 0;
  for (let wi = 0; wi < nw; wi++) {
    const w = _cgWants[wi];
    let found = -1;
    for (let k = 0; k < nc; k++) {
      const c = _cgCells[k];
      if (!_cgUsed[c] && cellVals[c] >= wants[w]) { found = c; break; }
    }
    if (found >= 0) { _cgUsed[found] = true; _cgClaim[w] = found; met++; }
    else _cgShort[ns++] = w;
  }

  // Leftovers pair ascending-with-ascending, which minimises the total shortfall
  // (rearrangement inequality) so the climber still gets a gradient.
  let k = 0;
  for (let j = 0; j < ns; j++) {
    while (k < nc && _cgUsed[_cgCells[k]]) k++;
    if (k >= nc) { dist += ITEM_MISS_CAP; continue; }   // no cell at all for this want
    const c = _cgCells[k];
    _cgUsed[c] = true;
    _cgClaim[_cgShort[j]] = c;
    dist += Math.max(0, wants[_cgShort[j]] - cellVals[c]);
  }
  return { met, dist, claim: _cgClaim };
}

// ── Board context ────────────────────────────────────────────────

// Maintained alongside `placements` so the search can ask "may anything sit here?"
// in O(1). Counters rather than sets, because two items may reserve the same cell
// and removing one must not free it.
function makeBoardCtx(maxRow, placements = {}) {
  return {
    maxRow,
    placements,            // live reference, so quotas can be recounted
    zoneN:   new Map(),    // "r,c" -> how many placed items forbid occupancy outright
    exemptN: new Map(),    // "r,c" -> how many placed granters exempt an item here
    groups:  [],           // quota groups, one per placed region item
    byCell:  new Map(),    // "r,c" -> groups covering it

    _bump(map, key, d) {
      const n = (map.get(key) || 0) + d;
      if (n > 0) map.set(key, n); else map.delete(key);
    },

    add(key, placement)    { this._each(key, placement, +1); this._recount(); },
    remove(key, placement) { this._each(key, placement, -1); this._recount(); },

    _each(key, placement, d) {
      const td = TABLET_MAP[placement.tabletId];
      if (!td) return;
      const [row, col] = key.split(',').map(Number);
      const cfg = itemPlan && itemPlan[placement.tabletId];
      if (cfg) {
        for (const k of itemZoneCells(cfg, row, col, this.maxRow)) this._bump(this.zoneN, k, d);
        const need = itemNeed(cfg);
        if (need) {
          if (d > 0) {
            const g = { token: cfg.token, need, free: 0,
                        tabletsOnly: cfg.region.kind === 'keepClear',
                        cells: itemScopeCells(cfg, row, col, this.maxRow) };
            this.groups.push(g);
            for (const k of g.cells) {
              if (!this.byCell.has(k)) this.byCell.set(k, []);
              this.byCell.get(k).push(g);
            }
          } else {
            const i = this.groups.findIndex(g => g.token === cfg.token);
            if (i >= 0) {
              const [g] = this.groups.splice(i, 1);
              for (const k of g.cells) {
                const list = this.byCell.get(k);
                if (!list) continue;
                const j = list.indexOf(g);
                if (j >= 0) list.splice(j, 1);
                if (!list.length) this.byCell.delete(k);
              }
            }
          }
        }
      }
      for (const k of exemptCellsFor(td, col, row, placement.rotation))
        this._bump(this.exemptN, k, d);
    },

    // Recomputed rather than tracked incrementally: `add` runs after `placements`
    // is mutated at some call sites and `rebuild` walks a full map at others, so a
    // running counter drifts between the two conventions. Groups are few and small.
    _recount() {
      const p = this.placements;
      if (!p) return;
      for (const g of this.groups) {
        let free = 0;
        for (const k of g.cells) if (!itemCellTaken(p, k, g.tabletsOnly)) free++;
        g.free = free;
      }
    },

    // `isItem` matters: a keepClear scope only holds cells back from tablets.
    blocked(key, isItem) {
      if ((this.zoneN.get(key) || 0) > 0) return true;
      const gs = this.byCell.get(key);
      if (!gs) return false;
      for (const g of gs) {
        if (g.tabletsOnly && isItem) continue;
        if (itemCellTaken(this.placements, key, g.tabletsOnly)) continue;  // already counted
        if (g.free <= g.need) return true;
      }
      return false;
    },

    isExempt(key) { return (this.exemptN.get(key) || 0) > 0; },

    rebuild(placements) {
      this.placements = placements;
      this.zoneN.clear();
      this.exemptN.clear();
      this.groups = [];
      this.byCell = new Map();
      for (const key in placements) this._each(key, placements[key], +1);
      this._recount();
      return this;
    },

    // Full revalidation: nothing sits where it may not, and every item is on a
    // cell it's allowed to be on. Cheap enough to run per localSearch move.
    legal(placements) {
      this.placements = placements;
      if (!itemPlan) return true;
      for (const key in placements) {
        if ((this.zoneN.get(key) || 0) > 0) return false;
        const cfg = itemPlan[placements[key].tabletId];
        if (!cfg) continue;
        const ix = key.indexOf(',');
        const row = +key.slice(0, ix), col = +key.slice(ix + 1);
        if (!itemAllowedAt(cfg, col, row, this.maxRow, this)) return false;
      }
      for (const g of this.groups) if (g.free < g.need) return false;
      return true;
    },
  };
}

// ── Scoring ──────────────────────────────────────────────────────

// Try mode has no number to aim at, so it can't grade a distance. Half the credit
// for being alive at all, half for reaching the item's own full-potential bracket.
// Saturating at `full` is honest: nothing in game rewards going past it.
function tryUnit(v, full) {
  const alive = v >= 0 ? 0.5 : 0;
  if (full <= 0) return alive * 2;
  return alive + 0.5 * Math.max(0, Math.min(v, full)) / full;
}

// One scorer pass over every planned item. Returns the score contribution and the
// cells entity regions have spoken for, so ruleTally can leave those alone —
// computing that separately meant doing all this geometry twice per call.
const EMPTY_RESERVED = new Set();

// More reused scratch, same reasoning as claimGreedy's: these are rebuilt on every
// scorer call and the allocations cost more than the work they hold.
const _atMap    = new Map();
const _rgCells  = [], _rgVals = [];
const _pgVals   = [], _pgWants = [];

function itemEvaluate(bm, placements, maxRow) {
  // Allocating a Set (and the result object) on every call showed up as a flat tax
  // on the whole solve even with no items configured.
  if (!itemPlan) return { score: 0, reserved: EMPTY_RESERVED };

  let hard = 0, soft = 0;
  let reserved = null, claimedGlobal = null;

  // Grade one cell against one want, in whichever tier the objective asked for.
  const grade = (v, want, isHard, full) => {
    if (!isHard) { soft += tryUnit(v, full); return; }
    // Two independent steps. Without the activation one, an item at +3 (working)
    // and one at -5 (dead) differ only by a capped distance term, and the search
    // will trade a live item for a dead one to gain a point elsewhere.
    hard += v >= 0    ? ITEM_W : -ITEM_MISS_W * Math.min(-v,       ITEM_MISS_CAP);
    hard += v >= want ? ITEM_W : -ITEM_MISS_W * Math.min(want - v, ITEM_MISS_CAP);
  };

  // Where each item ended up, resolved once. `for...in` rather than Object.entries:
  // entries allocates a pair array per placement, and this runs on every one of tens
  // of thousands of scorer calls.
  const at = _atMap;
  at.clear();
  for (const key in placements) {
    const t = placements[key].tabletId;
    if (itemPlan[t]) at.set(t, key);
  }

  for (const token of itemOrder) {
    const cfg = itemPlan[token];
    const key = at.get(token);
    if (!key) continue;                       // unplaced — reported, not scored
    const ix = key.indexOf(',');
    const row = +key.slice(0, ix), col = +key.slice(ix + 1);

    grade(bm[key] || 0, cfg.want, cfg.hard, cfg.full);

    for (const grp of cfg.pinGroups) {
      if (grp.length === 1) {
        const pin = cfg.pins[grp[0]];
        const r = row - pin.dy, c = col + pin.dx;
        if (r <= maxRow && isActiveCell(r, c)) grade(bm[`${r},${c}`] || 0, pin.value, pin.hard, cfg.full);
        continue;
      }
      // Grouped: the values aren't tied to a particular side.
      const vals = _pgVals, wants = _pgWants;
      vals.length = 0; wants.length = 0;
      for (const i of grp) {
        const pin = cfg.pins[i];
        const r = row - pin.dy, c = col + pin.dx;
        vals.push(r <= maxRow && isActiveCell(r, c) ? (bm[`${r},${c}`] || 0) : 0);
        wants.push(pin.value);
      }
      const res = claimGreedy(vals, wants);
      const anyHard = grp.some(i => cfg.pins[i].hard);
      if (anyHard) {
        hard += res.met * ITEM_W;
        hard -= ITEM_MISS_W * Math.min(res.dist, ITEM_MISS_CAP);
      } else {
        for (const v of vals) soft += tryUnit(v, cfg.full);
      }
    }

    if (cfg.region?.kind === 'entities' && cfg.region.entities.length) {
      if (!reserved) { reserved = new Set(); claimedGlobal = reserved; }
      const { cells, vals, res } = claimRegion(cfg, bm, placements, row, col, maxRow, claimedGlobal);
      const wants = cfg.region.wants;
      for (let i = 0; i < wants.length; i++) {
        const ci = res.claim[i];
        if (ci < 0) continue;
        reserved.add(cells[ci]);   // also the disjointness set — a claimed cell is spoken for
      }
      if (cfg.region.hard) {
        hard += res.met * ITEM_W;
        hard -= ITEM_MISS_W * Math.min(res.dist, ITEM_MISS_CAP);
        hard -= ITEM_MISS_W * Math.max(0, wants.length - cells.length) * 2;  // no room at all
      } else {
        for (let i = 0; i < wants.length; i++) {
          const ci = res.claim[i];
          soft += tryUnit(ci >= 0 ? vals[ci] : -1, wants[i] || 1);
        }
      }
    }
    // keepClear regions score nothing at all — they are pure legality.
  }

  return { score: hard + (itemSoftUnits ? SOFT_BUDGET * soft / itemSoftUnits : 0),
           reserved: reserved || EMPTY_RESERVED };
}

function itemScore(bm, placements, maxRow) {
  return itemEvaluate(bm, placements, maxRow).score;
}

// Which free scope cells this item's entities lay claim to. Shared by scoring, the
// breakdown and the grid ghosts, so the picture on screen is the one the solver
// actually scored rather than a lookalike derived a second time.
//
// Returns shared scratch — read it before calling again.
function claimRegion(cfg, bm, placements, row, col, maxRow, claimedGlobal) {
  const cells = _rgCells, vals = _rgVals;
  cells.length = 0; vals.length = 0;
  for (const k of itemScopeCells(cfg, row, col, maxRow)) {
    if (placements[k] || (claimedGlobal && claimedGlobal.has(k))) continue;  // disjoint across items
    cells.push(k); vals.push(bm[k] || 0);
  }
  return { cells, vals, res: claimGreedy(vals, cfg.region.wants) };
}

// Cell -> the name of the thing the user said they'd put there, for the grid to draw
// faintly. Covers both the Grimoire an Hourglass buffs and the Planets / Companions a
// Telescope or Insignia is holding slots for.
function itemGhostCells(bm, placements, maxRow) {
  const out = {};
  if (!itemPlan) return out;

  const at = new Map();
  for (const key in placements) {
    const t = placements[key].tabletId;
    if (itemPlan[t]) at.set(t, key);
  }

  const claimed = new Set();
  for (const token of itemOrder) {
    const cfg = itemPlan[token];
    const key = at.get(token);
    if (!key) continue;
    const ix = key.indexOf(',');
    const row = +key.slice(0, ix), col = +key.slice(ix + 1);

    for (const pin of cfg.pins) {
      if (!pin.entity) continue;
      const r = row - pin.dy, c = col + pin.dx;
      const gk = `${r},${c}`;
      if (r <= maxRow && isActiveCell(r, c) && !placements[gk]) out[gk] = pin.entity;
    }

    if (cfg.region?.kind === 'entities' && cfg.region.entities.length) {
      const { cells, res } = claimRegion(cfg, bm, placements, row, col, maxRow, claimed);
      cfg.region.entities.forEach((e, i) => {
        const ci = res.claim[i];
        if (ci < 0) return;
        claimed.add(cells[ci]);
        out[cells[ci]] = e.name;
      });
    }
  }
  return out;
}

// ── Post-hoc placement ───────────────────────────────────────────

// Total buff across a cell's neighbourhood, counting only slots that could actually
// hold something of yours: a slot with a TABLET on it doesn't count, while an empty
// slot or one holding another item does.
function neighborBuffSum(cfg, bm, placements, row, col, maxRow) {
  let sum = 0;
  for (const k of itemScopeCells(cfg, row, col, maxRow))
    if (!itemCellTaken(placements, k, true)) sum += bm[k] || 0;
  return sum;
}

// Items flagged `posthoc` never entered the search: they can't change where a tablet
// wants to go, so letting them compete for cells during construction only made the
// solve slower and the layouts worse. Once the board is settled, the best spot for
// them is a straight scan.
//
// Mutates `placements`. Safe to run before scoring — these items own their cell like
// any other, so stats, signature and the grid all see them.
function placePosthocItems(placements, maxRow) {
  if (!itemPlan) return placements;
  const tokens = itemOrder.filter(t => itemPlan[t].posthoc);
  if (!tokens.length) return placements;

  for (const token of tokens) {
    const cfg = itemPlan[token];
    // Both recomputed per item: placing one changes the neighbourhood of the next,
    // and consumes a cell another item's zone may have been counting on.
    const bm  = computeBuffMap(placements, maxRow);
    const ctx = makeBoardCtx(maxRow, placements).rebuild(placements);
    let best = null, bestKey = null;

    for (let r = 1; r <= maxRow; r++)
      for (let c = 1; c <= COLS; c++) {
        const key = `${r},${c}`;
        if (!isActiveCell(r, c) || placements[key] || slotTargets[key]) continue;
        // A zone reserving cells for a planet or companion has first claim on them —
        // dropping a late item there would quietly break a quota the search satisfied.
        if (ctx.blocked(key, true)) continue;
        if (!itemAllowedAt(cfg, c, r, maxRow, ctx)) continue;

        const own = bm[key] || 0;
        const near = cfg.region?.kind === 'neighborBuff'
          ? neighborBuffSum(cfg, bm, placements, r, c, maxRow) : 0;
        // An item in a negative slot does nothing at all, so being alive outranks
        // any amount of neighbouring buff; after that, richest neighbourhood wins,
        // and its own slot value breaks the tie.
        const rank = [own >= 0 ? 1 : 0, near, own];
        if (!best || rank[0] > best[0] ||
           (rank[0] === best[0] && (rank[1] > best[1] ||
           (rank[1] === best[1] && rank[2] > best[2])))) { best = rank; bestKey = key; }
      }

    if (bestKey) placements[bestKey] = { tabletId: token, rotation: 0 };
  }
  return placements;
}

// ── Reporting ────────────────────────────────────────────────────

// Position class alone, with no exemption and no pin/scope geometry — the breakdown
// needs to say "it's off-class but a Link is exempting it", which needs the two apart.
function itemClassOk(cfg, col, row, maxRow) {
  if (!cfg.posClass) return true;
  switch (cfg.posClass) {
    case 'top':       return row === 1;
    case 'bottom':    return row === bottomRowForCol(col);
    case 'left':      return col === 1;
    case 'right':     return col === COLS;
    case 'outermost': return isOutermost(row, col);
    case 'innermost': return !isOutermost(row, col);
    case 'rowphase':  return ((row - 1) % 4) === cfg.phase;
    default:          return true;
  }
}

function itemState(v, full) {
  if (v < 0) return 'inactive';
  return v >= full ? 'full' : 'partial';
}

// Counts for the stats bar and the results table. "Active" is the honest headline:
// an item only does nothing when its slot is negative.
function itemStats(bm, placements, maxRow) {
  let active = 0, full = 0, tot = 0, unplaced = 0;
  if (!itemPlan) return { active, full, tot, unplaced };

  const at = {};
  for (const [key, p] of Object.entries(placements))
    if (itemPlan[p.tabletId]) at[p.tabletId] = key;

  for (const token of itemOrder) {
    const cfg = itemPlan[token];
    tot++;
    const key = at[token];
    if (!key) { unplaced++; continue; }
    const v = bm[key] || 0;
    if (v >= 0)        active++;
    if (v >= cfg.full) full++;
  }
  return { active, full, tot, unplaced };
}

// Result-time only, never on the hot path. Iterates the PLAN rather than the
// placements, so an item the search never managed to place is reported instead of
// silently vanishing.
function itemBreakdown(bm, placements, maxRow) {
  if (!itemPlan) return null;

  const at = {};
  for (const [key, p] of Object.entries(placements))
    if (itemPlan[p.tabletId]) at[p.tabletId] = key;

  const ctx = makeBoardCtx(maxRow, placements).rebuild(placements);
  const out = [];

  for (const token of itemOrder) {
    const cfg = itemPlan[token];
    const key = at[token];
    if (!key) {
      out.push({ token, name: cfg.name, sprite: cfg.sprite, placed: false,
                 satisfied: false, self: { state: 'unplaced' }, pins: [], region: null });
      continue;
    }
    const [row, col] = key.split(',').map(Number);
    const v = bm[key] || 0;

    // An exemption can legitimately waive a position class, so record why it's
    // there rather than just that it's off-class.
    const classOk  = itemClassOk(cfg, col, row, maxRow);
    const exempted = !classOk && ctx.isExempt(key);

    const pins = [];
    for (const grp of cfg.pinGroups) {
      const vals = [], wants = [], cells = [];
      for (const i of grp) {
        const pin = cfg.pins[i];
        const r = row - pin.dy, c = col + pin.dx;
        const ok = r <= maxRow && isActiveCell(r, c);
        cells.push(ok ? `${r},${c}` : null);
        vals.push(ok ? (bm[`${r},${c}`] || 0) : 0);
        wants.push(pin.value);
      }
      const res = claimGreedy(vals, wants);
      for (let i = 0; i < wants.length; i++) {
        const ci = res.claim[i];
        pins.push({ cell: ci >= 0 ? cells[ci] : null, v: ci >= 0 ? vals[ci] : null,
                    want: wants[i], hard: cfg.pins[grp[i]].hard,
                    met: ci >= 0 && vals[ci] >= wants[i] });
      }
    }

    let region = null;
    if (cfg.region?.kind === 'entities') {
      const ghosts = itemGhostCells(bm, placements, maxRow);
      const ents = cfg.region.entities.map(e => {
        const cell = Object.keys(ghosts).find(k => ghosts[k] === e.name) || null;
        const cv = cell ? (bm[cell] || 0) : null;
        return { name: e.name, want: e.value, cell, v: cv, met: cv !== null && cv >= e.value };
      });
      region = { kind: 'entities', entities: ents, need: ents.length,
                 claimed: ents.filter(e => e.cell).length, hard: cfg.region.hard };
    } else if (cfg.region?.kind === 'neighborBuff') {
      region = { kind: 'neighborBuff',
                 total: neighborBuffSum(cfg, bm, placements, row, col, maxRow),
                 met: true };   // a maximization has no bar to fall short of
    } else if (cfg.region?.kind === 'keepClear') {
      const cells = itemScopeCells(cfg, row, col, maxRow);
      const free  = cells.filter(k => !itemCellTaken(placements, k, true)).length;
      region = { kind: 'keepClear', need: cfg.region.need, free, met: free >= cfg.region.need };
    }

    const state = itemState(v, cfg.full);
    const satisfied = classOk || exempted
      ? state !== 'inactive'
        && (!cfg.hard || v >= cfg.want)
        && pins.every(p => !p.hard || p.met)
        && (!region ? true
            : region.kind === 'entities'
              ? (!cfg.region.hard || region.entities.every(e => e.met))
              : region.met)
      : false;

    out.push({ token, name: cfg.name, sprite: cfg.sprite, placed: true, cell: key,
               classOk, exempted, posClass: cfg.posClass, phase: cfg.phase, row,
               self: { v, want: cfg.want, full: cfg.full, state, hard: cfg.hard },
               pins, region, satisfied });
  }
  return out;
}
