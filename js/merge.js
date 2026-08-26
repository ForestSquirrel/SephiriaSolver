// Merge dialog — state and DOM management.
// Depends on: state.js, engine.js, ui.js

let mergeSelA = null;
let mergeSelB = null;
let mergeRotA = 0;
let mergeRotB = 0;

// ── Open / Close ─────────────────────────────────────────────────

function openMergeDialog() {
  if (document.getElementById('merge-overlay')) return;
  mergeSelA = null;
  mergeSelB = null;
  mergeRotA = 0;
  mergeRotB = 0;

  const overlay = document.createElement('div');
  overlay.id = 'merge-overlay';
  overlay.className = 'merge-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeMergeDialog(); });

  const dialog = document.createElement('div');
  dialog.className = 'merge-dialog';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'merge-hdr';
  const title = document.createElement('span');
  title.className = 'merge-hdr-title';
  title.textContent = '◆ Merge Tablets';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'merge-close-btn';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeMergeDialog);
  hdr.append(title, closeBtn);
  dialog.appendChild(hdr);

  // Body
  const body = document.createElement('div');
  body.className = 'merge-body';
  body.appendChild(buildMergeSlot('A'));
  body.appendChild(buildMergeCenterPanel());
  body.appendChild(buildMergeSlot('B'));
  dialog.appendChild(body);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'merge-footer';
  const warn = document.createElement('div');
  warn.id = 'merge-warning';
  warn.className = 'merge-warning';
  footer.appendChild(warn);
  const confirmBtn = document.createElement('button');
  confirmBtn.id = 'merge-confirm-btn';
  confirmBtn.className = 'merge-confirm-btn';
  confirmBtn.textContent = '⊕ Create Merged Tablet';
  confirmBtn.disabled = true;
  confirmBtn.addEventListener('click', doMerge);
  footer.appendChild(confirmBtn);
  dialog.appendChild(footer);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  renderMergePickerGrid('A');
  renderMergePickerGrid('B');
  renderMergeSelArea('A');
  renderMergeSelArea('B');
  renderMergePreview();
}

function closeMergeDialog() {
  const overlay = document.getElementById('merge-overlay');
  if (overlay) overlay.remove();
}

// ── Dialog Structure Builders ─────────────────────────────────────

function buildMergeSlot(slot) {
  const div = document.createElement('div');
  div.className = 'merge-slot';

  const hdr = document.createElement('div');
  hdr.className = 'merge-slot-hdr';
  hdr.textContent = `Tablet ${slot}`;
  div.appendChild(hdr);

  const pickerWrap = document.createElement('div');
  pickerWrap.id = `merge-picker-${slot}`;
  pickerWrap.className = 'merge-picker-wrap';
  div.appendChild(pickerWrap);

  const selArea = document.createElement('div');
  selArea.id = `merge-sel-${slot}`;
  selArea.className = 'merge-sel-area';
  div.appendChild(selArea);

  return div;
}

function buildMergeCenterPanel() {
  const center = document.createElement('div');
  center.className = 'merge-center';

  const label = document.createElement('div');
  label.className = 'merge-preview-label';
  label.textContent = 'AOE Preview';
  center.appendChild(label);

  const grid = document.createElement('div');
  grid.id = 'merge-preview-grid';
  grid.className = 'merge-preview-grid';
  center.appendChild(grid);

  const legend = document.createElement('div');
  legend.className = 'merge-legend';
  legend.innerHTML =
    '<span class="ml-a">■ A</span>' +
    '<span class="ml-b">■ B</span>' +
    '<span class="ml-ab">■ Both</span>';
  center.appendChild(legend);

  return center;
}

// ── Picker Grid ───────────────────────────────────────────────────

function renderMergePickerGrid(slot) {
  const wrap = document.getElementById(`merge-picker-${slot}`);
  if (!wrap) return;
  wrap.innerHTML = '';

  const selId = slot === 'A' ? mergeSelA : mergeSelB;
  const items = [...TABLETS_DATA.items].sort((a, b) => a.id - b.id);

  const grid = document.createElement('div');
  grid.className = 'merge-picker-grid';

  for (const t of items) {
    const cell = document.createElement('div');
    cell.className = 'merge-picker-cell' + (selId === t.id ? ' selected' : '');

    const img = document.createElement('img');
    img.src = `sprites/${t.id}.png`;
    img.alt = '';
    img.onerror = function () {
      this.style.display = 'none';
      const fb = document.createElement('span');
      fb.style.cssText = 'font-size:6px;color:var(--text-dim);text-align:center;line-height:1.2;padding:2px;';
      fb.textContent = t.name.substring(0, 8);
      cell.appendChild(fb);
    };
    cell.appendChild(img);

    cell.addEventListener('click', () => {
      if (slot === 'A') { mergeSelA = t.id; mergeRotA = 0; }
      else              { mergeSelB = t.id; mergeRotB = 0; }
      renderMergePickerGrid(slot);
      renderMergeSelArea(slot);
      renderMergePreview();
      updateMergeConfirmBtn();
    });
    cell.addEventListener('mouseenter', e => showTooltip(e, t));
    cell.addEventListener('mouseleave', hideTooltip);
    grid.appendChild(cell);
  }
  wrap.appendChild(grid);
}

