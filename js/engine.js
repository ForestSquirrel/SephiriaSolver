// Pure game logic — no DOM access.
// Depends on: state.js (BASE_ROWS, COLS, MAX_ROWS, MAX_EXPAND, expandedSlots, TABLET_MAP)

// ── Grid Geometry ────────────────────────────────────────────────

// Switch the base grid height, re-deriving the expansion budget so the row ceiling stays put.
function setBaseRows(n) {
  BASE_ROWS  = n;
  MAX_EXPAND = (MAX_ROWS - n) * COLS;
}

function totalRows() {
  if (expandedSlots === 0) return BASE_ROWS;
  return BASE_ROWS + Math.ceil(expandedSlots / COLS);
}

function isActiveCell(row, col) {
  if (row < 1 || row > BASE_ROWS + Math.ceil(MAX_EXPAND / COLS)) return false;
  if (col < 1 || col > COLS) return false;
  if (row <= BASE_ROWS) return true;
  const extraRow   = row - BASE_ROWS;
  const fullExtra  = Math.floor(expandedSlots / COLS);
  if (extraRow <= fullExtra) return true;
  if (extraRow === fullExtra + 1) return col <= (expandedSlots % COLS);
  return false;
}

// Bottom-most active row for a given column.
// Columns 1..partialCols reach into the partial extra row; others stop at the last full extra row.
// e.g. expandedSlots=2, col=1 → BASE_ROWS+1=6; col=3 → BASE_ROWS=5
function bottomRowForCol(col) {
  const fullExtra   = Math.floor(expandedSlots / COLS);
  const partialCols = expandedSlots % COLS;
  if (col <= partialCols) return BASE_ROWS + fullExtra + 1;
  return BASE_ROWS + fullExtra;
}

function isExpandSlot(row, col) {
  if (expandedSlots >= MAX_EXPAND) return false;
  const nextSlotIdx = expandedSlots;
  const nextRow = BASE_ROWS + Math.floor(nextSlotIdx / COLS) + 1;
  const nextCol = (nextSlotIdx % COLS) + 1;
  return row === nextRow && col === nextCol;
}

// ── Rotation Engine ──────────────────────────────────────────────

function rotateXY(x, y, steps) {
  for (let i = 0; i < steps; i++) [x, y] = [y, -x]; // 90° CW each step
  return [x, y];
}

function getTabletContributions(td, col, row, rotation, maxRow) {
  const rot = ((rotation % 4) + 4) % 4;
  const out = [];

  if (td.effects) {
    for (const [ex, ey, buff] of td.effects) {
      const [rx, ry] = rotateXY(ex, ey, rot);
      out.push({ col: col + rx, row: row - ry, buff });
    }
  }

  // Chessboard over the whole grid — cells at odd Manhattan parity from the
  // tablet get one value, even parity the other. Position matters only through
  // the parity of the tablet's own cell; rotation is irrelevant.
  if (td.parityBuff) {
    for (let r = 1; r <= maxRow; r++)
      for (let c = 1; c <= COLS; c++) {
        const odd  = ((c - col) + (r - row)) & 1;
        const buff = odd ? td.parityBuff.odd : td.parityBuff.even;
        if (buff) out.push({ col: c, row: r, buff });
      }
  }

  if (td.lineBuff) {
    for (const lb of td.lineBuff) {
      let axis = lb.axis, ref = lb.ref;
      const buff = lb.buff;
      // rotate self-ref lineBuff axes at 90°/270°
      if (ref === 'self' && rot % 2 === 1) {
        if (axis === 'row')    axis = 'column';
        else if (axis === 'column') axis = 'row';
      }
      if (axis === 'row') {
        if (ref === 'bottom') {
          // "bottom row" is per-column when grid has a partial expansion row
          for (let c = 1; c <= COLS; c++) out.push({ col: c, row: bottomRowForCol(c), buff });
        } else {
          const tr = ref === 'self' ? row : 1; // 'top' → row 1
          for (let c = 1; c <= COLS; c++) out.push({ col: c, row: tr, buff });
        }
      } else if (axis === 'column') {
        const tc = ref === 'self' ? col : ref === 'left' ? 1 : COLS;
        for (let r = 1; r <= maxRow; r++) out.push({ col: tc, row: r, buff });
      } else if (axis === 'diagonal') {
        const diag0 = (rot === 0 || rot === 2);
        for (let r = 1; r <= maxRow; r++)
          for (let c = 1; c <= COLS; c++)
            if (diag0 ? c + r === col + row : c - r === col - row)
              out.push({ col: c, row: r, buff });
      }
    }
  }
  return out;
}

// ── Buff Map ─────────────────────────────────────────────────────

