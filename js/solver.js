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
  const NUM_RUNS = 6;

  for (let run = 0; run < NUM_RUNS && results.length < 3; run++) {
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
          const sc = scoreP(tempP, maxRow, solveMode, targetVal, highVal);
          if (sc > bestScore) { bestScore = sc; bestKey = key; bestRot = rot; }
        }
      }
      if (bestKey) placements[bestKey] = { tabletId, rotation: bestRot };
    }

    localSearch(placements, maxRow, solveMode, targetVal, highVal, cellKeys, 300);

    const sig = signature(placements);
    if (!seen.has(sig)) {
      seen.add(sig);
      results.push({
        placements: JSON.parse(JSON.stringify(placements)),
        score:      scoreP(placements, maxRow, solveMode, targetVal, highVal),
        buffMap:    computeBuffMap(placements, maxRow),
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  solverResults = results.slice(0, 3);

  btn.disabled = false;
  btn.classList.remove('running');
  setLog(`Done — ${solverResults.length} solution(s) found`, 'ok');
  renderResults();
}

function localSearch(placements, maxRow, mode, tv, hv, cellKeys, iters) {
  const keys = Object.keys(placements);
  for (let i = 0; i < iters; i++) {
    const base = scoreP(placements, maxRow, mode, tv, hv);
    if (keys.length > 0) {
      const k  = keys[Math.floor(Math.random() * keys.length)];
      const td = TABLET_MAP[placements[k].tabletId];
      if (!td.disableRotate) {
        const orig = placements[k].rotation;
        placements[k].rotation = (orig + 1 + Math.floor(Math.random() * 3)) % 4;
        if (scoreP(placements, maxRow, mode, tv, hv) < base) placements[k].rotation = orig;
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
      if (scoreP(placements, maxRow, mode, tv, hv) < base) {
        const tmp2 = placements[k1];
        placements[k1] = placements[k2];
        placements[k2] = tmp2;
      }
    }

    // Relocate: move one tablet to a free cell. Swaps alone can never pull a tablet
    // into a region the greedy pass ignored (e.g. next to a pinned slot).
    if (keys.length > 0 && cellKeys && cellKeys.length) {
      const moveBase = scoreP(placements, maxRow, mode, tv, hv);
      const ki   = Math.floor(Math.random() * keys.length);
      const from = keys[ki];
      const to   = cellKeys[Math.floor(Math.random() * cellKeys.length)];
      if (!placements[to]) {
        const [tr, tc] = to.split(',').map(Number);
        if (checkActivation(TABLET_MAP[placements[from].tabletId], tc, tr, maxRow)) {
          placements[to] = placements[from];
          delete placements[from];
          if (scoreP(placements, maxRow, mode, tv, hv) < moveBase) {
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
