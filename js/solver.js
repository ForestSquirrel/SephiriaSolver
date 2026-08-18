// Solver algorithm — no DOM access except setLog / setMode (UI helpers in ui.js).
// Depends on: state.js, engine.js

async function runSolver() {
  const ids       = Object.keys(collection).map(Number).filter(id => collection[id] > 0);
  const mergedIds = mergedTablets.map(mt => mt.id);
  if (!ids.length && !mergedIds.length) { setLog('Add tablets to collection first', 'err'); return; }

  const btn = document.getElementById('solve-btn');
  btn.disabled = true;
  btn.classList.add('running');
  setLog('Solving…');
  solverResults    = [];
  appliedResultIdx = -1;
  renderResults();
  await new Promise(r => setTimeout(r, 10)); // let UI repaint

  const maxRow    = totalRows();
  const targetVal = parseInt(document.getElementById('target-val').value) || 3;
  const highVal   = parseInt(document.getElementById('highval-val').value) || 5;

  // Resolved once per solve, like restCeil — the scorer must not re-derive item
  // config out of the dialog's data shape on every one of tens of thousands of calls.
  installItemPlan(solverItems);

  const usingRules = solverEngine === 'ruleset';
  if (usingRules) {
    const bad = validateRules();
    if (bad) { setLog(bad, 'err'); btn.disabled = false; btn.classList.remove('running'); return; }
    // Hoisted out of the scorer — it's a pure function of `rules`, and the scorer
    // runs tens of thousands of times per solve. Null when there's no rule to
    // derive a bar from, which means "just push the buff as high as it goes".
    restCeil = derivedRestCeiling();
  }
  const badItems = validateItems();
  if (badItems) { setLog(badItems, 'err'); btn.disabled = false; btn.classList.remove('running'); return; }

  const scoreOf = usingRules
    ? p => scoreRules(computeBuffMap(p, maxRow), p, maxRow)
    : p => scoreP(p, maxRow, solveMode, targetVal, highVal);

  const pool = [];
  for (const id of ids)
    for (let n = 0; n < collection[id]; n++) pool.push(id);
  for (const id of mergedIds) pool.push(id);

  // Items ride the same placements map but are seeded separately — see below.
  // Post-hoc items are deliberately absent: they can't influence where a tablet wants
  // to go, so competing for cells during the search only costs time.
  const itemPool = itemPlan ? itemOrder.filter(t => !itemPlan[t].posthoc) : [];

  const allCells = [];
  for (let r = 1; r <= maxRow; r++)
    for (let c = 1; c <= COLS; c++)
      // Cells the user pinned to a value must stay empty to receive that value
      if (isActiveCell(r, c) && !slotTargets[`${r},${c}`]) allCells.push({ row: r, col: c });
  const cellKeys = allCells.map(({ row, col }) => `${row},${col}`);

  // Where each item may sit ignoring exemptions — a pure function of its config and
  // the grid, so it's computed once rather than per run. localSearch widens this with
  // whatever cells are exempt at the time.
  const baseLegalCells = {};
  for (const token of itemPool) {
    const cfg = itemPlan[token];
    baseLegalCells[token] = allCells
      .filter(({ row, col }) => itemAllowedAt(cfg, col, row, maxRow, null))
      .map(({ row, col }) => `${row},${col}`);
  }

  const seen    = new Set();
  const results = [];

  // The search is bounded by wall clock rather than a run count: every attempt
  // yields a distinct layout, so time and options are interchangeable, but only
  // time is bounded no matter how big the grid or collection gets.
  const MIN_RUNS  = 3;                          // the panel always shows three cards
  const startedAt = Date.now();
  const deadline  = startedAt + searchBudgetMs;
  solverCancelled = false;
  showSolveProgress(true);

  for (let run = 0; ; run++) {
    const placements = {};
    const remaining  = shuffle([...pool]);
    const ctx        = makeBoardCtx(maxRow, placements);

    // Items are seeded first, into a random legal cell rather than a scored one. On an
    // empty board the buff map is 0 everywhere, so every legal cell scores identically
    // on an item's own bracket value — a greedy pass would cost one full-board rescore
    // per candidate and buy nothing but arbitrary tie-breaking. Going first also means
    // their reserved cells exist before tablets compete for them. All of the placement
    // *quality* therefore comes from localSearch's item-relocate move.
    for (const token of shuffle([...itemPool])) {
      const cfg = itemPlan[token];
      const key = shuffle([...baseLegalCells[token]])
        .find(k => {
          if (placements[k] || ctx.blocked(k, true)) return false;
          const [r, c] = k.split(',').map(Number);
          return itemPlaceable(cfg, r, c, maxRow, placements);
        });
      if (!key) continue;
      const p = { tabletId: token, rotation: 0 };
      placements[key] = p;
      ctx.add(key, p);
    }

    for (const tabletId of remaining) {
      const td = TABLET_MAP[tabletId];
      const rotations = td.disableRotate ? [0] : (td.effectiveRotations ?? [0, 1, 2, 3]);
      let bestScore = -Infinity, bestKey = null, bestRot = 0;

      for (const { row, col } of shuffle([...allCells])) {
        const key = `${row},${col}`;
        if (placements[key]) continue;
        if (ctx.blocked(key, false)) continue;   // reserved by a placed item
        if (!checkActivation(td, col, row, maxRow)) continue;
        for (const rot of rotations) {
          const tempP = { ...placements, [key]: { tabletId, rotation: rot } };
          const sc = scoreOf(tempP);
          if (sc > bestScore) { bestScore = sc; bestKey = key; bestRot = rot; }
        }
      }
      if (bestKey) {
        const p = { tabletId, rotation: bestRot };
        placements[bestKey] = p;
        ctx.add(bestKey, p);               // a granter's exemptions come into play here
      }
    }

    localSearch(placements, maxRow, scoreOf, cellKeys, 300, ctx, baseLegalCells);

    // Settled board — now drop in the items that only wanted a good seat.
    placePosthocItems(placements, maxRow);

    const sig = signature(placements);
    if (!seen.has(sig)) {
      seen.add(sig);
      const bm = computeBuffMap(placements, maxRow);
      const breakdown = usingRules ? ruleBreakdown(bm, placements, maxRow) : null;
      const items     = itemPlan ? itemBreakdown(bm, placements, maxRow) : null;
      results.push({
        placements: JSON.parse(JSON.stringify(placements)),
        score:      scoreOf(placements),
        buffMap:    bm,
        ruleBreakdown:  breakdown,
        rulesSatisfied: breakdown ? breakdown.every(b => b.satisfied) : true,
        itemBreakdown:  items,
        itemsSatisfied: items ? items.every(b => b.satisfied) : true,
        // Computed once here rather than per row in the results table, which can
        // render hundreds of rows and re-render on every filter keystroke.
        stats: resultStats(placements, bm, maxRow),
      });
    }

    // Budget is checked *between* runs — a run is atomic, so a solve can overshoot
    // by up to one run. MIN_RUNS can likewise overshoot a small budget on a big grid.
    if (solverCancelled) break;
    if (run + 1 >= MIN_RUNS && Date.now() >= deadline) break;
    updateSolveProgress(startedAt, deadline, results.length);
    await yieldToUI();
  }
  showSolveProgress(false);

  // A layout that clears the ruleset outranks one that doesn't, whatever the tiers
  // worked out to — the weights make that almost always true anyway, but "almost"
  // isn't good enough for what gets shown as Option 1.
  results.sort((a, b) => (b.rulesSatisfied - a.rulesSatisfied)
                      || (b.itemsSatisfied - a.itemsSatisfied)
                      || (b.score - a.score));
  // Everything is kept — renderResults shows the top three, the table browses the rest.
  solverResults = results;

  btn.disabled = false;
  btn.classList.remove('running');
  const n     = solverResults.length;
  const secs  = ((Date.now() - startedAt) / 1000).toFixed(1);
  const shortRules = usingRules && n && !solverResults[0].rulesSatisfied;
  const shortItems = n && !solverResults[0].itemsSatisfied;
  const missed = [shortRules && 'rule', shortItems && 'item'].filter(Boolean).join(' and ');
  setLog(solverCancelled
    ? `Cancelled — ${n} solution(s) kept`
    : missed
    ? `Done in ${secs}s — ${n} solution(s), but no placement met every ${missed} requirement`
    : `Done in ${secs}s — ${n} solution(s) found`,
    missed ? 'err' : 'ok');
  renderResults();
}