function computeBuffMap(placements, maxRow) {
  const map = {};
  for (const [key, { tabletId, rotation }] of Object.entries(placements)) {
    const [r, c] = key.split(',').map(Number);
    const td = TABLET_MAP[tabletId];
    if (!td) continue;
    // Manually placed tablets may sit outside their required edge. Keep the
    // placement visible, but inactive tablets must not contribute any buffs.
    if (!checkActivation(td, c, r, maxRow)) continue;
    for (const { col, row, buff } of getTabletContributions(td, c, r, rotation, maxRow)) {
      if (row < 1 || row > maxRow || col < 1 || col > COLS) continue;
      if (!isActiveCell(row, col)) continue;
      const k = `${row},${col}`;
      map[k] = (map[k] || 0) + buff;
    }
  }

  // ×2 slots double the cell's NET value (negatives included)
  for (const k of Object.keys(x2Slots)) {
    const [r, c] = k.split(',').map(Number);
    if (r > maxRow || !isActiveCell(r, c)) continue;
    if (map[k]) map[k] *= 2;
  }

  return map;
}

// Every active cell not occupied by a tablet — the set every score/stat is computed over.
function activeEmptyCells(placements, maxRow) {
  const out = [];
  for (let r = 1; r <= maxRow; r++)
    for (let c = 1; c <= COLS; c++) {
      const key = `${r},${c}`;
      if (isActiveCell(r, c) && !placements[key]) out.push({ row: r, col: c, key });
    }
  return out;
}

// Drop marks on cells that are no longer part of the grid (e.g. after clearGrid resets expansion).
function pruneMarks() {
  for (const map of [x2Slots, slotTargets])
    for (const k of Object.keys(map)) {
      const [r, c] = k.split(',').map(Number);
      if (!isActiveCell(r, c)) delete map[k];
    }
}

// ── Activation Check ─────────────────────────────────────────────

// ── Merge Engine ─────────────────────────────────────────────────

// Combines two activationPosition sets. A missing field means "no restriction",
// so the other side's set is inherited as-is. When both restrict and one set is
// included in the other, the narrower one wins; otherwise the sets conflict and
// the merge is refused — in-game behavior there is unconfirmed.
// Returns { ok: true, value: string[]|null } or { ok: false }.
function mergeActivationPositions(tdA, tdB) {
  const a = tdA.activationPosition || [];
  const b = tdB.activationPosition || [];
  if (!a.length) return { ok: true, value: b.length ? [...b] : null };
  if (!b.length) return { ok: true, value: [...a] };

  const setA = new Set(a);
  const setB = new Set(b);
  if (a.every(p => setB.has(p))) return { ok: true, value: [...a] };
  if (b.every(p => setA.has(p))) return { ok: true, value: [...b] };
  return { ok: false };
}

function createMergedTablet(tdA, rotA, tdB, rotB) {
  const activation = mergeActivationPositions(tdA, tdB);
  if (!activation.ok) return null;

  // Bake each source's effects at its chosen rotation into a shared map
  const combined = {};
  function bakeEffects(td, rot) {
    if (!td.effects) return;
    for (const [ex, ey, buff] of td.effects) {
      const [rx, ry] = rotateXY(ex, ey, rot);
      const k = `${rx},${ry}`;
      combined[k] = (combined[k] || 0) + buff;
    }
  }
  bakeEffects(tdA, rotA);
  bakeEffects(tdB, rotB);
  const effects = Object.entries(combined)
    .map(([k, buff]) => { const [dx, dy] = k.split(',').map(Number); return [dx, dy, buff]; });

  // Carry lineBuffs with the self-ref axis pre-rotated
  const lineBuff = [];
  function bakeLineBuff(td, rot) {
    if (!td.lineBuff) return;
    for (const lb of td.lineBuff) {
      let axis = lb.axis;
      if (lb.ref === 'self' && rot % 2 === 1)
        axis = axis === 'row' ? 'column' : axis === 'column' ? 'row' : axis;
      lineBuff.push({ axis, ref: lb.ref, buff: lb.buff });
    }
  }
  bakeLineBuff(tdA, rotA);
  bakeLineBuff(tdB, rotB);

  // parityBuff is rotation-invariant — just sum the two sources componentwise
  const parityBuff = {
    odd:  (tdA.parityBuff?.odd  ?? 0) + (tdB.parityBuff?.odd  ?? 0),
    even: (tdA.parityBuff?.even ?? 0) + (tdB.parityBuff?.even ?? 0),
  };

  const id = `merged_${mergedTablets.length + 1}_${Date.now()}`;
  return {
    id,
    name: `${tdA.name} + ${tdB.name}`,
    spriteA: tdA.id,
    spriteB: tdB.id,
    disableRotate: !!(tdA.disableRotate || tdB.disableRotate),
    ...(effects.length  ? { effects }  : {}),
    ...(lineBuff.length ? { lineBuff } : {}),
    ...(parityBuff.odd || parityBuff.even ? { parityBuff } : {}),
    ...(activation.value ? { activationPosition: activation.value } : {}),
  };
}

function checkActivation(td, col, row, maxRow) {
  if (!td.activationPosition) return true;
  for (const pos of td.activationPosition) {
    if (pos === 'top'    && row === 1)                    return true;
    if (pos === 'bottom' && row === bottomRowForCol(col)) return true;
    if (pos === 'left'   && col === 1)                    return true;
    if (pos === 'right'  && col === COLS)                 return true;
  }
  return false;
}
