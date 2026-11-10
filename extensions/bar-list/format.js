/* Format Extension dialog for Bar List (live preview; Cancel restores). */
/* global tableau, KpiFormula */
'use strict';

(function () {
  let DEFAULTS = {}; let KPI = {};
  let ctx = { measures: [] };
  let cfg = {};
  let original = null;
  let lastFormula = null;
  const form = document.getElementById('form');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opts = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');
  const NUM = new Set(['topN', 'labelSize', 'valueSize', 'titleSize']);

  const verMeta = document.querySelector('meta[name="ext-version"]');
  if (verMeta) { const h = document.querySelector('.fx-top p'); if (h) h.textContent += ` · v${verMeta.content}`; }

  async function init () {
    const payload = await tableau.extensions.initializeDialogAsync();
    try { ({ ctx = ctx, defaults: DEFAULTS = {}, kpi: KPI = {} } = JSON.parse(payload || '{}')); } catch (e) { /* empty */ }
    original = tableau.extensions.settings.get('config') || null;
    let saved = {};
    try { saved = original ? JSON.parse(original) : {}; } catch (e) { saved = {}; }
    cfg = JSON.parse(JSON.stringify({ ...DEFAULTS, ...saved }));
    cfg.measures = cfg.measures || {}; cfg.calcs = cfg.calcs || [];

    fillKpiSelect(); fillSimple(); drawKpis(); refresh();

    form.addEventListener('input', (e) => {
      const el = e.target;
      if (el.closest('#kpis')) return;
      if (el.name && el.name in DEFAULTS && !['measures', 'calcs'].includes(el.name)) {
        cfg[el.name] = el.type === 'checkbox' ? el.checked : (NUM.has(el.name) ? +el.value : el.value);
        refresh(); scheduleSave();
      }
    });
    $('kpis').addEventListener('input', onKpiInput);
    $('kpis').addEventListener('focusin', (e) => { if (e.target.classList.contains('formula')) lastFormula = e.target; });
    $('kpis').addEventListener('click', onKpiClick);
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
    $('reset').addEventListener('click', () => { cfg = JSON.parse(JSON.stringify(DEFAULTS)); fillKpiSelect(); fillSimple(); drawKpis(); refresh(); scheduleSave(); });
  }

  function allKpis () { return [...ctx.measures.map((m) => ({ id: m.key, kind: 'measure', m })), ...cfg.calcs.map((c) => ({ id: 'c:' + c.id, kind: 'calc', c }))]; }
  const kpiLabel = (k) => (k.kind === 'measure' ? ((cfg.measures[k.m.key] || {}).label || k.m.name) : (k.c.label || 'Calculated KPI'));
  function fillKpiSelect () { $('kpiSelect').innerHTML = opts([['', 'The first one'], ...allKpis().map((k) => [k.id, kpiLabel(k)])], cfg.kpi); }
  function fillSimple () {
    for (const el of form.elements) {
      if (!el.name || !(el.name in cfg) || el.closest('#kpis')) continue;
      if (el.type === 'checkbox') el.checked = !!cfg[el.name]; else el.value = cfg[el.name];
    }
  }
  function refresh () { $('bgColorField').hidden = cfg.background !== 'custom'; }

  function findMeasure (name) {
    const n = String(name).toLowerCase().trim();
    return ctx.measures.find((m) => m.key.toLowerCase() === n) || ctx.measures.find((m) => m.name.toLowerCase() === n) ||
      ctx.measures.find((m) => ((cfg.measures[m.key] || {}).label || '').toLowerCase() === n) || null;
  }
  function formulaStatus (f) {
    const c = KpiFormula.compile(f);
    if (c.error) return { ok: false, text: c.error };
    const miss = c.refs.filter((r) => !findMeasure(r));
    if (miss.length) return { ok: false, text: `Unknown field ${miss.map((r) => `[${r}]`).join(', ')}. Click a field below to insert it.` };
    return { ok: true, text: '✓ Uses ' + c.refs.map((r) => findMeasure(r).name).join(', ') + ' (summed per bar first)' };
  }

  function drawKpis () {
    const box = $('kpis');
    const list = allKpis();
    if (!list.length) { box.innerHTML = '<p class="fx-hint">Drag a Category and one or more measures onto the Marks card first.</p>'; return; }
    const chips = `<div class="chips">${ctx.measures.map((m) => `<button type="button" data-insert="${esc(m.name)}">[${esc(m.name)}]</button>`).join('')}</div>`;
    box.innerHTML = list.map((k) => {
      const c = { ...KPI, ...(k.kind === 'measure' ? (cfg.measures[k.m.key] || {}) : k.c) };
      const isCalc = k.kind === 'calc';
      const st = isCalc ? formulaStatus(c.formula) : null;
      return `<div class="kcard" data-id="${esc(k.id)}">
        <div class="kcard-head">
          <span class="nm" title="${esc(isCalc ? c.formula : k.m.key)}">${esc(kpiLabel(k))}</span>
          <span class="tag${isCalc ? ' calc' : ''}">${isCalc ? 'Calculated' : 'Measure'}</span>
          ${isCalc ? '<button type="button" class="x" data-remove title="Remove">×</button>' : ''}
        </div>
        <div class="row">
          <label class="fx-field">Name<input type="text" data-f="label" value="${esc(c.label)}" placeholder="${esc(isCalc ? 'e.g. Avg Loan' : k.m.name)}"></label>
          <label class="fx-field">% of total<select data-f="pctOfTotal">${opts([['auto', isCalc ? 'Automatic (off for ratios)' : 'Automatic'], ['yes', 'Show'], ['no', 'Hide']], c.pctOfTotal)}</select></label>
        </div>
        ${isCalc ? `<div class="row"><label class="fx-field wide">Formula<input type="text" class="formula" data-f="formula" value="${esc(c.formula)}" placeholder="[Loan Amount] / [Customers]"></label></div>
          <div class="fstat ${st.ok ? 'ok' : 'err'}">${esc(st.text)}</div>${chips}` : (/^(CNTD|COUNTD)\(/i.test(k.m.key) && ctx.hasBreakdown ? '<p class="fx-hint warn">With a Breakdown, distinct counts are added up per segment, so a customer in two segments counts twice.</p>' : '')}
        <div class="row">
          <label class="fx-field">Format<select data-f="format">${opts([['auto', isCalc ? 'Automatic' : 'As in Tableau'], ['number', '1,234,567'], ['compact', 'Short (K / M / B)'], ['k', 'Thousands (K)'], ['m', 'Millions (M)'], ['mn', 'Millions (Mn)'], ['b', 'Billions (B)'], ['percent', 'Percent (0.25 → 25%)']], c.format)}</select></label>
          <label class="fx-field">Decimals<select data-f="decimals">${opts([['auto', 'Auto'], ['0', '0'], ['1', '1'], ['2', '2'], ['3', '3']], c.decimals)}</select></label>
          <label class="fx-field">Prefix<input type="text" data-f="prefix" value="${esc(c.prefix)}" placeholder="e.g. SAR "></label>
          <label class="fx-field">Suffix<input type="text" data-f="suffix" value="${esc(c.suffix)}"></label>
        </div>
      </div>`;
    }).join('');
  }
  function kpiById (id) { return allKpis().find((k) => k.id === id); }
  function store (k) { if (k.kind === 'measure') return (cfg.measures[k.m.key] = cfg.measures[k.m.key] || {}); return k.c; }
  function onKpiInput (e) {
    const el = e.target; const box = el.closest('[data-id]');
    if (!box || !el.dataset.f) return;
    const k = kpiById(box.dataset.id); if (!k) return;
    store(k)[el.dataset.f] = el.value;
    if (el.dataset.f === 'formula') { const st = formulaStatus(el.value); const s = box.querySelector('.fstat'); if (s) { s.className = 'fstat ' + (st.ok ? 'ok' : 'err'); s.textContent = st.text; } }
    if (el.dataset.f === 'label') { box.querySelector('.nm').textContent = kpiLabel(k); fillKpiSelect(); }
    scheduleSave();
  }
  function onKpiClick (e) {
    const box = e.target.closest('[data-id]'); if (!box) return;
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
    if (e.target.closest('[data-remove]')) {
      const id = box.dataset.id;
      cfg.calcs = cfg.calcs.filter((c) => 'c:' + c.id !== id);
      if (cfg.kpi === id) cfg.kpi = '';
      drawKpis(); fillKpiSelect(); scheduleSave();
    }
  }
  function addCalc () {
    const id = 'k' + Date.now().toString(36);
    const n = ctx.measures.map((m) => m.name);
    cfg.calcs.push({ id, label: '', formula: n.length > 1 ? `[${n[1]}] / [${n[0]}]` : '', format: 'auto' });
    drawKpis(); fillKpiSelect(); scheduleSave();
    const el = $('kpis').querySelector(`[data-id="c:${id}"] input[data-f="label"]`);
    if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); }
  }

  let timer = null;
  function scheduleSave () { clearTimeout(timer); timer = setTimeout(save, 350); }
  async function save () {
    clearTimeout(timer);
    try { tableau.extensions.settings.set('config', JSON.stringify(cfg)); await tableau.extensions.settings.saveAsync(); } catch (e) { console.warn('Could not save settings', e); }
  }

  init().catch((e) => { document.body.innerHTML = '<p style="padding:20px">Could not open the format dialog: ' + esc(e.message || e) + '</p>'; });
})();
