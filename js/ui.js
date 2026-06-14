// All DOM rendering and user interaction.
// Depends on: state.js, engine.js, solver.js

// ── Sprite Helper ────────────────────────────────────────────────

function makeSpriteEl(id, size) {
  const wrap = document.createElement('div');
  wrap.style.cssText = `width:${size};height:${size};overflow:hidden;display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
  const img = document.createElement('img');
  img.src = `sprites/${id}.png`;
  img.style.cssText = 'width:100%;height:100%;image-rendering:pixelated;object-fit:cover;';
  img.onerror = function () {
    this.style.display = 'none';
    const fb = document.createElement('span');
    fb.style.cssText = 'font-size:7px;color:var(--text-dim);text-align:center;line-height:1.2;padding:2px;';
    fb.textContent = (TABLET_MAP[id]?.name || String(id)).substring(0, 8);
    wrap.appendChild(fb);
  };
  wrap.appendChild(img);
  return wrap;
}

// ── Picker ───────────────────────────────────────────────────────

function togglePicker() {
  pickerExpanded = !pickerExpanded;
  const sec = document.getElementById('picker-section');
  const btn = document.getElementById('picker-toggle-btn');
  sec.classList.toggle('expanded', pickerExpanded);
  btn.textContent = pickerExpanded ? 'Collapse ▼' : 'Expand ▲';
}

function toggleTabletSort() {
  setTabletSortMode(tabletSortMode === 'id' ? 'name' : 'id');
}

function setTabletSortMode(mode) {
  tabletSortMode = mode === 'name' ? 'name' : 'id';
  const btn = document.getElementById('picker-sort-btn');
  if (btn) btn.textContent = tabletSortMode === 'name' ? 'Sort: Name' : 'Sort: ID';
  renderPicker();
}

function renderPicker() {
  const el = document.getElementById('tablet-picker');
  el.innerHTML = '';
  const items = [...TABLETS_DATA.items];
  if (tabletSortMode === 'name') {
    items.sort((a, b) => a.name.localeCompare(b.name));
  } else {
    items.sort((a, b) => a.id - b.id);
  }
  const sortBtn = document.getElementById('picker-sort-btn');
  if (sortBtn) sortBtn.textContent = tabletSortMode === 'name' ? 'Sort: Name' : 'Sort: ID';
  for (const t of items) {
    const cell = document.createElement('div');
    cell.className = 'picker-cell';

    const img = document.createElement('img');
    img.src = `sprites/${t.id}.png`;
    img.alt = '';
    img.onerror = function () {
      this.style.display = 'none';
      const fb = document.createElement('span');
      fb.className = 'fallback';
      fb.textContent = t.name.substring(0, 8);
      cell.appendChild(fb);
    };
    cell.appendChild(img);

    const pid = document.createElement('span');
    pid.className = 'pid';
    pid.textContent = t.id;
    cell.appendChild(pid);

    cell.addEventListener('click',      () => addToCollection(t.id));
    cell.addEventListener('mouseenter', e  => showTooltip(e, t));
    cell.addEventListener('mouseleave', hideTooltip);
    el.appendChild(cell);
  }
}

// ── Collection ───────────────────────────────────────────────────

function addToCollection(id) {
  collection[id] = (collection[id] || 0) + 1;
  renderCollection();
}

function countPlacedOfType(id) {
  let c = 0;
  for (const v of Object.values(gridPlacements)) if (v.tabletId === id) c++;
  return c;
}

function renderCollection() {
  const el  = document.getElementById('collection-list');
  el.innerHTML = '';
  const ids = Object.keys(collection).map(Number).filter(id => collection[id] > 0);
  if (!ids.length) {
    el.innerHTML = '<div class="empty-collection">No tablets added yet.<br>Click any tablet above.</div>';
    return;
  }
  for (const id of ids) {
    const t      = TABLET_MAP[id];
    const cnt    = collection[id];
    const placed = countPlacedOfType(id);
    const item   = document.createElement('div');
    item.className = 'collection-item' + (selectedTabletId === id ? ' selected' : '');

    const sprWrap = document.createElement('div');
    sprWrap.className = 'spr';
    sprWrap.appendChild(makeSpriteEl(id, '100%'));
    item.appendChild(sprWrap);

    const info = document.createElement('div');
    info.className = 'info';
    const nm = document.createElement('div');
    nm.className = 'name';
    nm.textContent = t.name;
    info.appendChild(nm);
    const tags  = document.createElement('div');
    tags.className = 'tags';
    const parts = [];
    if (t.disableRotate)      parts.push('<span class="tag">fixed</span>');
    if (t.activationPosition) parts.push(`<span class="tag">edge:${t.activationPosition.join('/')}</span>`);
    parts.push(`<span style="color:var(--text-dim)">${placed}/${cnt} placed</span>`);
    tags.innerHTML = parts.join(' ');
    info.appendChild(tags);
    item.appendChild(info);

    const ctrl  = document.createElement('div');
    ctrl.className = 'count-ctrl';
    const minus = document.createElement('button');
    minus.className = 'count-btn';
    minus.textContent = '−';
    minus.addEventListener('click', e => {
      e.stopPropagation();
      if (cnt > 1) { collection[id]--; renderCollection(); }
    });
    const valEl = document.createElement('span');
    valEl.className = 'count-val';
    valEl.textContent = cnt;
    const plus = document.createElement('button');
    plus.className = 'count-btn';
    plus.textContent = '+';
    plus.addEventListener('click', e => { e.stopPropagation(); collection[id]++; renderCollection(); });
    ctrl.append(minus, valEl, plus);
    item.appendChild(ctrl);

    const rem = document.createElement('button');
    rem.className = 'remove-btn';
    rem.textContent = '×';
    rem.title = 'Remove from collection';
    rem.addEventListener('click', e => {
      e.stopPropagation();
      delete collection[id];
      if (selectedTabletId === id) { selectedTabletId = null; updateActiveBar(); }
      renderCollection();
      renderGrid();
    });
    item.appendChild(rem);

    item.addEventListener('click',      () => selectTabletFromCollection(id));
    item.addEventListener('mouseenter', e  => showTooltip(e, t));
    item.addEventListener('mouseleave', hideTooltip);
    el.appendChild(item);
  }
}

function selectTabletFromCollection(id) {
  if (!collection[id]) return;
  if (selectedTabletId === id) {
    selectedTabletId = null;
    selectedCellKey  = null;
  } else {
    selectedTabletId = id;
    selectedCellKey  = null;
    selectedRotation = 0;
  }
  renderCollection();
  renderGrid();
  updateActiveBar();
}

// ── Grid Render ──────────────────────────────────────────────────

function renderGrid() {
  const gridEl = document.getElementById('inv-grid');
  gridEl.innerHTML = '';

  const maxRow    = totalRows();
  const renderRows = expandedSlots < MAX_EXPAND ? maxRow + (expandedSlots % COLS === 0 ? 1 : 0) : maxRow;
  gridEl.style.gridTemplateRows = `repeat(${renderRows}, var(--cell))`;

  const buffMap = computeBuffMap(gridPlacements, maxRow);

  const aoeMap = {};
  if (selectedCellKey && gridPlacements[selectedCellKey]) {
    const { tabletId, rotation } = gridPlacements[selectedCellKey];
    const [r, c] = selectedCellKey.split(',').map(Number);
    for (const { col, row, buff } of getTabletContributions(TABLET_MAP[tabletId], c, r, rotation, maxRow)) {
      const k = `${row},${col}`;
      aoeMap[k] = (aoeMap[k] || 0) + buff;
    }
  }

  for (let row = 1; row <= renderRows; row++) {
    for (let col = 1; col <= COLS; col++) {
      const cell = document.createElement('div');
      const key  = `${row},${col}`;

      const active = isActiveCell(row, col);
      const expand = !active && isExpandSlot(row, col);

      if (!active && !expand) {
        cell.className = 'grid-cell inactive';
        gridEl.appendChild(cell);
        continue;
      }

      if (expand) {
        cell.className = 'grid-cell expand-slot';
        const icon = document.createElement('span');
        icon.className = 'expand-icon';
        icon.textContent = '+';
        cell.appendChild(icon);
        cell.title = `Add expansion slot (${expandedSlots + 1}/${MAX_EXPAND})`;
        cell.addEventListener('click', () => {
          expandedSlots++;
          renderGrid();
          updateStats();
        });
        gridEl.appendChild(cell);
        continue;
      }

      cell.className = 'grid-cell';
      if (aoeMap[key] !== undefined) {
        cell.classList.add(aoeMap[key] > 0 ? 'aoe-pos' : 'aoe-neg');
      }
      if (selectedCellKey === key) cell.classList.add('highlight');

      const placement = gridPlacements[key];
      if (placement) {
        const td   = TABLET_MAP[placement.tabletId];
        const wrap = document.createElement('div');
        wrap.className = 'cell-tablet' + (selectedCellKey === key ? ' selected-tablet' : '');

        const img = document.createElement('img');
        img.src = `sprites/${placement.tabletId}.png`;
        img.alt = '';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;image-rendering:pixelated;pointer-events:none;';
        img.onerror = function () {
          this.style.display = 'none';
          const fb = document.createElement('span');
          fb.className = 'fallback-grid';
          fb.textContent = td.name.substring(0, 8);
          wrap.insertBefore(fb, wrap.firstChild);
        };
        wrap.appendChild(img);

        const badge = document.createElement('span');
        badge.className = 'rot-badge' + (placement.rotation === 0 ? ' hidden' : '');
        badge.textContent = ['↑', '→', '↓', '←'][placement.rotation];
        wrap.appendChild(badge);
        cell.appendChild(wrap);

        if (!checkActivation(td, col, row, maxRow)) {
          cell.style.opacity = '0.45';
          cell.title = `${td.name} — INACTIVE (needs edge: ${td.activationPosition.join('/')})`;
        } else {
          cell.title = `${td.name} [${placement.rotation * 90}°] — click to pick up`;
        }
        cell.addEventListener('click', () => clickPlacedTablet(key));
      } else {
        const v      = buffMap[key] || 0;
        const buffEl = document.createElement('span');
        buffEl.className  = 'cell-buff ' + (v > 0 ? 'pos' : v < 0 ? 'neg' : 'zero');
        buffEl.textContent = v > 0 ? `+${v}` : v === 0 ? '·' : v;
        cell.appendChild(buffEl);
        cell.addEventListener('click',      () => clickEmptyCell(key, row, col));
        cell.addEventListener('mouseenter', () => hoverEmptyCell(key, row, col));
        cell.addEventListener('mouseleave', clearHoverAoe);
      }

      gridEl.appendChild(cell);
    }
  }

  updateStats(buffMap, maxRow);
}

// ── Cell Interactions ────────────────────────────────────────────

function hoverEmptyCell(key, row, col) {
  if (!selectedTabletId) return;
  const td      = TABLET_MAP[selectedTabletId];
  const maxRow  = totalRows();
  const cellEls = buildCellMap(maxRow);
  for (const { col: tc, row: tr, buff } of getTabletContributions(td, col, row, selectedRotation, maxRow)) {
    const k = `${tr},${tc}`;
    if (cellEls[k] && !gridPlacements[k]) {
      cellEls[k].classList.add(buff > 0 ? 'aoe-pos' : 'aoe-neg');
    }
  }
}

function clearHoverAoe() {
  document.querySelectorAll('.grid-cell.aoe-pos, .grid-cell.aoe-neg').forEach(el => {
    el.classList.remove('aoe-pos', 'aoe-neg');
  });
}

function buildCellMap(maxRow) {
  const els        = document.querySelectorAll('.grid-cell');
  const renderRows = expandedSlots < MAX_EXPAND ? maxRow + (expandedSlots % COLS === 0 ? 1 : 0) : maxRow;
  const map = {};
  let i = 0;
  for (let r = 1; r <= renderRows; r++)
    for (let c = 1; c <= COLS; c++)
      map[`${r},${c}`] = els[i++];
  return map;
}

function clickEmptyCell(key, row, col) {
  if (!selectedTabletId) return;
  if (countPlacedOfType(selectedTabletId) >= (collection[selectedTabletId] || 0)) {
    setLog('No more copies available', 'err');
    return;
  }
  gridPlacements[key] = { tabletId: selectedTabletId, rotation: selectedRotation };
  renderGrid();
  renderCollection();
  setLog('');
}

function clickPlacedTablet(key) {
  if (selectedCellKey === key) {
    const { tabletId, rotation } = gridPlacements[key];
    delete gridPlacements[key];
    selectedTabletId = tabletId;
    selectedRotation = rotation;
    selectedCellKey  = null;
  } else {
    selectedCellKey  = key;
    selectedTabletId = gridPlacements[key].tabletId;
    selectedRotation = gridPlacements[key].rotation;
  }
  renderGrid();
  renderCollection();
  updateActiveBar();
}

// ── Stats Bar ────────────────────────────────────────────────────

function updateStats(buffMap, maxRow) {
  if (!buffMap) { maxRow = totalRows(); buffMap = computeBuffMap(gridPlacements, maxRow); }
  let total = 0;
  for (let r = 1; r <= maxRow; r++)
    for (let c = 1; c <= COLS; c++)
      if (isActiveCell(r, c) && !gridPlacements[`${r},${c}`])
        total += buffMap[`${r},${c}`] || 0;

  document.getElementById('stat-total').textContent  = (total >= 0 ? '+' : '') + total;
  document.getElementById('stat-placed').textContent = Object.keys(gridPlacements).length;
  document.getElementById('stat-grid').textContent   = `6×${BASE_ROWS} +${expandedSlots}`;
}

// ── Active Tablet Bar ────────────────────────────────────────────

function updateActiveBar() {
  const bar = document.getElementById('active-tablet-bar');
  bar.innerHTML = '';
  if (!selectedTabletId) {
    const none = document.createElement('div');
    none.className = 'atb-none';
    none.textContent = 'No tablet selected';
    bar.appendChild(none);
    return;
  }
  const td = TABLET_MAP[selectedTabletId];

  const sprWrap = document.createElement('div');
  sprWrap.className = 'atb-sprite';
  sprWrap.appendChild(makeSpriteEl(selectedTabletId, '100%'));
  bar.appendChild(sprWrap);

  const info = document.createElement('div');
  info.className = 'atb-info';
  const nm = document.createElement('div');
  nm.className = 'atb-name';
  nm.textContent = td.name;
  const hint = document.createElement('div');
  hint.className = 'atb-hint';
  hint.textContent = td.disableRotate ? 'Cannot rotate' : `Rotation: ${selectedRotation * 90}° — R or click ↻`;
  info.append(nm, hint);
  bar.appendChild(info);

  const rotBtn = document.createElement('button');
  rotBtn.className = 'atb-rot' + (td.disableRotate ? ' disabled' : '');
  rotBtn.textContent = '↻ Rotate';
  rotBtn.addEventListener('click', rotateSelected);
  bar.appendChild(rotBtn);
}

function rotateSelected() {
  if (!selectedTabletId) return;
  if (TABLET_MAP[selectedTabletId].disableRotate) return;
  selectedRotation = (selectedRotation + 1) % 4;
  if (selectedCellKey && gridPlacements[selectedCellKey]) {
    gridPlacements[selectedCellKey].rotation = selectedRotation;
  }
  renderGrid();
  updateActiveBar();
}

function clearGrid() {
  gridPlacements   = {};
  selectedCellKey  = null;
  selectedTabletId = null;
  selectedRotation = 0;
  expandedSlots    = 0;
  solverResults    = [];
  appliedResultIdx = -1;
  renderGrid();
  renderCollection();
  updateActiveBar();
  renderResults();
  setLog('');
}

// ── Solver Mode Controls ─────────────────────────────────────────

function setMode(mode) {
  solveMode = mode;
  document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`btn-mode-${mode}`).classList.add('active');
  document.getElementById('target-row').style.display = mode === 'target' ? 'flex' : 'none';
}

function setLog(msg, type = '') {
  const el = document.getElementById('solver-log');
  el.textContent = msg;
  el.className = 'solver-log' + (type ? ' ' + type : '');
}

// ── Results Panel ────────────────────────────────────────────────

function renderResults() {
  const el = document.getElementById('results-section');
  el.innerHTML = '';
  if (!solverResults.length) {
    el.innerHTML = '<div class="no-results">Run solver to see results.</div>';
    return;
  }
  const maxRow = totalRows();
  solverResults.forEach((res, idx) => {
    const card = document.createElement('div');
    card.className = 'result-card' + (appliedResultIdx === idx ? ' applied' : '');

    let total = 0;
    const dist = {};
    for (let r = 1; r <= maxRow; r++)
      for (let c = 1; c <= COLS; c++)
        if (isActiveCell(r, c) && !res.placements[`${r},${c}`]) {
          const v = res.buffMap[`${r},${c}`] || 0;
          total += v;
          dist[v] = (dist[v] || 0) + 1;
        }

    const hdr = document.createElement('div');
    hdr.className = 'result-header';
    hdr.innerHTML =
      `<span class="result-title">Option ${idx + 1}</span>` +
      `<span class="result-score">${total >= 0 ? '+' : ''}${total}</span>`;
    card.appendChild(hdr);

    const distEl = document.createElement('div');
    distEl.className = 'result-dist';
    const sorted = Object.entries(dist).sort(([a], [b]) => Number(b) - Number(a));
    for (const [val, cnt] of sorted.slice(0, 7)) {
      const row = document.createElement('div');
      row.className = 'd-entry';
      const n = Number(val);
      row.innerHTML =
        `<span class="d-val" style="color:${n > 0 ? 'var(--green)' : n < 0 ? 'var(--red)' : 'var(--text-dim)'}">${n > 0 ? '+' : ''}${n}</span>` +
        `<span>${cnt} slot${cnt > 1 ? 's' : ''}</span>`;
      distEl.appendChild(row);
    }
    card.appendChild(distEl);

    const applyBtn = document.createElement('button');
    applyBtn.className = 'apply-btn';
    applyBtn.textContent = appliedResultIdx === idx ? '✓ Applied' : 'Apply to Grid';
    applyBtn.addEventListener('click', e => { e.stopPropagation(); applyResult(idx); });
    card.appendChild(applyBtn);

    el.appendChild(card);
  });
}

function applyResult(idx) {
  const res = solverResults[idx];
  gridPlacements   = JSON.parse(JSON.stringify(res.placements));
  appliedResultIdx = idx;
  selectedTabletId = null;
  selectedCellKey  = null;
  renderGrid();
  renderCollection();
  updateActiveBar();
  renderResults();
  setLog(`Applied Option ${idx + 1}`, 'ok');
}

// ── Tooltip ──────────────────────────────────────────────────────

function showTooltip(e, t) {
  const tip = document.getElementById('tooltip');
  let html = `<b>${t.name}</b>`;
  if (t.disableRotate)    html += `<span style="color:var(--text-dim)">Cannot rotate</span><br>`;
  if (t.activationPosition) html += `<span style="color:var(--teal)">Edge: ${t.activationPosition.join(', ')}</span><br>`;
  if (t.effects)   for (const [x, y, b] of t.effects)
    html += `<span style="color:${b > 0 ? 'var(--green)' : 'var(--red)'}">${b > 0 ? '+' : ''}${b}</span> at (${x > 0 ? '+' : ''}${x}, ${y > 0 ? '+' : ''}${y})<br>`;
  if (t.lineBuff)  for (const lb of t.lineBuff)
    html += `<span style="color:${lb.buff > 0 ? 'var(--green)' : 'var(--red)'}">${lb.buff > 0 ? '+' : ''}${lb.buff}</span> ${lb.axis} [${lb.ref}]<br>`;
  tip.innerHTML = html;
  tip.classList.add('visible');
  posTooltip(e);
}

function posTooltip(e) {
  const tip = document.getElementById('tooltip');
  tip.style.left = (e.clientX + 14) + 'px';
  tip.style.top  = (e.clientY - 8)  + 'px';
}

function hideTooltip() {
  document.getElementById('tooltip').classList.remove('visible');
}

// ── Keyboard & Mouse Global Listeners ───────────────────────────

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'r' || e.key === 'R') rotateSelected();
  if (e.key === 'Escape') {
    selectedTabletId = null;
    selectedCellKey  = null;
    renderGrid();
    renderCollection();
    updateActiveBar();
  }
});

document.addEventListener('mousemove', e => {
  if (document.getElementById('tooltip').classList.contains('visible')) posTooltip(e);
});
