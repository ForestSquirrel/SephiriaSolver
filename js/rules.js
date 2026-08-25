// Rules dialog — state and DOM management.
// Depends on: state.js, engine.js, solver.js, ui.js

// Edits go to a draft; the globals only change on Apply, so closing is cancelling.
let ruleDraft     = [];
let ruleRestMode  = 'maximize';
let ruleRestTgt   = 3;
let ruleDragIdx   = null;
let ruleNextId    = 1;

// ── Open / Close ─────────────────────────────────────────────────

function openRulesDialog() {
  if (document.getElementById('rules-overlay')) return;
  ruleDraft    = rules.map(r => ({ ...r }));
  ruleRestMode = restMode;
  ruleRestTgt  = restTarget;
  ruleDragIdx  = null;
  for (const r of ruleDraft) ruleNextId = Math.max(ruleNextId, r.id + 1);

  const overlay = document.createElement('div');
  overlay.id = 'rules-overlay';
  overlay.className = 'rules-overlay';
  overlay.addEventListener('click', e => { if (e.target === overlay) closeRulesDialog(); });
  // The global Escape handler bails out on INPUT targets, and this dialog is
  // almost entirely inputs — so it needs its own.
  overlay.addEventListener('keydown', e => { if (e.key === 'Escape') closeRulesDialog(); });

  const dialog = document.createElement('div');
  dialog.className = 'rules-dialog';

  // Header
  const hdr = document.createElement('div');
  hdr.className = 'rules-hdr';
  const title = document.createElement('span');
  title.className = 'rules-hdr-title';
  title.textContent = '◆ Manage Rules';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'rules-close-btn';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeRulesDialog);
  hdr.append(title, closeBtn);
  dialog.appendChild(hdr);

  // Body — rule rows + add button
  const body = document.createElement('div');
  body.className = 'rules-body';
  const list = document.createElement('div');
  list.id = 'rules-list';
  list.className = 'rules-list';
  body.appendChild(list);
  const addBtn = document.createElement('button');
  addBtn.className = 'rules-add-btn';
  addBtn.textContent = '+ Add Rule';
  addBtn.addEventListener('click', () => {
    ruleDraft.push({ id: ruleNextId++, countOp: 'atleast', count: 2, valueOp: 'gte', value: 5 });
    renderRuleRows();
    renderRuleRest();
    updateRulesApply();
  });
  body.appendChild(addBtn);
  dialog.appendChild(body);

  // Rest segment — permanent, non-draggable, always last in priority
  const rest = document.createElement('div');
  rest.id = 'rules-rest';
  rest.className = 'rules-rest';
  dialog.appendChild(rest);

  // Footer
  const footer = document.createElement('div');
  footer.className = 'rules-footer';
  const warn = document.createElement('div');
  warn.id = 'rules-warning';
  warn.className = 'rules-warning';
  footer.appendChild(warn);
  const btnRow = document.createElement('div');
  btnRow.className = 'rules-btn-row';
  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'rules-cancel-btn';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', closeRulesDialog);
  const applyBtn = document.createElement('button');
  applyBtn.id = 'rules-apply-btn';
  applyBtn.className = 'rules-apply-btn';
  applyBtn.textContent = 'Apply';
  applyBtn.addEventListener('click', applyRules);
  btnRow.append(cancelBtn, applyBtn);
  footer.appendChild(btnRow);
  dialog.appendChild(footer);

  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  renderRuleRows();
  renderRuleRest();
  updateRulesApply();
}

function closeRulesDialog() {
  const overlay = document.getElementById('rules-overlay');
  if (overlay) overlay.remove();
}

function applyRules() {
  if (validateRules(ruleDraft)) return;
  rules      = ruleDraft.map(r => ({ ...r }));
  restMode   = ruleRestMode;
  restTarget = ruleRestTgt;
  invalidateSolverResults();
  updateEngineUI();   // rule count changed — button label and the high-value row follow
  closeRulesDialog();
}

// ── Rule rows ────────────────────────────────────────────────────

function renderRuleRows() {
  const list = document.getElementById('rules-list');
  if (!list) return;
  list.innerHTML = '';

  if (!ruleDraft.length) {
    const empty = document.createElement('div');
    empty.className = 'rules-empty';
    empty.textContent = 'No rules yet — every slot is scored by the setting below.';
    list.appendChild(empty);
    return;
  }

  ruleDraft.forEach((r, idx) => {
    const row = document.createElement('div');
    row.className = 'rules-row';

    // Drag to reorder. Order is a tiebreak rather than a footgun — the scorer
    // claims cheapest-satisfying cells first — but it's still the escape hatch.
    const handle = document.createElement('span');
    handle.className = 'rules-handle';
    handle.textContent = '⠿';
    handle.title = 'Drag to reorder — higher rules pick their slots first';
    handle.draggable = true;
    handle.addEventListener('dragstart', e => {
      ruleDragIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
      // Firefox won't start a drag without payload.
      e.dataTransfer.setData('text/plain', String(idx));
      row.classList.add('dragging');
    });
    handle.addEventListener('dragend', () => { ruleDragIdx = null; renderRuleRows(); });
    row.appendChild(handle);

    row.addEventListener('dragover', e => {
      if (ruleDragIdx === null || ruleDragIdx === idx) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.classList.add(ruleDragIdx < idx ? 'drop-below' : 'drop-above');
    });
    row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.classList.remove('drop-above', 'drop-below');
      if (ruleDragIdx === null || ruleDragIdx === idx) return;
      const [moved] = ruleDraft.splice(ruleDragIdx, 1);
      ruleDraft.splice(idx, 0, moved);
      ruleDragIdx = null;
      renderRuleRows();
    });

    row.appendChild(ruleSelect(
      { exactly: 'Exactly', atleast: 'At least', atmost: 'At most' },
      r.countOp, v => { r.countOp = v; renderRuleRows(); updateRulesApply(); }));

    row.appendChild(ruleNumber(r.count, 0, 42, v => { r.count = v; updateRulesApply(); }));

    const mid = document.createElement('span');
    mid.className = 'rules-text';
    mid.textContent = 'slots with buff';
    row.appendChild(mid);

    row.appendChild(ruleSelect(
      { gte: '≥', eq: '=', lte: '≤' },
      r.valueOp, v => { r.valueOp = v; updateRuleHint(); updateRulesApply(); }));

    row.appendChild(ruleNumber(r.value, -20, 20, v => {
      r.value = v; updateRuleHint(); updateRulesApply();
    }));

    const del = document.createElement('button');
    del.className = 'rules-del-btn';
    del.textContent = '🗑';
    del.title = 'Delete rule';
    del.addEventListener('click', () => {
      ruleDraft.splice(idx, 1);
      renderRuleRows(); renderRuleRest(); updateRulesApply();
    });
    row.appendChild(del);

    list.appendChild(row);
  });
}