// One macrotask between runs so the browser can repaint the progress bar. Nested
// timers get clamped to ~4ms, which is under 1% of a 50-400ms run.
function yieldToUI() {
  return new Promise(r => setTimeout(r, 0));
}

function localSearch(placements, maxRow, scoreOf, cellKeys, iters, ctx, baseLegalCells) {
  const keys = Object.keys(placements);
  // Items make some moves illegal rather than merely worse, so every move that would
  // land on an illegal board is reverted outright. ctx.legal is a full revalidation,
  // but it's ~200 ops against a scorer that walks the whole buff map.
  const hasItems = !!itemPlan;
  const itemKeys = () => keys.filter(k => placements[k] && itemPlan[placements[k].tabletId]);

  for (let i = 0; i < iters; i++) {
    const base = scoreOf(placements);
    if (keys.length > 0) {
      const k  = keys[Math.floor(Math.random() * keys.length)];
      const td = TABLET_MAP[placements[k].tabletId];
      if (!td.disableRotate) {
        const orig = placements[k].rotation;
        placements[k].rotation = (orig + 1 + Math.floor(Math.random() * 3)) % 4;
        // Rotating a granter moves its exemptions, which can strand an item that was
        // only legal because of them.
        if (hasItems && td.grantsExemption) ctx.rebuild(placements);
        if (scoreOf(placements) < base || (hasItems && !ctx.legal(placements))) {
          placements[k].rotation = orig;
          if (hasItems && td.grantsExemption) ctx.rebuild(placements);
        }
      }
    }
    if (keys.length >= 2) {
      const i1 = Math.floor(Math.random() * keys.length);
      let   i2 = Math.floor(Math.random() * keys.length);
      if (i2 === i1) continue;
      const [k1, k2] = [keys[i1], keys[i2]];
      const [r1, c1] = k1.split(',').map(Number);
      const [r2, c2] = k2.split(',').map(Number);
      if (!placementAllowed(TABLET_MAP[placements[k2].tabletId], c1, r1, maxRow, ctx)) continue;
      if (!placementAllowed(TABLET_MAP[placements[k1].tabletId], c2, r2, maxRow, ctx)) continue;
      const tmp = placements[k1];
      placements[k1] = placements[k2];
      placements[k2] = tmp;
      // The pairwise checks above can't see a swap dropping a tablet into an item's
      // reserved zone, so the board is revalidated as a whole.
      if (hasItems) ctx.rebuild(placements);
      if (scoreOf(placements) < base || (hasItems && !ctx.legal(placements))) {
        const tmp2 = placements[k1];
        placements[k1] = placements[k2];
        placements[k2] = tmp2;
        if (hasItems) ctx.rebuild(placements);
      }
    }

    // Relocate: move one tablet to a free cell. Swaps alone can never pull a tablet
    // into a region the greedy pass ignored (e.g. next to a pinned slot).
    if (keys.length > 0 && cellKeys && cellKeys.length) {
      const moveBase = scoreOf(placements);
      const ki   = Math.floor(Math.random() * keys.length);
      const from = keys[ki];
      const to   = cellKeys[Math.floor(Math.random() * cellKeys.length)];
      const movingItem = !!(hasItems && itemPlan[placements[from].tabletId]);
      if (!placements[to] && !(hasItems && ctx.blocked(to, movingItem))) {
        const [tr, tc] = to.split(',').map(Number);
        if (placementAllowed(TABLET_MAP[placements[from].tabletId], tc, tr, maxRow, ctx)) {
          placements[to] = placements[from];
          delete placements[from];
          if (hasItems) ctx.rebuild(placements);
          if (scoreOf(placements) < moveBase || (hasItems && !ctx.legal(placements))) {
            placements[from] = placements[to];
            delete placements[to];
            if (hasItems) ctx.rebuild(placements);
          } else {
            keys[ki] = to;
          }
        }
      }
    }

    // Item insert. Construction skips an item it can't seed (solver.js's `if (!key)
    // continue`), and nothing else ever retries — so without this a dropped item stays
    // dropped for the whole run. Matters more now that reservations are looser.
    if (hasItems && baseLegalCells) {
      const placedTokens = new Set(Object.values(placements).map(p => p.tabletId));
      // Post-hoc items are placed after the search, so they are not "missing" here.
      const missing = itemOrder.filter(t => !placedTokens.has(t) && !itemPlan[t].posthoc);
      if (missing.length) {
        const token = missing[Math.floor(Math.random() * missing.length)];
        const cands = baseLegalCells[token] || [];
        if (cands.length) {
          const to = cands[Math.floor(Math.random() * cands.length)];
          const [tr, tc] = to.split(',').map(Number);
          if (!placements[to] && !ctx.blocked(to, true) &&
              itemPlaceable(itemPlan[token], tr, tc, maxRow, placements)) {
            const insBase = scoreOf(placements);
            placements[to] = { tabletId: token, rotation: 0 };
            ctx.rebuild(placements);
            if (scoreOf(placements) < insBase || !ctx.legal(placements)) {
              delete placements[to];
              ctx.rebuild(placements);
            } else {
              keys.push(to);
            }
          }
        }
      }
    }

    // Item relocate. The generic move above picks a destination from the whole grid,
    // so a top-row item's six legal cells come up ~10% of the time and items would
    // effectively never move — yet construction placed them at random, so this is
    // where all of their placement quality comes from.
    if (hasItems && baseLegalCells) {
      const iks = itemKeys();
      if (iks.length) {
        const moveBase = scoreOf(placements);
        const from  = iks[Math.floor(Math.random() * iks.length)];
        const token = placements[from].tabletId;
        // Exempt cells widen the legal set beyond what construction could see.
        const cands = baseLegalCells[token].concat(
          cellKeys.filter(k => ctx.isExempt(k) && !baseLegalCells[token].includes(k)));
        if (cands.length) {
          const to = cands[Math.floor(Math.random() * cands.length)];
          const [tr, tc] = to.split(',').map(Number);
          const moved = { ...placements }; delete moved[from];
          if (to !== from && !placements[to] && !ctx.blocked(to, true) &&
              itemPlaceable(itemPlan[token], tr, tc, maxRow, moved)) {
            placements[to] = placements[from];
            delete placements[from];
            ctx.rebuild(placements);
            if (scoreOf(placements) < moveBase || !ctx.legal(placements)) {
              placements[from] = placements[to];
              delete placements[to];
              ctx.rebuild(placements);
            } else {
              const ki2 = keys.indexOf(from);
              if (ki2 >= 0) keys[ki2] = to;
            }
          }
        }
      }
    }
  }
}

