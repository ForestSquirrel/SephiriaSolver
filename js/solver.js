// Solver algorithm — no DOM access except setLog / setMode (UI helpers in ui.js).
// Depends on: state.js, engine.js

async function runSolver() {
  if (solverRunning) return;
  const ids       = Object.keys(collection).map(Number).filter(id => collection[id] > 0);
  const mergedIds = mergedTablets.map(mt => mt.id);
  if (!ids.length && !mergedIds.length) { setLog('Add tablets to collection first', 'err'); return; }

  const usingRules = solverEngine === 'ruleset';
  const runMode    = solveMode;
  const targetVal  = document.getElementById('target-val').valueAsNumber;
  const highVal    = document.getElementById('highval-val').valueAsNumber;
  if (!usingRules && runMode === 'target' && !validBuffInput(targetVal)) {
    setLog('Target value must be a whole number between -20 and 20', 'err');
    return;
  }
  if (!usingRules && runMode === 'maximize' && !validBuffInput(highVal)) {
    setLog('High-value threshold must be a whole number between -20 and 20', 'err');
    return;
  }

  const runVersion = solverConfigVersion;

  const btn = document.getElementById('solve-btn');
  btn.disabled = true;
  btn.classList.add('running');
  solverRunning = true;
  setLog('Solving…');
  solverResults    = [];
  appliedResultIdx = -1;
  renderResults();
  await new Promise(r => setTimeout(r, 10)); // let UI repaint

  const maxRow = totalRows();

  if (usingRules) {
    const bad = validateRules();
    if (bad) {
      setLog(bad, 'err');
      btn.disabled = false;
      btn.classList.remove('running');
      solverRunning = false;
      return;
    }
    // Hoisted out of the scorer — it's a pure function of `rules`, and the scorer
    // runs tens of thousands of times per solve. Null when there's no rule to
    // derive a bar from, which means "just push the buff as high as it goes".
    restCeil = derivedRestCeiling();
  }
  const scoreOf = usingRules
    ? p => scoreRules(computeBuffMap(p, maxRow), p, maxRow)
    : p => scoreP(p, maxRow, runMode, targetVal, highVal);

  const pool = [];
  for (const id of ids)
    for (let n = 0; n < collection[id]; n++) pool.push(id);
  for (const id of mergedIds) pool.push(id);

  const allCells = [];
  for (let r = 1; r <= maxRow; r++)
    for (let c = 1; c <= COLS; c++)
      // Cells the user pinned to a value must stay empty to receive that value
      if (isActiveCell(r, c) && !slotTargets[`${r},${c}`]) allCells.push({ row: r, col: c });
  const cellKeys = allCells.map(({ row, col }) => `${row},${col}`);

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

    for (const tabletId of remaining) {
      const td = TABLET_MAP[tabletId];
      const rotations = td.disableRotate ? [0] : (td.effectiveRotations ?? [0, 1, 2, 3]);
      let bestScore = -Infinity, bestKey = null, bestRot = 0;

      for (const { row, col } of shuffle([...allCells])) {
        const key = `${row},${col}`;
        if (placements[key]) continue;
        if (!checkActivation(td, col, row, maxRow)) continue;
        for (const rot of rotations) {
          const tempP = { ...placements, [key]: { tabletId, rotation: rot } };
          const sc = scoreOf(tempP);
          if (sc > bestScore) { bestScore = sc; bestKey = key; bestRot = rot; }
        }
      }
      if (bestKey) placements[bestKey] = { tabletId, rotation: bestRot };
    }

    localSearch(placements, maxRow, scoreOf, cellKeys, 300);

    const sig = signature(placements);
    if (!seen.has(sig)) {
      seen.add(sig);
      const bm = computeBuffMap(placements, maxRow);
      const breakdown = usingRules ? ruleBreakdown(bm, placements, maxRow) : null;
      results.push({
        placements: JSON.parse(JSON.stringify(placements)),
        score:      scoreOf(placements),
        buffMap:    bm,
        ruleBreakdown:  breakdown,
        rulesSatisfied: breakdown ? breakdown.every(b => b.satisfied) : true,
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

  btn.disabled = false;
  btn.classList.remove('running');
  solverRunning = false;

  // Configuration mutations cancel the search. Do not publish even the final
  // in-flight attempt: it may have observed a partially changed configuration.
  if (runVersion !== solverConfigVersion) {
    solverResults    = [];
    appliedResultIdx = -1;
    setLog('Search cancelled because solver settings changed', 'err');
    renderResults();
    return;
  }

  // A layout that clears the ruleset outranks one that doesn't, whatever the tiers
  // worked out to — the weights make that almost always true anyway, but "almost"
  // isn't good enough for what gets shown as Option 1.
  results.sort((a, b) => (b.rulesSatisfied - a.rulesSatisfied) || (b.score - a.score));
  // Everything is kept — renderResults shows the top three, the table browses the rest.
  solverResults = results;

  const n     = solverResults.length;
  const secs  = ((Date.now() - startedAt) / 1000).toFixed(1);
  const short = usingRules && n && !solverResults[0].rulesSatisfied;
  setLog(solverCancelled
    ? `Cancelled — ${n} solution(s) kept`
    : short
    ? `Done in ${secs}s — ${n} solution(s), but no placement met every rule`
    : `Done in ${secs}s — ${n} solution(s) found`,
    short ? 'err' : 'ok');
  renderResults();
}

function validBuffInput(value) {
  return Number.isInteger(value) && value >= -20 && value <= 20;
}

// One macrotask between runs so the browser can repaint the progress bar. Nested
// timers get clamped to ~4ms, which is under 1% of a 50-400ms run.
function yieldToUI() {
  return new Promise(r => setTimeout(r, 0));
}

function localSearch(placements, maxRow, scoreOf, cellKeys, iters) {
  const keys = Object.keys(placements);
  for (let i = 0; i < iters; i++) {
    const base = scoreOf(placements);
    if (keys.length > 0) {
      const k  = keys[Math.floor(Math.random() * keys.length)];
      const td = TABLET_MAP[placements[k].tabletId];
      const rotations = td.disableRotate ? [0] : (td.effectiveRotations ?? [0, 1, 2, 3]);
      if (rotations.length > 1) {
        const orig = placements[k].rotation;
        const alternatives = rotations.filter(rot => rot !== orig);
        placements[k].rotation = alternatives[Math.floor(Math.random() * alternatives.length)];
        if (scoreOf(placements) < base) placements[k].rotation = orig;
      }
    }
    if (keys.length >= 2) {
      const i1 = Math.floor(Math.random() * keys.length);
      let   i2 = Math.floor(Math.random() * keys.length);
      if (i2 === i1) continue;
      const [k1, k2] = [keys[i1], keys[i2]];
      const [r1, c1] = k1.split(',').map(Number);
      const [r2, c2] = k2.split(',').map(Number);
      if (!checkActivation(TABLET_MAP[placements[k2].tabletId], c1, r1, maxRow)) continue;
      if (!checkActivation(TABLET_MAP[placements[k1].tabletId], c2, r2, maxRow)) continue;
      const tmp = placements[k1];
      placements[k1] = placements[k2];
      placements[k2] = tmp;
      if (scoreOf(placements) < base) {
        const tmp2 = placements[k1];
        placements[k1] = placements[k2];
        placements[k2] = tmp2;
      }
    }

    // Relocate: move one tablet to a free cell. Swaps alone can never pull a tablet
    // into a region the greedy pass ignored (e.g. next to a pinned slot).
    if (keys.length > 0 && cellKeys && cellKeys.length) {
      const moveBase = scoreOf(placements);
      const ki   = Math.floor(Math.random() * keys.length);
      const from = keys[ki];
      const to   = cellKeys[Math.floor(Math.random() * cellKeys.length)];
      if (!placements[to]) {
        const [tr, tc] = to.split(',').map(Number);
        if (checkActivation(TABLET_MAP[placements[from].tabletId], tc, tr, maxRow)) {
          placements[to] = placements[from];
          delete placements[from];
          if (scoreOf(placements) < moveBase) {
            placements[from] = placements[to];
            delete placements[to];
          } else {
            keys[ki] = to;
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
const PIN_W      = 1e7;   // one satisfied pin     (vs. every other term combined)

function scoreP(placements, maxRow, mode, tv, hv) {
  const bm    = computeBuffMap(placements, maxRow);
  const vals  = activeEmptyCells(placements, maxRow).map(({ key }) => bm[key] || 0);
  const total = vals.reduce((a, b) => a + b, 0);

  let s = 0;
  // Total buff stays the tie-break inside coverage/maximize.
  if (mode === 'coverage')      s = vals.filter(v => v >  0).length  * CELL_W + total;
  else if (mode === 'maximize') s = vals.filter(v => v >= hv).length * CELL_W + total;
  else if (mode === 'target')   s = vals.reduce((a, v) => a + (v >= tv ? 3 : v - tv), 0);

  return s + pinScore(bm, placements);
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
function ruleTally(bm, placements, maxRow) {
  const pool = [];
  const marked = [];
  for (const { key } of activeEmptyCells(placements, maxRow)) {
    const value = bm[key] || 0;
    if (slotTargets[key]) marked.push(value);
    else                  pool.push(value);
  }

  const claimed = new Array(pool.length).fill(false);
  const markedClaimed = new Array(marked.length).fill(false);
  const perRule = [];

  for (let i = 0; i < rules.length; i++) {
    const r = rules[i];

    if (r.countOp === 'atmost') {
      // A prohibition, not a demand: it scans every cell and claims none. Capping
      // it at `count` like the others would hide the very surplus it exists to forbid.
      let sat = 0;
      for (const v of pool) if (ruleMet(v, r)) sat++;
      for (const v of marked) if (ruleMet(v, r)) sat++;
      perRule.push({ rule: r, satisfying: sat, required: r.count, satisfied: sat <= r.count });
      continue;
    }

    const cand = [];
    for (let j = 0; j < pool.length; j++)
      if (!claimed[j] && ruleMet(pool[j], r)) cand.push({ source: 'pool', idx: j, value: pool[j] });
    for (let j = 0; j < marked.length; j++)
      if (!markedClaimed[j] && ruleMet(marked[j], r)) cand.push({ source: 'marked', idx: j, value: marked[j] });

    // `satisfying` stays uncapped so `exactly` can see an overshoot; only the
    // *claim* is capped, which is what frees surplus cells for the tiers below.
    const satisfying = cand.length;
    const need = r.count;

    if (cand.length > need)
      // Cheapest-first: a "≥2" rule takes the 2s before the 5s, so a loose rule
      // can't eat the scarce high cells a stricter rule further down still needs.
      cand.sort(r.valueOp === 'lte' ? (a, b) => b.value - a.value
                                    : (a, b) => a.value - b.value);

    for (let j = 0; j < Math.min(need, cand.length); j++) {
      const c = cand[j];
      if (c.source === 'pool') claimed[c.idx] = true;
      else markedClaimed[c.idx] = true;
    }

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
  const { perRule, rest } = ruleTally(bm, placements, maxRow);
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

  return s + restScore(rest) + pinScore(bm, placements);
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
  return ruleTally(bm, placements, maxRow).perRule.map((pr, i) => ({
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
  let poolCount = mergedTablets.length;
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
      if (rulesClash(a, b) || rulesClash(b, a))
        return `"${ruleLabel(a)}" and "${ruleLabel(b)}" contradict each other.`;
    }
  return null;
}

function rulesClash(a, b) {
  const sameCondition = a.valueOp === b.valueOp && a.value === b.value;
  if (sameCondition) {
    if (a.countOp === 'exactly' && b.countOp === 'exactly') return a.count !== b.count;
    if (a.countOp === 'exactly' && b.countOp === 'atmost')  return a.count >  b.count;
    if (a.countOp === 'exactly' && b.countOp === 'atleast') return a.count <  b.count;
    if (a.countOp === 'atleast' && b.countOp === 'atmost')  return a.count >  b.count;
  }

  // `atmost` is a global prohibition, so a demand on any stricter subset cannot
  // require more qualifying cells than that broader cap permits.
  return a.countOp === 'atmost' && b.countOp !== 'atmost' &&
         ruleConditionSubset(b, a) && b.count > a.count;
}

// Whether every value matched by `a` must also be matched by `b`.
function ruleConditionSubset(a, b) {
  if (a.valueOp === 'eq') {
    if (b.valueOp === 'eq')  return a.value === b.value;
    if (b.valueOp === 'gte') return a.value >= b.value;
    return a.value <= b.value;
  }
  if (a.valueOp === 'gte' && b.valueOp === 'gte') return a.value >= b.value;
  if (a.valueOp === 'lte' && b.valueOp === 'lte') return a.value <= b.value;
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
