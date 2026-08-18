// Rules dialog — state and DOM management.
// Depends on: state.js, engine.js, solver.js, ui.js

// Edits go to a draft; the globals only change on Apply, so closing is cancelling.
let ruleDraft     = [];
let ruleRestMode  = 'maximize';
let ruleRestTgt   = 3;
let ruleDragIdx   = null;
let ruleNextId    = 1;
let itemDraft     = [];
let itemDraftUid  = 1;

// ── Open / Close ─────────────────────────────────────────────────

function openRulesDialog() {
  if (document.getElementById('rules-overlay')) return;
  ruleDraft    = rules.map(r => ({ ...r }));
  ruleRestMode = restMode;
  ruleRestTgt  = restTarget;
  ruleDragIdx  = null;
  for (const r of ruleDraft) ruleNextId = Math.max(ruleNextId, r.id + 1);
  itemDraft    = solverItems.map(cloneItemEntry);
  itemDraftUid = Math.max(itemNextUid, ...itemDraft.map(e => e.uid + 1), 1);

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
  title.textContent = solverEngine === 'legacy' ? '◆ Items' : '◆ Manage Rules & Items';
  const closeBtn = document.createElement('button');
  closeBtn.className = 'rules-close-btn';
  closeBtn.textContent = '×';
  closeBtn.addEventListener('click', closeRulesDialog);
  hdr.append(title, closeBtn);
  dialog.appendChild(hdr);

  // Body — rule rows + add button
  const body = document.createElement('div');
  body.className = 'rules-body';

  // Slot rules are a Ruleset-engine concept; Legacy scores with its own modes, so
  // showing rules there would offer settings that do nothing.
  const showRules = solverEngine !== 'legacy';

  const list = document.createElement('div');
  list.id = 'rules-list';
  list.className = 'rules-list';
  if (!showRules) list.style.display = 'none';
  body.appendChild(list);

  // Item rules sit in their own list but read as the same kind of thing — one row,
  // configured in place. Scored by both engines, so always shown.
  const ilist = document.createElement('div');
  ilist.id = 'item-rules-list';
  ilist.className = 'rules-list';
  body.appendChild(ilist);

  const addRow = document.createElement('div');
  addRow.className = 'rules-add-row';

  const addBtn = document.createElement('button');
  addBtn.className = 'rules-add-btn';
  addBtn.textContent = '+ Add Rule';
  if (!showRules) addBtn.style.display = 'none';
  addBtn.addEventListener('click', () => {
    ruleDraft.push({ id: ruleNextId++, countOp: 'atleast', count: 2, valueOp: 'gte', value: 5 });
    renderRuleRows();
    renderRuleRest();
    updateRulesApply();
  });
  addRow.appendChild(addBtn);

  const addItemBtn = document.createElement('button');
  addItemBtn.className = 'rules-add-btn';
  addItemBtn.id = 'add-item-rule-btn';
  addItemBtn.textContent = '+ Add Item Rule';
  addItemBtn.addEventListener('click', toggleItemPicker);
  addRow.appendChild(addItemBtn);
  body.appendChild(addRow);

  // The picker only appears while you're choosing, so the dialog stays a list of
  // rules rather than a permanent gallery.
  const picker = document.createElement('div');
  picker.id = 'item-picker';
  picker.className = 'item-picker-grid';
  picker.style.display = 'none';
  body.appendChild(picker);

  dialog.appendChild(body);

  // Rest segment — permanent, non-draggable, always last in priority
  const rest = document.createElement('div');
  rest.id = 'rules-rest';
  rest.className = 'rules-rest';
  if (!showRules) rest.style.display = 'none';
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
  renderItemRules();
  updateRulesApply();
}

function closeRulesDialog() {
  const overlay = document.getElementById('rules-overlay');
  if (overlay) overlay.remove();
}

function applyRules() {
  if (validateRules(ruleDraft) || validateItems(itemDraft)) return;
  rules      = ruleDraft.map(r => ({ ...r }));
  restMode   = ruleRestMode;
  restTarget = ruleRestTgt;
  solverItems = itemDraft.map(cloneItemEntry);
  itemNextUid = itemDraftUid;
  // Each copy is its own TABLET_MAP token — same point merges register theirs.
  registerSolverItems(solverItems);
  installItemPlan(solverItems);
  renderGrid();       // item tooltips read itemPlan
  updateStats();
  updateEngineUI();   // rule/item counts changed — button label and rows follow
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
    onChange(inp.value === '' ? NaN : parseInt(inp.value, 10));
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
    : validateRules(ruleDraft) || validateItems(itemDraft);
  warn.textContent = msg || '';
  btn.disabled = !!msg;
}