// ── Selection Area (sprite + rotation controls) ───────────────────

function renderMergeSelArea(slot) {
  const el = document.getElementById(`merge-sel-${slot}`);
  if (!el) return;
  el.innerHTML = '';

  const selId = slot === 'A' ? mergeSelA : mergeSelB;
  const rot   = slot === 'A' ? mergeRotA : mergeRotB;

  if (!selId) {
    const ph = document.createElement('div');
    ph.className = 'merge-sel-placeholder';
    ph.textContent = 'Select a tablet above';
    el.appendChild(ph);
    return;
  }

  const td = TABLET_MAP[selId];

  // Sprite + name row
  const row = document.createElement('div');
  row.className = 'merge-sel-row';

  const spr = makeSpriteEl(selId, 'clamp(28px,2.3vw,42px)');
  spr.style.border       = '1px solid var(--border)';
  spr.style.borderRadius = '2px';
  spr.style.background   = 'var(--bg3)';
  spr.style.flexShrink   = '0';
  row.appendChild(spr);

  const nm = document.createElement('div');
  nm.className = 'merge-sel-name';
  nm.textContent = td.name;
  row.appendChild(nm);
  el.appendChild(row);

  // Rotation controls
  const rotRow = document.createElement('div');
  rotRow.className = 'merge-rot-row';

  if (td.disableRotate) {
    const fixed = document.createElement('span');
    fixed.className = 'merge-rot-fixed';
    fixed.textContent = 'Fixed — cannot rotate';
    rotRow.appendChild(fixed);
  } else {
    const btnPrev = document.createElement('button');
    btnPrev.className = 'merge-rot-btn';
    btnPrev.textContent = '◄';
    btnPrev.addEventListener('click', () => {
      if (slot === 'A') mergeRotA = ((mergeRotA - 1) + 4) % 4;
      else              mergeRotB = ((mergeRotB - 1) + 4) % 4;
      renderMergeSelArea(slot);
      renderMergePreview();
    });

    const lbl = document.createElement('span');
    lbl.className = 'merge-rot-label';
    lbl.textContent = ['↑ 0°', '→ 90°', '↓ 180°', '← 270°'][rot];

    const btnNext = document.createElement('button');
    btnNext.className = 'merge-rot-btn';
    btnNext.textContent = '►';
    btnNext.addEventListener('click', () => {
      if (slot === 'A') mergeRotA = (mergeRotA + 1) % 4;
      else              mergeRotB = (mergeRotB + 1) % 4;
      renderMergeSelArea(slot);
      renderMergePreview();
    });

    rotRow.append(btnPrev, lbl, btnNext);
  }
  el.appendChild(rotRow);
}

// ── Preview Contribution Helper ───────────────────────────────────
// Self-contained alternative to getTabletContributions that uses the
// preview grid size instead of global COLS / bottomRowForCol, so
// row/diagonal effects span the full preview and bottom ref maps to
// the preview's actual bottom row rather than the game grid's.