// Lexicographic scoring weights. Each tier must outweigh the worst case of the tier
// below it, so a better primary result is never traded away for a better tie-break.
const CELL_W     = 1e4;   // one qualifying slot   (vs. total buff, worst case ~800)
const PIN_MISS_W = 1e5;   // one point closer to an unmet pin (vs. a few qualifying slots)
const PIN_W      = 1e8;   // one satisfied pin     (vs. up to ~90 rules)

// ── Item tier ────────────────────────────────────────────────────
// An item whose own cell never reaches its bracket value does nothing at all in
// game, so a hard item objective must outrank every pin, rule and leftover cell
// combined. Against a 6x10 ceiling:
//   pin tier worst case:  60 cells x PIN_W(1e8)          = 6.0e9
//   rule tier worst case: R rules x RULE_W(1e6), R < 90  < 9.0e7
//   rest tier worst case: 60 x CELL_W(1e4) + total buff  ~ 6.0e5
// ITEM_MISS_W therefore clears the whole pin tier, and the capped gradient tops out
// at 8 x 1e10 = 8e10 — an order below ITEM_W, so the score stays monotonic in the
// number of objectives met. The ceiling (~4.2e13) is well inside float64's exact
// integer range, so the fractional progress terms keep their resolution.
const ITEM_W        = 1e12;  // one satisfied hard item objective
const ITEM_MISS_W   = 1e10;  // one point closer to an unmet one
const ITEM_MISS_CAP = 8;     // same reasoning as MISS_CAP below