function ruleSelect(options, value, onChange) {
  const sel = document.createElement('select');
  sel.className = 'rules-select';
  for (const [k, label] of Object.entries(options)) {
    const opt = document.createElement('option');
    opt.value = k;
    opt.textContent = label;
    if (k === value) opt.selected = true;
    sel.appendChild(opt);
  }
  sel.addEventListener('change', () => onChange(sel.value));
  return sel;
}

function ruleNumber(value, min, max, onChange) {
  const inp = document.createElement('input');
  inp.type = 'number';
  inp.className = 'rules-num';
  inp.value = value;
  inp.min = min;
  inp.max = max;
  inp.addEventListener('input', () => {
    // Empty / mid-edit input parses to NaN — let validation report it rather
    // than silently substituting a number the user never typed.
    onChange(inp.valueAsNumber);
  });
  return inp;
}

// ── Rest segment ─────────────────────────────────────────────────

function renderRuleRest() {
  const el = document.getElementById('rules-rest');
  if (!el) return;
  el.innerHTML = '';

  const label = document.createElement('span');
  label.className = 'rules-text';
  label.textContent = ruleDraft.length ? 'Rest of slots:' : 'All slots:';
  el.appendChild(label);

  const modes = { maximize: 'Maximize', coverage: 'Coverage', target: 'Target' };
  for (const [k, text] of Object.entries(modes)) {
    const b = document.createElement('button');
    b.className = 'rules-rest-btn' + (ruleRestMode === k ? ' active' : '');
    b.textContent = text;
    // Full re-render: switching in or out of Target adds/removes its input.
    b.addEventListener('click', () => { ruleRestMode = k; renderRuleRest(); updateRulesApply(); });
    el.appendChild(b);
  }

  if (ruleRestMode === 'target') {
    // Only the hint is refreshed here — re-rendering the whole segment would
    // rebuild this input and steal focus mid-typing.
    el.appendChild(ruleNumber(ruleRestTgt, -20, 20, v => {
      ruleRestTgt = v; updateRuleHint(); updateRulesApply();
    }));
  }

  const hint = document.createElement('div');
  hint.id = 'rules-hint';
  hint.className = 'rules-hint';
  el.appendChild(hint);
  updateRuleHint();
}

function updateRuleHint() {
  const hint = document.getElementById('rules-hint');
  if (!hint) return;
  if (ruleRestMode === 'maximize') {
    // Maximize derives its bar instead of asking for another number, so it can't
    // bid against the rules for the same scarce high-value cells.
    const derived = derivedRestCeilingOf(ruleDraft);
    hint.textContent = derived === null
      ? 'Leftover slots pushed as high as possible.'
      : `Leftover slots pushed to ≥${derived} — derived from your strictest rule.`;
  } else if (ruleRestMode === 'coverage') {
    hint.textContent = 'Leftover slots just need any buff above 0.';
  } else {
    hint.textContent = Number.isInteger(ruleRestTgt)
      ? `Leftover slots pushed toward ${ruleRestTgt}, no further.`
      : 'Enter a target value for the leftover slots.';
  }
}

// Same derivation as solver.js, against the in-progress draft.
function derivedRestCeilingOf(rs) {
  let m = null;
  for (const r of rs)
    if (r.valueOp !== 'lte' && Number.isInteger(r.value) && (m === null || r.value > m)) m = r.value;
  return m === null ? null : Math.max(1, m - 1);
}

// ── Validation ───────────────────────────────────────────────────

function updateRulesApply() {
  const warn = document.getElementById('rules-warning');
  const btn  = document.getElementById('rules-apply-btn');
  if (!warn || !btn) return;
  // A half-typed Rest target would reach the scorer as NaN and poison every score,
  // so it's gated here alongside the rules themselves.
  const msg = (ruleRestMode === 'target' && !Number.isInteger(ruleRestTgt))
    ? 'Rest target must be a whole number.'
    : (ruleRestMode === 'target' && (ruleRestTgt < -20 || ruleRestTgt > 20))
    ? 'Rest target must be between -20 and 20.'
    : validateRules(ruleDraft);
  warn.textContent = msg || '';
  btn.disabled = !!msg;
}