function previewContributions(td, cx, cy, rot, size) {
  const r = ((rot % 4) + 4) % 4;
  const out = [];

  if (td.effects) {
    for (const [ex, ey, buff] of td.effects) {
      const [rx, ry] = rotateXY(ex, ey, r);
      out.push({ col: cx + rx, row: cy - ry, buff });
    }
  }

  if (td.parityBuff) {
    for (let row = 1; row <= size; row++)
      for (let col = 1; col <= size; col++) {
        const odd  = ((col - cx) + (row - cy)) & 1;
        const buff = odd ? td.parityBuff.odd : td.parityBuff.even;
        if (buff) out.push({ col, row, buff });
      }
  }

  if (td.lineBuff) {
    for (const lb of td.lineBuff) {
      let axis = lb.axis;
      const ref  = lb.ref;
      const buff = lb.buff;
      // Pre-apply 90°/270° axis swap for self-ref (mirrors engine logic)
      if (ref === 'self' && r % 2 === 1)
        axis = axis === 'row' ? 'column' : axis === 'column' ? 'row' : axis;

      if (axis === 'row') {
        const tr = ref === 'bottom' ? size : ref === 'self' ? cy : 1;
        for (let c = 1; c <= size; c++) out.push({ col: c, row: tr, buff });
      } else if (axis === 'column') {
        const tc = ref === 'right' ? size : ref === 'self' ? cx : 1;
        for (let row = 1; row <= size; row++) out.push({ col: tc, row, buff });
      } else if (axis === 'diagonal') {
        const diag0 = ((r % 2 === 0) !== !!lb.diagFlip);
        for (let row = 1; row <= size; row++)
          for (let col = 1; col <= size; col++)
            if (diag0 ? col + row === cx + cy : col - row === cx - cy)
              out.push({ col, row, buff });
      }
    }
  }
  return out;
}

// ── AOE Preview Grid ──────────────────────────────────────────────

function renderMergePreview() {
  const el = document.getElementById('merge-preview-grid');
  if (!el) return;
  el.innerHTML = '';

  const SIZE = 9;   // preview grid dimensions
  const CX   = 5;   // center column
  const CY   = 5;   // center row

  const mapA = {}, mapB = {};

  if (mergeSelA) {
    for (const { col, row, buff } of previewContributions(TABLET_MAP[mergeSelA], CX, CY, mergeRotA, SIZE)) {
      if (col >= 1 && col <= SIZE && row >= 1 && row <= SIZE) {
        const k = `${row},${col}`;
        mapA[k] = (mapA[k] || 0) + buff;
      }
    }
  }
  if (mergeSelB) {
    for (const { col, row, buff } of previewContributions(TABLET_MAP[mergeSelB], CX, CY, mergeRotB, SIZE)) {
      if (col >= 1 && col <= SIZE && row >= 1 && row <= SIZE) {
        const k = `${row},${col}`;
        mapB[k] = (mapB[k] || 0) + buff;
      }
    }
  }

  for (let r = 1; r <= SIZE; r++) {
    for (let c = 1; c <= SIZE; c++) {
      const cell = document.createElement('div');
      cell.className = 'mpc';
      const k        = `${r},${c}`;
      const inA      = k in mapA;
      const inB      = k in mapB;
      const isCenter = r === CY && c === CX;

      if (isCenter) {
        cell.classList.add('mpc-center');
      } else if (inA && inB) {
        const total = (mapA[k] || 0) + (mapB[k] || 0);
        cell.classList.add('mpc-both');
        cell.textContent = (total > 0 ? '+' : '') + total;
      } else if (inA) {
        cell.classList.add(mapA[k] >= 0 ? 'mpc-a' : 'mpc-a-neg');
        cell.textContent = (mapA[k] > 0 ? '+' : '') + mapA[k];
      } else if (inB) {
        cell.classList.add(mapB[k] >= 0 ? 'mpc-b' : 'mpc-b-neg');
        cell.textContent = (mapB[k] > 0 ? '+' : '') + mapB[k];
      }

      el.appendChild(cell);
    }
  }
}

// ── Confirm Button & Merge Action ─────────────────────────────────

function updateMergeConfirmBtn() {
  const btn  = document.getElementById('merge-confirm-btn');
  const warn = document.getElementById('merge-warning');
  const both = !!(mergeSelA && mergeSelB);

  const tdA = both ? TABLET_MAP[mergeSelA] : null;
  const tdB = both ? TABLET_MAP[mergeSelB] : null;
  const conflict = both && !mergeActivationPositions(tdA, tdB).ok;

  if (warn) {
    warn.textContent = conflict
      ? '⚠ Illegal merge. If it is a bug, please report to the author in steam guide comments.'
      : '';
  }
  if (btn) btn.disabled = !both || conflict;
}

function doMerge() {
  if (!mergeSelA || !mergeSelB) return;
  const merged = createMergedTablet(
    TABLET_MAP[mergeSelA], mergeRotA,
    TABLET_MAP[mergeSelB], mergeRotB
  );
  if (!merged) { updateMergeConfirmBtn(); return; }
  mergedTablets.push(merged);
  TABLET_MAP[merged.id] = merged;
  invalidateSolverResults();
  renderCollection();
  closeMergeDialog();
}
