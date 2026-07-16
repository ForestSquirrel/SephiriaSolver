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

  const pool = [];
  for (const id of ids)
    for (let n = 0; n < collection[id]; n++) pool.push(id);
  for (const id of mergedIds) pool.push(id);

  const allCells = [];
  for (let r = 1; r <= maxRow; r++)
    for (let c = 1; c <= COLS; c++)
      if (isActiveCell(r, c)) allCells.push({ row: r, col: c });

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
          const sc = scoreP(tempP, maxRow, solveMode, targetVal);
          if (sc > bestScore) { bestScore = sc; bestKey = key; bestRot = rot; }
        }
      }
      if (bestKey) placements[bestKey] = { tabletId, rotation: bestRot };
    }

    localSearch(placements, maxRow, solveMode, targetVal, 300);

    const sig = signature(placements);
    if (!seen.has(sig)) {
      seen.add(sig);
      results.push({
        placements: JSON.parse(JSON.stringify(placements)),
        score:      scoreP(placements, maxRow, solveMode, targetVal),
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

function localSearch(placements, maxRow, mode, tv, iters) {
  const keys = Object.keys(placements);
  for (let i = 0; i < iters; i++) {
    const base = scoreP(placements, maxRow, mode, tv);
    if (keys.length > 0) {
      const k  = keys[Math.floor(Math.random() * keys.length)];
      const td = TABLET_MAP[placements[k].tabletId];
      if (!td.disableRotate) {
        const orig = placements[k].rotation;
        placements[k].rotation = (orig + 1 + Math.floor(Math.random() * 3)) % 4;
        if (scoreP(placements, maxRow, mode, tv) < base) placements[k].rotation = orig;
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
      if (scoreP(placements, maxRow, mode, tv) < base) {
        const tmp2 = placements[k1];
        placements[k1] = placements[k2];
        placements[k2] = tmp2;
      }
    }
  }
}

function scoreP(placements, maxRow, mode, tv) {
  const bm   = computeBuffMap(placements, maxRow);
  const vals = [];
  for (let r = 1; r <= maxRow; r++)
    for (let c = 1; c <= COLS; c++)
      if (isActiveCell(r, c) && !placements[`${r},${c}`])
        vals.push(bm[`${r},${c}`] || 0);

  if (mode === 'total') return vals.reduce((a, b) => a + b, 0);
  if (mode === 'min')   return vals.reduce((a, b) => a + b, 0) * 0.3 + (vals.length ? Math.min(...vals) : 0) * 10;
  if (mode === 'target') {
    let s = 0;
    for (const v of vals) s += v >= tv ? 3 : v - tv;
    return s;
  }
  return 0;
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