// Soft objectives share ONE budget rather than each carrying a weight: there is no
// room between the rest tier (max ~6.02e5) and RULE_W (1e6) for a per-item term —
// two soft items would outrank a rule. Normalizing by a count that's constant within
// a solve keeps the tier above leftover-buff maximization and strictly below a rule.
const SOFT_BUDGET   = 8e5;


function scoreP(placements, maxRow, mode, tv, hv) {
  const bm    = computeBuffMap(placements, maxRow);
  const vals  = activeEmptyCells(placements, maxRow).map(({ key }) => bm[key] || 0);
  const total = vals.reduce((a, b) => a + b, 0);

  let s = 0;
  // Total buff stays the tie-break inside coverage/maximize.
  if (mode === 'coverage')      s = vals.filter(v => v >  0).length  * CELL_W + total;
  else if (mode === 'maximize') s = vals.filter(v => v >= hv).length * CELL_W + total;
  else if (mode === 'target')   s = vals.reduce((a, v) => a + (v >= tv ? 3 : v - tv), 0);

  return s + pinScore(bm, placements) + itemScore(bm, placements, maxRow);
}

// Per-slot desired values. A miss is graded by distance so the hill-climber has a gradient.
function pinScore(bm, placements) {
  let s = 0;
  for (const [k, t] of Object.entries(slotTargets)) {
    const [r, c] = k.split(',').map(Number);
    if (!isActiveCell(r, c) || placements[k]) continue;
    const v = bm[k] || 0;
    s += pinMet(v, t) ? PIN_W : -Math.abs(v - t.value) * PIN_MISS_W;
  }
  return s;
}