// ── Item rules ───────────────────────────────────────────────────

// Entries nest two levels, so a shallow spread would let the draft and the live list
// share the same self/pins/region objects — editing the draft would take effect
// before Apply, and Cancel wouldn't cancel.
function cloneItemEntry(e) {
  return {
    ...e,
    self:   { ...(e.self || {}) },
    pins:   (e.pins || []).map(p => ({ ...p })),
    region: e.region
      ? { ...e.region, ...(e.region.entities ? { entities: [...e.region.entities] } : {}) }
      : undefined,
  };
}

// Items are picked, not placed: the solver decides where they go, so an item rule
// only has to say which item you own and what you want out of its slot. Rendered as
// a row in the same list as the slot rules, because that's what it is.

const PHASE_ICONS = ['Sturdy', 'Ember', 'Glacier', 'Magitech'];

function toggleItemPicker() {
  const picker = document.getElementById('item-picker');
  if (!picker) return;
  const open = picker.style.display !== 'none';
  picker.style.display = open ? 'none' : '';
  if (!open) renderItemPicker();
}

function renderItemPicker() {
  const picker = document.getElementById('item-picker');
  if (!picker || !ITEMS_DATA) return;
  picker.innerHTML = '';
  for (const def of ITEMS_DATA.items) {
    const cell = document.createElement('div');
    cell.className = 'item-picker-cell';
    cell.title = `${def.name} — full potential at ${def.value}${def.note ? '. ' + def.note : ''}`;

    const img = document.createElement('img');
    img.src = itemSpritePath(def);
    img.alt = '';
    img.onerror = function () {
      this.style.display = 'none';
      const fb = document.createElement('span');
      fb.className = 'fallback';
      fb.textContent = def.name.substring(0, 8);
      cell.appendChild(fb);
    };
    cell.appendChild(img);

    const val = document.createElement('span');
    val.className = 'item-val';
    val.textContent = def.value;
    cell.appendChild(val);

    const nm = document.createElement('span');
    nm.className = 'item-nm';
    nm.textContent = def.name;
    cell.appendChild(nm);

    cell.addEventListener('click', () => {
      itemDraft.push({
        uid: itemDraftUid++, itemId: def.id,
        self: { value: def.value, mode: 'hard' },
        phase: 0,
        pins: (def.pins || []).map(() => ({ value: 0, mode: 'hard' })),
        region: def.region
          ? def.region.kind === 'entities'  ? { entities: [], mode: 'hard' }
          : def.region.kind === 'keepClear' ? { keepClear: COLS }
          : {}                                  // neighborBuff has nothing to configure
          : undefined,
      });
      toggleItemPicker();
      renderItemRules();
      updateRulesApply();
    });
    picker.appendChild(cell);
  }
}

function renderItemRules() {
  const list = document.getElementById('item-rules-list');
  if (!list) return;
  list.innerHTML = '';
  itemDraft.forEach((e, idx) => {
    const def = itemDefOf(e.itemId);
    if (def) list.appendChild(itemRuleRow(e, def, idx));
  });
}

