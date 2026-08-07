// Results table dialog — browse, sort and filter every layout the solver found.
// Depends on: state.js, engine.js, solver.js, ui.js

// Score groups the user has chosen to expand while ties are collapsed.
let expandedTies = new Set();

// ── Pure view model ──────────────────────────────────────────────
// Kept free of DOM so it can be unit-tested headlessly.

// The raw score is deliberately absent — it's a lexicographic weight sum that means
// nothing to a player. Results arrive best-first, so the '#' column already carries
// the ranking, and ties still group on score behind the scenes.
const BASE_COLUMNS = [
  { key: 'rank',    label: '#',          get: (r, i) => i + 1 },
  { key: 'total',   label: 'Total buff', get: r => r.stats.total },
  { key: 'covered', label: 'Covered',    get: r => r.stats.covered },
  { key: 'pins',    label: 'Targets',    get: r => r.stats.pinsMet },
  { key: 'rules',   label: 'Rules',      get: r => r.ruleBreakdown ? r.ruleBreakdown.filter(b => b.satisfied).length : 0 },
];

// One column per buff value that actually occurs, highest first — the shape of a
// layout's payoff is the thing worth comparing across results.
function buffColumns(results) {
  const vals = new Set();
  for (const r of results)
    for (const k of Object.keys(r.stats.dist)) vals.add(Number(k));
  return [...vals].sort((a, b) => b - a).map(v => ({
    key: `buff:${v}`,
    label: (v > 0 ? '+' : '') + v,
    buffValue: v,
    get: r => r.stats.dist[v] || 0,
  }));
}

// How many slots in one layout hold a buff matching op/value.
function countAtBuff(dist, op, value) {
  let n = 0;
  for (const [k, count] of Object.entries(dist)) {
    const v = Number(k);
    if (op === 'gte' ? v >= value : op === 'lte' ? v <= value : v === value) n += count;
  }
  return n;
}

// Returns [{ res, idx, tieCount, collapsed }] — `idx` indexes solverResults, so a
// row's Apply can call the existing applyResult(idx) untouched.
function filterSortResults(results, sort, filters, expanded = new Set()) {
  const rows = results
    .map((res, idx) => ({ res, idx }))
    .filter(({ res }) => {
      const s = res.stats;
      if (filters.minBuff    != null && s.total   < filters.minBuff)    return false;
      if (filters.minCovered != null && s.covered < filters.minCovered) return false;
      if (filters.rulesOnly  && !res.rulesSatisfied)                    return false;
      if (filters.slotValue != null &&
          countAtBuff(s.dist, filters.slotOp, filters.slotValue) < (filters.slotCount || 1))
        return false;
      return true;
    });

  const col = allResultColumns(results).find(c => c.key === sort.key) || BASE_COLUMNS[0];
  // `rank` means "solver order", which is the array order — sorting by the accessor
  // would use the post-filter position and scramble it.
  if (col.key !== 'rank')
    rows.sort((a, b) => {
      const d = col.get(a.res, a.idx) - col.get(b.res, b.idx);
      return sort.dir === 'asc' ? d : -d;
    });
  else if (sort.dir === 'asc')
    rows.sort((a, b) => a.idx - b.idx);
  else
    rows.sort((a, b) => b.idx - a.idx);

  if (!filters.collapseTies)
    return rows.map(r => ({ ...r, tieCount: 1, collapsed: false }));

  // Ties are common — roughly 3 layouts per distinct score — so one row per score
  // by default, with the rest reachable by expanding the group.
  const out = [], counts = new Map();
  for (const r of rows) counts.set(r.res.score, (counts.get(r.res.score) || 0) + 1);
  const emitted = new Set();
  for (const r of rows) {
    const n = counts.get(r.res.score);
    if (n === 1) { out.push({ ...r, tieCount: 1, collapsed: false }); continue; }
    if (expanded.has(r.res.score)) { out.push({ ...r, tieCount: n, collapsed: false }); continue; }
    if (emitted.has(r.res.score)) continue;
    emitted.add(r.res.score);
    out.push({ ...r, tieCount: n, collapsed: true });
  }
  return out;
}

// Every column the current solve can show, base then per-buff.
function allResultColumns(results) {
  return [...BASE_COLUMNS, ...buffColumns(results)];
}

// Which of those make sense — targets and rules only when the solve actually had them.
function visibleResultColumns(results) {
  const anyPins  = results.some(r => r.stats.pinsTot > 0);
  const anyRules = results.some(r => r.ruleBreakdown);
  return allResultColumns(results).filter(c =>
    (c.key !== 'pins'  || anyPins) &&
    (c.key !== 'rules' || anyRules));
}