function pinMet(v, t) {
  return t.op === 'eq' ? v === t.value : v >= t.value;
}

// ── Ruleset scoring ──────────────────────────────────────────────
// A rule asks for a *count* of slots at some value without saying which slots, so
// the solver keeps its placement freedom and stops spending buff on slots nothing
// asked about. Sits between the pin tier and the leftover tier.

const RULE_W      = 1e6;   // one satisfied rule    (vs. the whole Rest tier, ~4.3e5)
const RULE_MISS_W = 1e5;   // one point closer to an unmet rule
const MISS_CAP    = 8;     // clamp on the miss gradient — uncapped it can outweigh
                           // RULE_W and make the score non-monotonic in rules-met

let restCeil = null;       // set by runSolver, read by restScore; null = no bar

function ruleMet(v, r) {
  if (r.valueOp === 'gte') return v >= r.value;
  if (r.valueOp === 'lte') return v <= r.value;
  return v === r.value;
}

function ruleDist(v, r) {
  if (r.valueOp === 'gte') return Math.max(0, r.value - v);
  if (r.valueOp === 'lte') return Math.max(0, v - r.value);
  return Math.abs(v - r.value);
}

// Rest/maximize derives its bar from the rules rather than asking for another
// number: one below the strictest rule, so leftover slots never bid against the
// scarce high-value cells a rule still needs. Null when there's nothing to derive from.
function derivedRestCeiling() {
  let m = null;
  for (const r of rules)
    if (r.valueOp !== 'lte' && (m === null || r.value > m)) m = r.value;
  return m === null ? null : Math.max(1, m - 1);
}