function itemRuleRow(entry, def, idx) {
  const wrap = document.createElement('div');
  wrap.className = 'rules-row item-rule';

  const head = document.createElement('div');
  head.className = 'item-rule-head';

  const img = document.createElement('img');
  img.src = itemSpritePath(def);
  img.alt = '';
  img.className = 'item-rule-spr';
  img.onerror = function () { this.style.display = 'none'; };
  head.appendChild(img);

  const nm = document.createElement('span');
  nm.className = 'item-rule-nm';
  nm.textContent = def.name;
  head.appendChild(nm);

  head.appendChild(itemValueControl(
    entry.self, 'its slot',
    `Full potential at ${def.value}. Below 0 the item does nothing at all.`));

  const del = document.createElement('button');
  del.className = 'rules-del-btn';
  del.textContent = '🗑';
  del.title = 'Remove this item rule';
  del.addEventListener('click', () => {
    itemDraft.splice(idx, 1);
    renderItemRules(); updateRulesApply();
  });
  head.appendChild(del);
  wrap.appendChild(head);

  const sub = document.createElement('div');
  sub.className = 'item-subcfg';
  let hasSub = false;

  // Row phase. Labelled with the rows it actually selects on the grid as it stands,
  // so nobody has to know where the four-row cycle is anchored.
  if (def.posClass === 'rowphase') {
    hasSub = true;
    const row = document.createElement('div');
    row.className = 'item-sub-row';
    const lbl = document.createElement('span');
    lbl.className = 'rules-text';
    lbl.textContent = 'Row type:';
    row.appendChild(lbl);

    const maxRow = totalRows();
    (ITEMS_DATA.phases || PHASE_ICONS).forEach((phaseName, i) => {
      const rows = [];
      for (let r = 1; r <= maxRow; r++) if ((r - 1) % 4 === i) rows.push(r);
      const b = document.createElement('button');
      b.className = 'item-phase-btn' + (entry.phase === i ? ' active' : '');
      b.disabled  = !rows.length;
      b.title = rows.length ? `Rows ${rows.join(', ')}` : 'No such row on this grid';

      const pi = document.createElement('img');
      pi.src = `Guides/Assets/ComboIcons/${encodeURIComponent(PHASE_ICONS[i])}.png`;
      pi.alt = '';
      pi.onerror = function () { this.style.display = 'none'; };
      b.appendChild(pi);

      const pn = document.createElement('span');
      pn.textContent = phaseName;
      b.appendChild(pn);

      const pr = document.createElement('small');
      pr.textContent = rows.length ? `row ${rows.join(', ')}` : 'none';
      b.appendChild(pr);

      b.addEventListener('click', () => { entry.phase = i; renderItemRules(); updateRulesApply(); });
      row.appendChild(b);
    });
    sub.appendChild(row);
  }

  // Neighbour slots. Grouped pins share one row — the two values aren't tied to a
  // side, so labelling them left and right was actively misleading.
  const groups = [];
  const seen = new Map();
  (def.pins || []).forEach((p, i) => {
    if (!p.group) { groups.push([i]); return; }
    if (!seen.has(p.group)) { seen.set(p.group, groups.length); groups.push([]); }
    groups[seen.get(p.group)].push(i);
  });

  for (const grp of groups) {
    hasSub = true;
    const row = document.createElement('div');
    row.className = 'item-sub-row';

    if (grp.length > 1) {
      const lbl = document.createElement('span');
      lbl.className = 'rules-text';
      lbl.textContent = 'Its neighbouring slots (either side):';
      row.appendChild(lbl);
      for (const i of grp) {
        entry.pins[i] ||= { value: 0, mode: 'hard' };
        row.appendChild(itemValueControl(entry.pins[i], null));
      }
    } else {
      const i = grp[0], pin = def.pins[i];
      entry.pins[i] ||= { value: 0, mode: 'hard' };
      const glyph = document.createElement('span');
      glyph.className = 'item-glyph';
      glyph.textContent = pin.glyph || '→';
      row.appendChild(glyph);
      const lbl = document.createElement('span');
      lbl.className = 'rules-text';
      lbl.textContent = `The slot ${pin.label || 'it buffs'}`;
      row.appendChild(lbl);
      row.appendChild(itemValueControl(entry.pins[i], null));

      // Grimoire bracket values are fixed and known, so picking the sprite fills the
      // number in — and the grid then draws that Grimoire in the slot.
      if (pin.grimoire) {
        row.appendChild(entityPicker('grimoires', entry.pins[i], 'single'));
      }
    }
    sub.appendChild(row);
  }

  // Zones.
  if (def.region?.kind === 'entities') {
    hasSub = true;
    entry.region ||= { entities: [], mode: 'hard' };
    const row = document.createElement('div');
    row.className = 'item-sub-row';
    const badge = document.createElement('span');
    badge.className = 'item-zone-badge';
    badge.textContent = def.scope === 'neighbors8' ? '◈ 8 around it' : '◈ its row';
    row.appendChild(badge);
    const lbl = document.createElement('span');
    lbl.className = 'rules-text';
    lbl.textContent = `Which ${def.region.roster === 'planets' ? 'Planets' : 'Companions'} will you put there?`;
    row.appendChild(lbl);
    row.appendChild(itemToggle({ hard: 'Enforce', soft: 'Try' }, entry.region.mode || 'hard',
      v => { entry.region.mode = v; renderItemRules(); updateRulesApply(); }));
    sub.appendChild(row);
    sub.appendChild(entityPicker(def.region.roster, entry.region, 'multi'));

    const hint = document.createElement('div');
    hint.className = 'item-hint';
    const n = entry.region.entities.length;
    hint.textContent = n
      ? `${n} slot${n === 1 ? '' : 's'} kept free of everything and pushed to their values. The rest stays open for tablets.`
      : 'Pick at least one — without it there is nothing for the solver to aim at.';
    sub.appendChild(hint);
  } else if (def.region?.kind === 'neighborBuff') {
    hasSub = true;
    const row = document.createElement('div');
    row.className = 'item-sub-row';
    const badge = document.createElement('span');
    badge.className = 'item-zone-badge';
    badge.textContent = '◈ 8 around it';
    row.appendChild(badge);
    const lbl = document.createElement('span');
    lbl.className = 'rules-text';
    lbl.textContent = 'Wants as much buff as possible in the slots around it.';
    row.appendChild(lbl);
    sub.appendChild(row);
    const hint = document.createElement('div');
    hint.className = 'item-hint';
    hint.textContent = 'Nothing to configure — it can\'t change where the tablets go, so the solver ' +
      'sits it in the richest spot once everything else is placed. Slots with a tablet on them don\'t ' +
      'count toward the total; empty slots and slots holding other items do.';
    sub.appendChild(hint);
  } else if (def.region?.kind === 'keepClear') {
    hasSub = true;
    entry.region ||= { keepClear: COLS };
    const row = document.createElement('div');
    row.className = 'item-sub-row';
    const badge = document.createElement('span');
    badge.className = 'item-zone-badge';
    badge.textContent = '◈ top row';
    row.appendChild(badge);
    const lbl = document.createElement('span');
    lbl.className = 'rules-text';
    lbl.textContent = 'Slots up there to keep free of tablets:';
    row.appendChild(lbl);
    row.appendChild(ruleNumber(entry.region.keepClear, 0, COLS, v => {
      entry.region.keepClear = v; renderItemRules(); updateRulesApply();
    }));
    sub.appendChild(row);
    const hint = document.createElement('div');
    hint.className = 'item-hint';
    hint.textContent = 'Items are welcome up there — it only keeps tablets out.';
    sub.appendChild(hint);
  }

  if (hasSub) wrap.appendChild(sub);
  return wrap;
}

