/* Format Extension dialog for KPI Card (live preview; Cancel restores). */
/* global tableau, KpiFormula */
'use strict';

(function () {
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#eda100', '#e87ba4', '#008300', '#e34948'];
  let DEFAULTS = {}; let CARD = {};
  let ctx = { measures: [], order: [], grain: 'day' };
  let cfg = {};
  let original = null;
  let lastFormula = null; // formula box that had focus (field chips insert here)
  const form = document.getElementById('form');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opts = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');

  const verMeta = document.querySelector('meta[name="ext-version"]');
  if (verMeta) { const h = document.querySelector('.fx-top p'); if (h) h.textContent += ` · v${verMeta.content}`; }

  async function init () {
    const payload = await tableau.extensions.initializeDialogAsync();
    try { ({ ctx = ctx, defaults: DEFAULTS = {}, card: CARD = {} } = JSON.parse(payload || '{}')); } catch (e) { /* empty */ }
    original = tableau.extensions.settings.get('config') || null;
    let saved = {};
    try { saved = original ? JSON.parse(original) : {}; } catch (e) { saved = {}; }
    cfg = JSON.parse(JSON.stringify({ ...DEFAULTS, ...saved }));
    cfg.measures = cfg.measures || {}; cfg.calcs = cfg.calcs || [];
    cfg.order = ctx.order && ctx.order.length ? ctx.order.slice() : (cfg.order || []);

    fillSimple(); drawCards(); refresh();

    form.addEventListener('input', (e) => {
      const el = e.target;
      if (el.closest('#cards')) return;
      if (el.dataset.sp) {
        const set = new Set(cfg.switchPeriods || []);
        if (el.checked) set.add(el.dataset.sp); else set.delete(el.dataset.sp);
        cfg.switchPeriods = ['day', 'mtd', 'lastmonth', 'ytd', 'total'].filter((p) => set.has(p));
        scheduleSave(); return;
      }
      if (el.name && el.name in DEFAULTS && !['measures', 'calcs', 'order', 'switchPeriods'].includes(el.name)) {
        cfg[el.name] = el.type === 'checkbox' ? el.checked : (/Size$|^spark(Months|Days)$/.test(el.name) ? +el.value : el.value);
        if (/^spark(Months|Days)$/.test(el.name)) form.querySelectorAll(`[name="${el.name}"]`).forEach((x) => { x.value = el.value; });
        refresh(); scheduleSave();
      }
    });
    $('cards').addEventListener('input', onCardInput);
    $('cards').addEventListener('focusin', (e) => { if (e.target.classList.contains('formula')) lastFormula = e.target; });
    $('cards').addEventListener('click', onCardClick);
    $('addCalc').addEventListener('click', addCalc);
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('.fx-tab').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    });
    $('ok').addEventListener('click', async () => { await save(); tableau.extensions.ui.closeDialog('ok'); });
    $('cancel').addEventListener('click', async () => {
      if (original === null) tableau.extensions.settings.erase('config'); else tableau.extensions.settings.set('config', original);
      try { await tableau.extensions.settings.saveAsync(); } catch (e) { /* ignore */ }
      tableau.extensions.ui.closeDialog('cancel');
    });
    $('reset').addEventListener('click', () => {
      cfg = JSON.parse(JSON.stringify(DEFAULTS));
      cfg.order = ctx.measures.map((m) => 'm:' + m.key);
      fillSimple(); drawCards(); refresh(); scheduleSave();
    });
  }

  function fillSimple () {
    for (const el of form.elements) {
      if (el.dataset && el.dataset.sp) { el.checked = (cfg.switchPeriods || DEFAULTS.switchPeriods || []).includes(el.dataset.sp); continue; }
      if (!el.name || !(el.name in cfg) || el.closest('#cards')) continue;
      if (el.type === 'checkbox') el.checked = !!cfg[el.name]; else el.value = cfg[el.name];
    }
  }
  function refresh () {
    $('bgColorField').hidden = cfg.background !== 'custom';
    $('cardColorField').hidden = cfg.cardFill !== 'custom';
    $('sparkMonthsField').hidden = !['auto', 'months'].includes(cfg.sparkline);
    $('sparkDaysField').hidden = !['auto', 'days'].includes(cfg.sparkline);
    $('sparkRange').hidden = cfg.sparkline === 'none';
    const anyFull = cfg.chartType !== 'spark' && cfg.chartType !== 'none';
    $('fullChart').hidden = !anyFull && !Object.values(cfg.measures).concat(cfg.calcs).some((c) => c && c.chartType && !['spark', 'none'].includes(c.chartType));
    $('miniChart').hidden = cfg.chartType !== 'spark';
    $('chartMonthsField').hidden = cfg.chartRange !== 'months';
    $('chartDaysField').hidden = cfg.chartRange !== 'days';
  }

  // ---------------------------------------------------------------- cards
  function allCards () {
    const list = [
      ...ctx.measures.map((m) => ({ id: 'm:' + m.key, kind: 'measure', m })),
      ...cfg.calcs.map((c) => ({ id: 'c:' + c.id, kind: 'calc', c }))
    ];
    const pos = (id) => { const i = cfg.order.indexOf(id); return i < 0 ? 1e6 : i; };
    return list.map((x, i) => ({ ...x, n: i })).sort((a, b) => pos(a.id) - pos(b.id) || a.n - b.n);
  }
  function settingsOf (card) {
    if (card.kind === 'measure') return { ...CARD, rollup: card.m.defRollup, ...(cfg.measures[card.m.key] || {}) };
    return { ...CARD, ...card.c };
  }
  function store (card) { // object where this card's settings live
    if (card.kind === 'measure') return (cfg.measures[card.m.key] = cfg.measures[card.m.key] || {});
    return card.c;
  }
  function byId (id) { return allCards().find((x) => x.id === id); }

  function findMeasure (name) {
    const n = String(name).toLowerCase().trim();
    return ctx.measures.find((m) => m.key.toLowerCase() === n) || ctx.measures.find((m) => m.name.toLowerCase() === n) ||
      ctx.measures.find((m) => ((cfg.measures[m.key] || {}).label || '').toLowerCase() === n) || null;
  }
  function formulaStatus (formula) {
    const f = KpiFormula.compile(formula);
    if (f.error) return { ok: false, text: f.error };
    const miss = f.refs.filter((r) => !findMeasure(r));
    if (miss.length) return { ok: false, text: `Unknown field ${miss.map((r) => `[${r}]`).join(', ')}. Click a field below to insert it.` };
    return { ok: true, text: '✓ Uses ' + f.refs.map((r) => findMeasure(r).name).join(', ') + ' (each rolled up for the period first)' };
  }

  function drawCards () {
    const box = $('cards');
    const cards = allCards();
    if (!cards.length) { box.innerHTML = '<p class="fx-hint">Drag a Date and one or more measures onto the Marks card first.</p>'; return; }
    const measureOpts = ctx.measures.map((m) => [m.key, m.name]);
    const chips = `<div class="chips">${ctx.measures.map((m) => `<button type="button" data-insert="${esc(m.name)}">[${esc(m.name)}]</button>`).join('')}</div>`;
    box.innerHTML = cards.map((card, i) => {
      const c = settingsOf(card);
      const isCalc = card.kind === 'calc';
      const name = c.label || (isCalc ? 'Calculated KPI' : card.m.name);
      const st = isCalc ? formulaStatus(c.formula) : null;
      const color = c.color || PALETTE[0];
      return `<div class="kcard${c.hidden ? ' off' : ''}" data-id="${esc(card.id)}">
        <div class="kcard-head">
          <button type="button" class="mv" data-move="-1" title="Move up" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="mv" data-move="1" title="Move down" ${i === cards.length - 1 ? 'disabled' : ''}>▼</button>
          <input type="color" data-f="color" value="${esc(color)}" title="Card color">
          <span class="nm" title="${esc(isCalc ? c.formula : card.m.key)}">${esc(name)}</span>
          <span class="tag${isCalc ? ' calc' : ''}">${isCalc ? 'Calculated' : 'Measure'}</span>
          <label class="fx-check"><input type="checkbox" data-f="hidden" ${c.hidden ? 'checked' : ''}> Hide</label>
          ${isCalc ? '<button type="button" class="x" data-remove title="Remove">×</button>' : ''}
        </div>
        <div class="row">
          <label class="fx-field">Name<input type="text" data-f="label" value="${esc(c.label)}" placeholder="${esc(isCalc ? 'e.g. Avg Loan Size' : card.m.name)}"></label>
          ${isCalc ? '' : `<label class="fx-field">Combine days<select data-f="rollup">${opts([['sum', 'Sum (amounts, counts)'], ['last', 'Latest value (balances)'], ['avg', 'Average of days'], ['max', 'Highest day'], ['min', 'Lowest day']], c.rollup)}</select></label>`}
        </div>
        ${isCalc ? `<div class="row"><label class="fx-field wide">Formula<input type="text" class="formula" data-f="formula" value="${esc(c.formula)}" placeholder="[Loan Amount] / [Loans]"></label></div>
          <div class="fstat ${st.ok ? 'ok' : 'err'}">${esc(st.text)}</div>${chips}` : (/^(CNTD|COUNTD)\(/i.test(card.m.key) ? '<p class="fx-hint warn">Distinct counts can\'t be added across days (the same customer counts every day). Use "Latest value", or an MTD calculation in Tableau.</p>' : '')}
        <div class="row">
          <label class="fx-field">Big number<select data-f="period">${opts([['', 'As set in Big number tab'], ['day', 'Last day'], ['mtd', 'MTD'], ['lastmonth', 'Last month'], ['ytd', 'YTD']], c.period)}</select></label>
          <label class="fx-field">Good direction<select data-f="better">${opts([['up', 'Higher is better'], ['down', 'Lower is better'], ['none', 'Neutral (no colors)']], c.better)}</select></label>
        </div>
        <details${c.format !== 'auto' || c.prefix || c.suffix || c.decimals !== 'auto' || c.targetType !== 'none' || c.chartType || c.statusRule !== 'change' || c.statusBand ? ' open' : ''}>
          <summary>Number format, target, chart &amp; icon color</summary>
          <div class="row">
            <label class="fx-field">Format<select data-f="format">${opts([['auto', isCalc ? 'Automatic' : 'As in Tableau'], ['number', '1,234,567'], ['compact', 'Short (K / M / B)'], ['k', 'Thousands (K)'], ['m', 'Millions (M)'], ['mn', 'Millions (Mn)'], ['b', 'Billions (B)'], ['percent', 'Percent (0.25 → 25%)']], c.format)}</select></label>
            <label class="fx-field">Decimals<select data-f="decimals">${opts([['auto', 'Auto'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']], c.decimals)}</select></label>
            <label class="fx-field">Prefix<input type="text" data-f="prefix" value="${esc(c.prefix)}" placeholder="e.g. SAR "></label>
            <label class="fx-field">Suffix<input type="text" data-f="suffix" value="${esc(c.suffix)}" placeholder="e.g.  loans"></label>
          </div>
          <div class="row">
            <label class="fx-field">Target<select data-f="targetType">${opts([['none', 'None'], ['fixed', 'Fixed monthly number'], ['measure', 'A measure on the shelf'], ['formula', 'Formula']], c.targetType)}</select></label>
            ${c.targetType === 'fixed' ? `<label class="fx-field">Monthly target<input type="text" data-f="targetValue" value="${esc(c.targetValue)}" placeholder="e.g. 1200 Mn, 1.2B, 4500"></label>` : ''}
            ${c.targetType === 'measure' ? `<label class="fx-field">Target measure<select data-f="targetKey">${opts([['', 'Pick a measure…'], ...measureOpts], c.targetKey)}</select></label>` : ''}
            ${c.targetType === 'formula' ? `<label class="fx-field wide">Target formula<input type="text" class="formula" data-f="targetFormula" value="${esc(c.targetFormula)}" placeholder="[Target Amount] * 1.1"></label>` : ''}
          </div>
          ${c.targetType === 'fixed' ? '<p class="fx-hint">MTD shows progress toward the full month with a marker for where you should be today; Last day uses the monthly target ÷ days in the month; YTD uses monthly × 12.</p>' : ''}
          ${c.targetType === 'measure' ? '<p class="fx-hint">The target measure is rolled up over the same days (e.g. MTD target to date). Hide its own card if you don\'t want to see it.</p>' : ''}
          <div class="row">
            <label class="fx-field">Chart<select data-f="chartType">${opts([['', 'As set in Chart tab'], ['spark', 'Mini trend line'], ['combo', 'Bars + running total'], ['bars', 'Bars per date'], ['line', 'Line per date'], ['running', 'Running total'], ['none', 'None']], c.chartType)}</select></label>
            <label class="fx-color">Bars <input type="color" data-f="barColor" value="${esc(c.barColor || color)}"></label>
            <label class="fx-color">Line <input type="color" data-f="lineColor" value="${esc(c.lineColor || '#eda100')}"></label>
          </div>
          <div class="row">
            <label class="fx-field">Icon<select data-f="icon">${opts([['auto', 'Automatic'], ['always', 'Always'], ['hide', 'Hide']], c.icon || 'auto')}</select></label>
            <label class="fx-field">Icon color by<select data-f="statusRule">${opts([['change', 'Change vs comparison'], ['value', 'Value thresholds'], ['target', '% of target']], c.statusRule)}</select></label>
            ${c.statusRule === 'value' ? `<label class="fx-field">Green ${c.better === 'down' ? 'up to' : 'from'}<input type="text" data-f="statusGood" value="${esc(c.statusGood)}" placeholder="e.g. 1,000 · 250K · 65%"></label>
            <label class="fx-field">Yellow ${c.better === 'down' ? 'up to' : 'from'} <small>(optional)</small><input type="text" data-f="statusWarn" value="${esc(c.statusWarn)}" placeholder="empty = green / red only"></label>` : ''}
            ${c.statusRule === 'target' ? `<label class="fx-field">Green ${c.better === 'down' ? 'up to' : 'from'} (% of target)<input type="text" data-f="statusGood" value="${esc(c.statusGood)}" placeholder="100"></label>
            <label class="fx-field">Yellow ${c.better === 'down' ? 'up to' : 'from'} <small>(optional)</small><input type="text" data-f="statusWarn" value="${esc(c.statusWarn)}" placeholder="empty = green / red only"></label>` : ''}
            ${c.statusRule === 'change' ? `<label class="fx-field">Flat band ± <small>(optional)</small><input type="text" data-f="statusBand" value="${esc(c.statusBand)}" placeholder="e.g. 2 (% or pp) = yellow"></label>` : ''}
          </div>
          ${c.statusRule === 'target' && c.targetType === 'none' ? '<p class="fx-hint warn">Set a target above to use % of target.</p>' : ''}
          ${c.statusRule === 'target' && c.targetType !== 'none' ? '<p class="fx-hint">For MTD and YTD the % of target is measured against where you should be today (pace).</p>' : ''}
        </details>
      </div>`;
    }).join('');
  }

  function onCardInput (e) {
    const el = e.target; const box = el.closest('[data-id]');
    if (!box || !el.dataset.f) return;
    const card = byId(box.dataset.id);
    if (!card) return;
    const f = el.dataset.f;
    store(card)[f] = el.type === 'checkbox' ? el.checked : el.value;
    if (f === 'formula') {
      const st = formulaStatus(el.value); const s = box.querySelector('.fstat');
      if (s) { s.className = 'fstat ' + (st.ok ? 'ok' : 'err'); s.textContent = st.text; }
    }
    if (f === 'label') { const nm = box.querySelector('.nm'); if (nm) nm.textContent = el.value || (card.kind === 'calc' ? 'Calculated KPI' : card.m.name); }
    if (f === 'hidden') box.classList.toggle('off', el.checked);
    if (f === 'targetType' || f === 'statusRule' || f === 'better') { drawCards(); }
    if (f === 'chartType') refresh();
    scheduleSave();
  }

  function onCardClick (e) {
    const box = e.target.closest('[data-id]');
    if (!box) return;
    const id = box.dataset.id;
    const ins = e.target.closest('[data-insert]');
    if (ins) {
      const input = lastFormula && box.contains(lastFormula) ? lastFormula : box.querySelector('input.formula');
      if (!input) return;
      const s = input.selectionStart ?? input.value.length; const t = `[${ins.dataset.insert}]`;
      input.value = input.value.slice(0, s) + t + input.value.slice(input.selectionEnd ?? s);
      input.focus(); input.selectionStart = input.selectionEnd = s + t.length;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    const mv = e.target.closest('[data-move]');
    if (mv) {
      const ids = allCards().map((x) => x.id);
      const i = ids.indexOf(id); const j = i + +mv.dataset.move;
      if (j < 0 || j >= ids.length) return;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      cfg.order = ids; drawCards(); scheduleSave();
      return;
    }
    if (e.target.closest('[data-remove]')) {
      cfg.calcs = cfg.calcs.filter((c) => 'c:' + c.id !== id);
      cfg.order = cfg.order.filter((x) => x !== id);
      drawCards(); scheduleSave();
    }
  }

  function addCalc () {
    const id = 'k' + Date.now().toString(36);
    const names = ctx.measures.map((m) => m.name);
    cfg.calcs.push({ id, label: '', formula: names.length > 1 ? `[${names[0]}] / [${names[1]}]` : '', format: 'auto' });
    cfg.order = allCards().map((x) => x.id);
    drawCards(); scheduleSave();
    const last = $('cards').querySelector(`[data-id="c:${id}"] input[data-f="label"]`);
    if (last) { last.scrollIntoView({ block: 'center' }); last.focus(); }
  }

  let timer = null;
  function scheduleSave () { clearTimeout(timer); timer = setTimeout(save, 350); }
  async function save () {
    clearTimeout(timer);
    try { tableau.extensions.settings.set('config', JSON.stringify(cfg)); await tableau.extensions.settings.saveAsync(); } catch (e) { console.warn('Could not save settings', e); }
  }

  init().catch((e) => { document.body.innerHTML = '<p style="padding:20px">Could not open the format dialog: ' + esc(e.message || e) + '</p>'; });
})();