// Greedy claim pass. Pure — recomputed on every call, since the hill-climber needs
// the score to depend only on `placements`.
function ruleTally(bm, placements, maxRow, reserved) {
  // Cells an entity region has claimed hold that planet or companion, so they are
  // not the rules' to count — otherwise a rule claims the very cell the region
  // bought and it's counted twice. The set comes from the same itemEvaluate pass
  // that scored it, so the two can't disagree.
  //
  // Note a keepClear scope is NOT reserved here: those cells stay genuinely empty
  // and receive buff, so rules should absolutely be allowed to count them.
  const regionCells = reserved || new Set();
  const pool = [];
  for (const { key } of activeEmptyCells(placements, maxRow)) {
    if (slotTargets[key] || regionCells.has(key)) continue;  // not the rules' domain
    pool.push(bm[key] || 0);
  }

  // A mark that's *already* satisfied also counts toward the first rule asking for
  // the same thing, so a pin and a rule don't each demand their own slot.
  const pre = new Array(rules.length).fill(0);
  for (const [k, t] of Object.entries(slotTargets)) {
    const [r, c] = k.split(',').map(Number);
    if (!isActiveCell(r, c) || placements[k]) continue;
    if (!pinMet(bm[k] || 0, t)) continue;
    const i = rules.findIndex(ru => ru.valueOp === t.op && ru.value === t.value);
    if (i >= 0) pre[i]++;
  }

  const claimed = new Array(pool.length).fill(false);
  const perRule = [];

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];

    if (r.countOp === 'atmost') {
      // A prohibition, not a demand: it scans every cell and claims none. Capping
      // it at `count` like the others would hide the very surplus it exists to forbid.
      let sat = pre[i];
      for (const v of pool) if (ruleMet(v, r)) sat++;
      perRule.push({ rule: r, satisfying: sat, required: r.count, satisfied: sat <= r.count });
      continue;
    }

    const cand = [];
    for (let j = 0; j < pool.length; j++)
      if (!claimed[j] && ruleMet(pool[j], r)) cand.push(j);

    // `satisfying` stays uncapped so `exactly` can see an overshoot; only the
    // *claim* is capped, which is what frees surplus cells for the tiers below.
    const satisfying = pre[i] + cand.length;
    const need = Math.max(0, r.count - pre[i]);

    if (cand.length > need)
      // Cheapest-first: a "≥2" rule takes the 2s before the 5s, so a loose rule
      // can't eat the scarce high cells a stricter rule further down still needs.
      cand.sort(r.valueOp === 'lte' ? (a, b) => pool[b] - pool[a]
                                    : (a, b) => pool[a] - pool[b]);

    for (let j = 0; j < Math.min(need, cand.length); j++) claimed[cand[j]] = true;

    perRule.push({
      rule: r, satisfying, required: r.count,
      satisfied: r.countOp === 'exactly' ? satisfying === r.count : satisfying >= r.count,
    });
  }

  const rest = [];
  for (let j = 0; j < pool.length; j++) if (!claimed[j]) rest.push(pool[j]);
  return { perRule, rest };
}

function scoreRules(bm, placements, maxRow) {
  const items = itemEvaluate(bm, placements, maxRow);
  const { perRule, rest } = ruleTally(bm, placements, maxRow, items.reserved);
  let s = 0;

  for (const pr of perRule) {
    if (pr.satisfied) { s += RULE_W; continue; }
    const r = pr.rule, req = pr.required;

    if (pr.satisfying > req) {
      // Too many qualifying slots (exactly / atmost) — grade by the surplus so the
      // climber knows to push cells back down.
      s += req > 0 ? RULE_W * 0.5 * (req / pr.satisfying) : 0;
      s -= RULE_MISS_W * Math.min(pr.satisfying - req, MISS_CAP);
    } else {
      // Short. Credit progress (always < RULE_W, so clearing the rule always wins),
      // then grade the gap by distance — same shape as pinScore's miss term.
      s += req > 0 ? RULE_W * 0.5 * (pr.satisfying / req) : 0;
      const need = req - pr.satisfying;
      if (need > 0) {
        // Only the `need` nearest misses matter; a small sorted buffer beats
        // sorting the whole leftover pool on every one of ~40k scorer calls.
        const best = [];
        for (const v of rest) {
          if (ruleMet(v, r)) continue;
          const d = ruleDist(v, r);
          if (best.length < need)          { best.push(d); best.sort((a, b) => a - b); }
          else if (d < best[need - 1])     { best[need - 1] = d; best.sort((a, b) => a - b); }
        }
        let gap = 0;
        for (let j = 0; j < need; j++) gap += j < best.length ? best[j] : MISS_CAP;
        s -= RULE_MISS_W * Math.min(gap / need, MISS_CAP);
      }
    }
  }

  return s + restScore(rest) + pinScore(bm, placements) + items.score;
}

// Leftover cells no rule claimed. Same shapes as the legacy modes, but the domain
// is only what's left over — that's what stops excess buff going where nothing asked.
function restScore(rest) {
  let total = 0;
  for (const v of rest) total += v;
  if (restMode === 'coverage')
    return rest.filter(v => v > 0).length * CELL_W + total;
  if (restMode === 'target')
    return rest.filter(v => v >= restTarget).length * CELL_W +
           rest.reduce((a, v) => a + Math.min(0, v - restTarget), 0);
  // No rules to derive a bar from — nothing to count qualifying slots against, so
  // maximize raw buff instead of borrowing a threshold the user never set.
  if (restCeil === null) return total;
  return rest.filter(v => v >= restCeil).length * CELL_W + total;
}