// A value plus its Enforce/Try switch. Try has no number at all: it means "push this
// as high as you can", so showing a target would be a promise the mode doesn't make.
// The value is kept in the entry regardless, so flipping back restores what you typed.
function itemValueControl(target, label, title) {
  const wrap = document.createElement('span');
  wrap.className = 'item-value-ctl';
  if (title) wrap.title = title;

  if (label) {
    const l = document.createElement('span');
    l.className = 'rules-text';
    l.textContent = label;
    wrap.appendChild(l);
  }

  if (target.mode !== 'soft') {
    const l = document.createElement('span');
    l.className = 'rules-text';
    l.textContent = 'needs ≥';
    wrap.appendChild(l);
    wrap.appendChild(ruleNumber(target.value ?? 0, -20, 20, v => {
      target.value = v; updateRulesApply();
    }));
  } else {
    const l = document.createElement('span');
    l.className = 'rules-text';
    l.textContent = 'as high as possible';
    wrap.appendChild(l);
  }

  wrap.appendChild(itemToggle({ hard: 'Enforce', soft: 'Try' }, target.mode || 'hard',
    v => { target.mode = v; renderItemRules(); updateRulesApply(); }));
  return wrap;
}

// Sprite strip over a named roster. 'single' fills one value in (Grimoires — the
// bracket is fixed and known); 'multi' toggles membership (Planets / Companions).
function entityPicker(roster, target, mode) {
  const strip = document.createElement('div');
  strip.className = 'item-entities';
  for (const ent of (ITEMS_DATA[roster] || [])) {
    const on = mode === 'multi'
      ? (target.entities || []).includes(ent.name)
      : target.value === ent.value;
    const b = document.createElement('button');
    b.className = 'item-ent-btn' + (on ? ' on' : '');
    b.title = `${ent.name} — needs ${ent.value}`;
    const img = document.createElement('img');
    img.src = `itemSprites/${encodeURIComponent(ent.name)}.png`;
    img.alt = '';
    img.onerror = function () { this.style.display = 'none'; };
    b.appendChild(img);
    b.addEventListener('click', () => {
      if (mode === 'multi') {
        target.entities ||= [];
        const i = target.entities.indexOf(ent.name);
        if (i >= 0) target.entities.splice(i, 1);
        else        target.entities.push(ent.name);
      } else {
        target.value  = ent.value;
        target.entity = ent.name;      // remembered so the grid can draw it
      }
      renderItemRules(); updateRulesApply();
    });
    strip.appendChild(b);
  }
  return strip;
}

// Two-state segmented control, same active treatment as the Rest buttons.
function itemToggle(options, value, onChange, title) {
  const wrap = document.createElement('span');
  wrap.className = 'item-toggle';
  if (title) wrap.title = title;
  for (const [k, label] of Object.entries(options)) {
    const b = document.createElement('button');
    b.className = 'item-toggle-btn' + (value === k ? ' active' : '');
    b.textContent = label;
    b.addEventListener('click', () => onChange(k));
    wrap.appendChild(b);
  }
  return wrap;
}