// ── Open / Close ─────────────────────────────────────────────────

function openResultsDialog() {
  if (document.getElementById('results-overlay')) return;
  if (!solverResults.length) return;
  expandedTies = new Set();

  const overlay = document.createElement('div');
  overlay.id = 'results-overlay';
  overlay.className = 'results-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeResultsDialog(); });
  // The global Escape handler bails on INPUT targets and this dialog has filter inputs.
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeResultsDialog(); });

  const dialog = document.createElement('div');
  dialog.className = 'results-dialog';

  const hdr = document.createElement('div');
  hdr.className = 'results-hdr';
  const title = document.createElement('span');
  title.className = 'results-hdr-title';
  title.textContent = `◆ All Results (${solverResults.length})`;
  const closeBtn = document.createElement('button');
  closeBtn.className = 'results-close-btn';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeResultsDialog);
  hdr.append(title, closeBtn);
  dialog.appendChild(hdr);

  dialog.appendChild(buildResultsFilterBar());

  const wrap = document.createElement('div');
  wrap.id = 'results-table-wrap';
  wrap.className = 'results-table-wrap';
  dialog.appendChild(wrap);

  const footer = document.createElement('div');
  footer.className = 'results-footer';
  const count = document.createElement('span');
  count.id = 'results-count';
  count.className = 'results-count';
  footer.appendChild(count);
  dialog.appendChild(footer);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);
  renderResultsTable();
}

function closeResultsDialog() {
  const overlay = document.getElementById('results-overlay');
  if (overlay) overlay.remove();
}

// ── Filter bar ───────────────────────────────────────────────────

function buildResultsFilterBar() {
  const bar = document.createElement('div');
  bar.className = 'results-filters';

  bar.appendChild(filterNumber('Min total buff', resultsFilters.minBuff, v => {
    resultsFilters.minBuff = v; renderResultsTable();
  }));
  bar.appendChild(filterNumber('Min covered', resultsFilters.minCovered, v => {
    resultsFilters.minCovered = v; renderResultsTable();
  }));
  bar.appendChild(buildSlotFilter());

  if (solverResults.some(r => r.ruleBreakdown))
    bar.appendChild(filterCheck('Rules satisfied only', resultsFilters.rulesOnly, v => {
      resultsFilters.rulesOnly = v; renderResultsTable();
    }));

  bar.appendChild(filterCheck('Collapse identical scores', resultsFilters.collapseTies, v => {
    resultsFilters.collapseTies = v; expandedTies = new Set(); renderResultsTable();
  }));

  return bar;
}

// "at least N slots with buff <op> V" — one compound control instead of a min-count
// box per buff column, and it mirrors how rules are phrased elsewhere in the app.
function buildSlotFilter() {
  const wrap = document.createElement('span');
  wrap.className = 'results-filter results-slot-filter';

  const lead = document.createElement('span');
  lead.textContent = 'At least';
  wrap.appendChild(lead);

  const count = document.createElement('input');
  count.type = 'number';
  count.min = 1;
  count.className = 'results-filter-num narrow';
  count.value = resultsFilters.slotCount;
  count.addEventListener('input', () => {
    resultsFilters.slotCount = count.value === '' ? 1 : parseInt(count.value, 10);
    renderResultsTable();
  });
  wrap.appendChild(count);

  const mid = document.createElement('span');
  mid.textContent = 'slots with buff';
  wrap.appendChild(mid);

  const op = document.createElement('select');
  op.className = 'results-filter-op';
  for (const [k, label] of Object.entries({ gte: '≥', eq: '=', lte: '≤' })) {
    const o = document.createElement('option');
    o.value = k; o.textContent = label;
    if (k === resultsFilters.slotOp) o.selected = true;
    op.appendChild(o);
  }
  op.addEventListener('change', () => { resultsFilters.slotOp = op.value; renderResultsTable(); });
  wrap.appendChild(op);

  const val = document.createElement('input');
  val.type = 'number';
  val.className = 'results-filter-num narrow';
  val.placeholder = 'off';
  val.value = resultsFilters.slotValue == null ? '' : resultsFilters.slotValue;
  // Blank switches the whole filter off — 0 is a real buff value, not "unset".
  val.addEventListener('input', () => {
    resultsFilters.slotValue = val.value === '' ? null : parseInt(val.value, 10);
    renderResultsTable();
  });
  wrap.appendChild(val);

  return wrap;
}