// Result-time only — the hot path returns a bare scalar.
function ruleBreakdown(bm, placements, maxRow) {
  const { reserved } = itemEvaluate(bm, placements, maxRow);
  return ruleTally(bm, placements, maxRow, reserved).perRule.map((pr, i) => ({
    idx:       i + 1,
    countOp:   pr.rule.countOp,
    valueOp:   pr.rule.valueOp,
    value:     pr.rule.value,
    required:  pr.required,
    matched:   pr.satisfying,
    satisfied: pr.satisfied,
  }));
}

// ── Ruleset validation ───────────────────────────────────────────

const COUNT_OP_LABEL = { exactly: 'Exactly', atleast: 'At least', atmost: 'At most' };
const VALUE_OP_LABEL = { eq: '=', gte: '≥', lte: '≤' };

function ruleLabel(r) {
  return `${COUNT_OP_LABEL[r.countOp]} ${r.count} slots at ${VALUE_OP_LABEL[r.valueOp]}${r.value}`;
}

// A lower bound on empty cells: every tablet takes exactly one cell, and any that
// fails its activation check simply goes unplaced, freeing more.
function guaranteedEmptySlots() {
  const maxRow = totalRows();
  let totalActive = 0, marked = 0;
  for (let r = 1; r <= maxRow; r++)
    for (let c = 1; c <= COLS; c++) {
      if (!isActiveCell(r, c)) continue;
      totalActive++;
      if (slotTargets[`${r},${c}`]) marked++;
    }
  let poolCount = mergedTablets.length + solverItems.length;
  for (const id of Object.keys(collection)) poolCount += collection[id];
  return totalActive - Math.min(poolCount, totalActive - marked);
}

// Cheap static checks — no grid search. Returns an error string, or null if OK.
// This only catches provably-infeasible rulesets; real feasibility depends on
// tablet shapes and rotations, which only the search can explore.
function validateRules(rs = rules) {
  for (const r of rs) {
    if (!Number.isInteger(r.count) || r.count < 0)
      return 'Slot counts must be whole numbers of 0 or more.';
    if (!Number.isInteger(r.value) || r.value < -20 || r.value > 20)
      return 'Buff values must be whole numbers between -20 and 20.';
  }

  let demand = 0;
  for (const r of rs)
    if (r.countOp === 'exactly' || r.countOp === 'atleast') demand += r.count;
  const avail = guaranteedEmptySlots();
  if (demand > avail)
    return `Rules require ${demand} empty slots but only ${avail} are guaranteed with your current collection.`;

  for (let i = 0; i < rs.length; i++)
    for (let j = i + 1; j < rs.length; j++) {
      const a = rs[i], b = rs[j];
      if (a.valueOp !== b.valueOp || a.value !== b.value) continue;
      if (rulesClash(a, b) || rulesClash(b, a))
        return `"${ruleLabel(a)}" and "${ruleLabel(b)}" contradict each other.`;
    }
  return null;
}

// ── Item validation ──────────────────────────────────────────────

const POS_CLASS_LABEL = {
  top: 'the top row', bottom: 'the bottom row', left: 'the left column',
  right: 'the right column', outermost: 'an outermost cell',
  innermost: 'an inner (non-edge) cell', rowphase: 'a matching row',
};

// Every cell an item of this config could legally occupy, ignoring exemptions.
// Exemptions only ever widen the set, so counting without them is a sound lower bound.
function legalCellsFor(cfg, maxRow) {
  const out = [];
  for (let r = 1; r <= maxRow; r++)
    for (let c = 1; c <= COLS; c++) {
      if (!isActiveCell(r, c) || slotTargets[`${r},${c}`]) continue;
      if (itemAllowedAt(cfg, c, r, maxRow, null)) out.push(`${r},${c}`);
    }
  return out;
}

// Cheap static checks, same contract as validateRules: only provably-infeasible
// setups are caught — real feasibility depends on the search. Notably a value that
// is merely *hard* to reach is no longer an error: an item at a low slot still works
// at reduced power, and the item breakdown reports how it actually did.
function validateItems(list = solverItems) {
  if (!list.length) return null;
  const maxRow = totalRows();
  const plan   = buildItemPlan(list);
  const tokens = Object.keys(plan);

  for (const token of tokens) {
    const cfg = plan[token];
    if (!Number.isInteger(cfg.want) || cfg.want < 0 || cfg.want > 20)
      return `${cfg.name}: the slot value must be a whole number between 0 and 20.`;
    for (const pin of cfg.pins)
      if (!Number.isInteger(pin.value) || pin.value < -20 || pin.value > 20)
        return `${cfg.name}: neighbour buff values must be whole numbers between -20 and 20.`;
    if (cfg.posClass === 'rowphase' && (!Number.isInteger(cfg.phase) || cfg.phase < 0 || cfg.phase > 3))
      return `${cfg.name}: pick one of the four row phases.`;
    // A zone item with nothing named has no objective to pursue.
    if (cfg.region?.kind === 'entities' && !cfg.region.entities.length)
      return `${cfg.name}: pick at least one ${cfg.region.roster === 'planets' ? 'Planet' : 'Companion'} for it to improve.`;
  }

  // Enough legal cells of each shape, and enough cells overall.
  const byShape = {};
  for (const token of tokens) {
    const cfg   = plan[token];
    const legal = legalCellsFor(cfg, maxRow);
    if (!legal.length) {
      const where = cfg.posClass ? POS_CLASS_LABEL[cfg.posClass] || 'that position' : 'the grid';
      const need  = itemNeed(cfg);
      if (need && cfg.region?.kind === 'entities')
        return `${cfg.name} has nowhere to go — it needs ${need} free slot(s) around it and no position on this grid offers that many. Pick fewer, or expand the grid.`;
      return cfg.pins.length
        ? `${cfg.name} has nowhere to go — it needs ${where} with every neighbour it buffs still on the grid. Expand the grid or free up a marked slot.`
        : `${cfg.name} has nowhere to go — it needs ${where}, and your grid has none free.`;
    }
    const shape = `${cfg.posClass || 'any'}:${cfg.phase}:${cfg.pins.map(p => `${p.dx},${p.dy}`).join(';')}`;
    (byShape[shape] ||= { cfg, legal, n: 0 }).n++;
  }
  for (const { cfg, legal, n } of Object.values(byShape))
    if (n > legal.length)
      return `${n} copies of ${cfg.name} need ${n} legal slots but only ${legal.length} exist.`;

  // Two zone items over the same scope competing for cells that can't stretch. This
  // is the provable half of Hall's condition; the rest surfaces as partial credit in
  // the item breakdown rather than as a refusal to solve.
  const byScope = {};
  for (const token of tokens) {
    const cfg = plan[token];
    const need = itemNeed(cfg);
    if (!need || !cfg.scope) continue;
    (byScope[cfg.scope] ||= { need: 0, names: [], tabletsOnly: true });
    byScope[cfg.scope].need += need;
    byScope[cfg.scope].names.push(cfg.name);
    if (cfg.region.kind === 'entities') byScope[cfg.scope].tabletsOnly = false;
  }
  for (const [scope, g] of Object.entries(byScope)) {
    if (g.tabletsOnly) continue;               // keepClear doesn't consume cells
    const cap = scope === 'neighbors8' ? 8 : COLS - 1;
    if (g.need > cap)
      return `${g.names.join(' and ')} together need ${g.need} slots in the same area, which only holds ${cap}.`;
  }

  return null;
}

function rulesClash(a, b) {
  if (a.countOp === 'exactly' && b.countOp === 'exactly') return a.count !== b.count;
  if (a.countOp === 'exactly' && b.countOp === 'atmost')  return a.count >  b.count;
  if (a.countOp === 'exactly' && b.countOp === 'atleast') return a.count <  b.count;
  if (a.countOp === 'atleast' && b.countOp === 'atmost')  return a.count >  b.count;
  return false;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function signature(placements) {
  return Object.entries(placements)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v.tabletId}@${v.rotation}`)
    .join('|');
}