function filterNumber(label, value, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'results-filter';
  const span = document.createElement('span');
  span.textContent = label;
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.className = 'results-filter-num';
  inp.value = value == null ? '' : value;
  inp.placeholder = 'any';
  // Blank means "no cutoff" rather than 0, which would filter out valid results.
  inp.addEventListener('input', () =>
    onChange(inp.value === '' ? null : parseInt(inp.value, 10)));
  wrap.append(span, inp);
  return wrap;
}

function filterCheck(label, value, onChange) {
  const wrap = document.createElement('label');
  wrap.className = 'results-filter';
  const inp = document.createElement('input');
  inp.type = 'checkbox';
  inp.checked = value;
  inp.addEventListener('change', () => onChange(inp.checked));
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(inp, span);
  return wrap;
}

// ── Table ────────────────────────────────────────────────────────

function renderResultsTable() {
  const wrap = document.getElementById('results-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = '';

  const cols = visibleResultColumns(solverResults);
  const rows = filterSortResults(solverResults, resultsTableSort, resultsFilters, expandedTies);

  const count = document.getElementById('results-count');
  if (count) count.textContent =
    `${rows.length} row${rows.length === 1 ? '' : 's'} of ${solverResults.length} results`;

  if (!rows.length) {
    const empty = document.createElement('div');
    empty.className = 'results-empty';
    empty.textContent = 'No results match these filters.';
    wrap.appendChild(empty);
    return;
  }

  const table = document.createElement('table');
  table.className = 'results-table';

  const thead = document.createElement('thead');
  const htr = document.createElement('tr');
  for (const c of cols) {
    const th = document.createElement('th');
    th.className = 'rt-sortable' + (resultsTableSort.key === c.key ? ' sorted' : '') +
                   (c.buffValue !== undefined ? ' rt-buff-col' : '');
    if (c.buffValue !== undefined) {
      th.title = `Slots holding exactly ${c.label}`;
      // Same green/red/dim convention the result cards use for buff values.
      if (resultsTableSort.key !== c.key)
        th.style.color = c.buffValue > 0 ? 'var(--green)'
                       : c.buffValue < 0 ? 'var(--red)' : 'var(--text-dim)';
    }
    th.textContent = c.label +
      (resultsTableSort.key === c.key ? (resultsTableSort.dir === 'asc' ? ' ▲' : ' ▼') : '');
    th.addEventListener('click', () => {
      if (resultsTableSort.key === c.key)
        resultsTableSort.dir = resultsTableSort.dir === 'asc' ? 'desc' : 'asc';
      else
        resultsTableSort = { key: c.key, dir: c.key === 'rank' ? 'asc' : 'desc' };
      renderResultsTable();
    });
    htr.appendChild(th);
  }
  htr.appendChild(document.createElement('th'));
  thead.appendChild(htr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  for (const { res, idx, tieCount, collapsed } of rows) {
    const tr = document.createElement('tr');
    if (appliedResultIdx === idx) tr.className = 'rt-applied';

    for (const c of cols) {
      const td = document.createElement('td');
      if (c.key === 'rank') {
        td.textContent = `#${idx + 1}`;
        if (tieCount > 1 && collapsed) {
          const badge = document.createElement('span');
          badge.className = 'rt-tie-badge';
          badge.textContent = `×${tieCount}`;
          badge.title = `${tieCount} layouts the solver rated identically — click to expand`;
          badge.addEventListener('click', e => {
            e.stopPropagation();
            expandedTies.add(res.score);
            renderResultsTable();
          });
          td.appendChild(badge);
        }
      } else if (c.key === 'covered') {
        td.textContent = `${res.stats.covered}/${res.stats.slots}`;
      } else if (c.key === 'pins') {
        td.textContent = `${res.stats.pinsMet}/${res.stats.pinsTot}`;
      } else if (c.key === 'rules') {
        const met = res.ruleBreakdown.filter(b => b.satisfied).length;
        td.textContent = `${met}/${res.ruleBreakdown.length}`;
        if (!res.rulesSatisfied) td.className = 'rt-unmet';
      } else if (c.buffValue !== undefined) {
        const n = c.get(res, idx);
        // Blank rather than "0" — the distribution shape should read at a glance.
        td.textContent = n || '';
        td.className = 'rt-buff-col';
      } else {
        td.textContent = c.get(res, idx);
      }
      tr.appendChild(td);
    }

    const actionTd = document.createElement('td');
    const btn = document.createElement('button');
    btn.className = 'rt-apply-btn';
    btn.textContent = appliedResultIdx === idx ? '✓' : 'Apply';
    btn.addEventListener('click', () => { applyResult(idx); renderResultsTable(); });
    actionTd.appendChild(btn);
    tr.appendChild(actionTd);

    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
}
