/* Format Extension dialog for Smooth Trend.
 * Opened by smooth-trend.js via tableau.extensions.ui.displayDialogAsync.
 * Every change is saved to the workbook settings right away (live preview on the sheet);
 * Cancel restores the settings that were there when the dialog opened.
 */
/* global tableau */
'use strict';

(function () {
  let DEFAULTS = {};
  let ctx = {};
  let cfg = {};
  let original = null;
  const form = document.getElementById('form');
  const $ = (id) => document.getElementById(id);
  const field = (name) => form.elements[name];

  // show the version in the dialog header (stamped by tools/build.py)
  const verMeta = document.querySelector('meta[name="ext-version"]');
  if (verMeta) { const h = document.querySelector('.fx-top p'); if (h) h.textContent += ` · v${verMeta.content}`; }

  async function init () {
    const payload = await tableau.extensions.initializeDialogAsync();
    try { ({ ctx = {}, defaults: DEFAULTS = {} } = JSON.parse(payload || '{}')); } catch (e) { /* empty payload */ }
    original = tableau.extensions.settings.get('config') || null;
    let saved = {};
    try { saved = original ? JSON.parse(original) : {}; } catch (e) { saved = {}; }
    if (saved.compareMode && !saved.kpiCompare) saved.kpiCompare = saved.compareMode;
    if (saved.showMinMax === false && !saved.valueLabels) saved.valueLabels = 'none';
    if (saved.yZero !== undefined && !saved.yAxis) saved.yAxis = saved.yZero ? 'auto' : 'fit';
    cfg = { ...DEFAULTS, ...saved };

    cfg.refLines = Array.isArray(cfg.refLines) ? cfg.refLines.map((r) => ({ ...r })) : [];
    cfg.seriesStyles = JSON.parse(JSON.stringify(cfg.seriesStyles || {}));
    setupSeries();
    fill();
    drawRefs();
    drawSeries();
    refreshUi();

    form.addEventListener('input', () => { read(); refreshUi(); scheduleSave(); });
    form.addEventListener('submit', (e) => e.preventDefault());
    $('ok').addEventListener('click', async () => { read(); await save(); tableau.extensions.ui.closeDialog('ok'); });
    $('cancel').addEventListener('click', async () => {
      if (original === null) tableau.extensions.settings.erase('config');
      else tableau.extensions.settings.set('config', original);
      try { await tableau.extensions.settings.saveAsync(); } catch (e) { /* ignore */ }
      tableau.extensions.ui.closeDialog('cancel');
    });
    $('reset').addEventListener('click', () => { cfg = { ...DEFAULTS, refLines: [], seriesStyles: {} }; fill(); drawRefs(); drawSeries(); refreshUi(); scheduleSave(); });
    $('addRef').addEventListener('click', () => {
      const hasMeasure = (ctx.measures || []).length;
      cfg.refLines.push({ source: hasMeasure ? 'measure' : 'calc', calc: 'avg', field: hasMeasure ? ctx.measures[0].key : '', param: (ctx.params || [])[0] || '', value: '', label: '', labelPos: 'right', color: '#52514e', style: 'dashed', width: '1.5' });
      drawRefs(); scheduleSave();
    });
    $('refs').addEventListener('input', (e) => {
      const el = e.target; const card = el.closest('[data-i]');
      if (!card || !el.dataset.f) return;
      cfg.refLines[+card.dataset.i][el.dataset.f] = el.value;
      if (el.dataset.f === 'source') drawRefs();
    });
    $('refs').addEventListener('click', (e) => {
      const d = e.target.closest('[data-del]');
      if (!d) return;
      cfg.refLines.splice(+d.dataset.del, 1); drawRefs(); scheduleSave();
    });
  }

  // ------------------------------------------------------------ lines by group (Series shelf)
  function setupSeries () {
    const list = ctx.series || [];
    $('seriesSection').hidden = !list.length;
    if (!list.length) return;
    $('kpiSeries').innerHTML = `<option value="">Total of all groups</option>` + list.map((x) => `<option value="${esc(x.name)}">${esc(x.name)}</option>`).join('');
    $('seriesCards').addEventListener('input', (e) => {
      const el = e.target; const card = el.closest('[data-n]');
      if (!card || !el.dataset.f) return;
      const n = card.dataset.n;
      const st = cfg.seriesStyles[n] = { ...(cfg.seriesStyles[n] || {}) };
      st[el.dataset.f] = el.type === 'checkbox' ? el.checked : (el.dataset.f === 'width' ? +el.value : el.value);
      if (el.dataset.f === 'hidden') card.classList.toggle('off', el.checked);
    });
  }
  function drawSeries () {
    const list = ctx.series || [];
    if (!list.length) return;
    $('seriesCards').innerHTML = list.map((x) => {
      const st = { style: 'solid', width: 0, area: false, hidden: false, color: x.color, ...(cfg.seriesStyles[x.name] || {}) };
      return `<div class="ref${st.hidden ? ' off' : ''}" data-n="${esc(x.name)}">
        <div class="row">
          <label class="fx-color"><input type="color" data-f="color" value="${esc(st.color)}"> <b>${esc(x.name)}</b></label>
          <label class="fx-check" style="margin-left:auto"><input type="checkbox" data-f="hidden" ${st.hidden ? 'checked' : ''}> Hide</label>
        </div>
        <div class="row">
          <label class="fx-field">Line style<select data-f="style">${opts([['solid', 'Solid ———'], ['dashed', 'Dashed – – –'], ['dotted', 'Dotted · · ·']], st.style)}</select></label>
          <label class="fx-field">Width<select data-f="width">${opts([['0', 'Same as line'], ['1', '1'], ['1.5', '1.5'], ['2', '2'], ['2.5', '2.5'], ['3', '3'], ['4', '4']], st.width)}</select></label>
          <label class="fx-check"><input type="checkbox" data-f="area" ${st.area ? 'checked' : ''}> Area</label>
        </div>
      </div>`;
    }).join('');
  }

  // ------------------------------------------------------------ reference lines
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opts = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');
  function drawRefs () {
    const box = $('refs');
    if (!cfg.refLines.length) { box.innerHTML = '<p class="fx-hint">No reference lines yet.</p>'; return; }
    const measures = ctx.measures || []; const prms = ctx.params || [];
    box.innerHTML = cfg.refLines.map((r, i) => {
      let what = '';
      if (r.source === 'fixed') what = `<label class="fx-field">Value<input type="text" data-f="value" value="${esc(r.value)}" placeholder="e.g. 1500000, 1.5M, 25%"></label>`;
      else if (r.source === 'calc') what = `<label class="fx-field">Calculation<select data-f="calc">${opts([['avg', 'Average'], ['median', 'Median'], ['min', 'Minimum'], ['max', 'Maximum'], ['first', 'First period'], ['last', 'Latest period']], r.calc)}</select></label>`;
      else if (r.source === 'measure') what = measures.length
        ? `<label class="fx-field">Measure<select data-f="field">${opts(measures.map((m) => [m.key, m.name]), r.field)}</select></label>`
        : '<p class="fx-hint" style="flex-basis:100%">Drag a measure (e.g. Target, or a calculation like WINDOW_AVG) onto <b>Detail</b> on the Marks card, then reopen this window.</p>';
      else what = prms.length
        ? `<label class="fx-field">Parameter<select data-f="param">${opts(prms.map((p) => [p, p]), r.param)}</select></label>`
        : '<p class="fx-hint" style="flex-basis:100%">No number parameters found in this workbook.</p>';
      return `<div class="ref" data-i="${i}">
        <div class="row">
          <label class="fx-field">Value from<select data-f="source">${opts([['fixed', 'Fixed number'], ['calc', 'Calculation'], ['measure', 'Measure on Detail / Tooltip'], ['param', 'Parameter']], r.source)}</select></label>
          ${what}
          <button type="button" class="x" data-del="${i}" title="Remove">×</button>
        </div>
        <div class="row">
          <label class="fx-field">Label<input type="text" data-f="label" value="${esc(r.label)}" placeholder="Automatic (e.g. Average 1.2M)"></label>
          <label class="fx-field">Label position<select data-f="labelPos">${opts([['right', 'Right'], ['left', 'Left'], ['none', 'No label']], r.labelPos)}</select></label>
        </div>
        <div class="row">
          <label class="fx-color">Color <input type="color" data-f="color" value="${esc(r.color || '#52514e')}"></label>
          <label class="fx-field">Line<select data-f="style">${opts([['dashed', 'Dashed'], ['solid', 'Solid'], ['dotted', 'Dotted']], r.style)}</select></label>
          <label class="fx-field">Width<select data-f="width">${opts([['1', '1'], ['1.5', '1.5'], ['2', '2'], ['3', '3']], r.width)}</select></label>
        </div>
        <p class="fx-hint">Use {value} in the label to place the number, e.g. "Target {value}".</p>
      </div>`;
    }).join('');
  }

  // ------------------------------------------------------------ form <-> cfg
  function fill () {
    for (const el of form.elements) {
      if (!el.name || !(el.name in cfg)) continue;
      if (el.type === 'checkbox') el.checked = !!cfg[el.name];
      else el.value = cfg[el.name];
    }
  }
  function read () {
    for (const el of form.elements) {
      if (!el.name) continue;
      cfg[el.name] = el.type === 'checkbox' ? el.checked : el.type === 'range' ? +el.value : el.value;
    }
  }

  // ------------------------------------------------------------ smart enabling + hints
  const isTime = () => ctx.xType === 'time';
  const grain = () => ctx.grain || 'period';

  function effectiveValue () {
    if (cfg.kpiValue === 'auto') return ctx.hasKpiShelf ? 'shelf' : 'latest';
    return cfg.kpiValue;
  }

  function refreshUi () {
    const vSel = field('kpiValue');
    const cSel = field('kpiCompare');

    // Which "Show" options make sense for this sheet
    for (const o of vSel.options) {
      if (['mtd', 'qtd', 'ytd'].includes(o.value)) o.disabled = !isTime();
      if (o.value === 'shelf') o.disabled = !ctx.hasKpiShelf;
    }
    if (vSel.selectedOptions[0] && vSel.selectedOptions[0].disabled) { vSel.value = 'auto'; cfg.kpiValue = 'auto'; }

    const v = effectiveValue();
    // Which comparisons make sense for the chosen value
    const allowed = {
      latest: ['previous', 'yoy', 'first', 'peak', 'none'],
      previous: ['previous', 'yoy', 'first', 'peak', 'none'],
      mtd: ['previous', 'yoy', 'none'],
      qtd: ['previous', 'yoy', 'none'],
      ytd: ['yoy', 'none'],
      total: ['yoy', 'none'],
      average: ['yoy', 'none'],
      shelf: []
    }[v] || [];
    for (const o of cSel.options) o.disabled = !allowed.includes(o.value) || (o.value === 'yoy' && !isTime());
    cSel.disabled = v === 'shelf';
    if (v !== 'shelf' && cSel.selectedOptions[0] && cSel.selectedOptions[0].disabled) {
      const first = [...cSel.options].find((o) => !o.disabled);
      cSel.value = first ? first.value : 'none';
      cfg.kpiCompare = cSel.value;
    }

    $('aggField').hidden = !['mtd', 'qtd', 'ytd'].includes(v) && cfg.dateLevel === 'auto';

    $('bgColorField').hidden = cfg.background !== 'custom';

    // Dates
    const lv = field('dateLevel');
    lv.disabled = !isTime();
    field('dateFormat').disabled = !isTime();
    $('hintDates').textContent = datesHint();
    $('hintDates').classList.toggle('warn', isTime() && cfg.dateLevel === 'auto' && ctx.rawGrain === 'day');
    $('hintValue').textContent = valueHint(v);
    const ch = compareHint(v, cfg.kpiCompare);
    $('hintCompare').textContent = ch;

    // grain warning for period-to-date
    const warn = ['mtd', 'qtd', 'ytd'].includes(v) && ((v === 'mtd' && ['month', 'quarter', 'year'].includes(grain())) || (v === 'qtd' && ['quarter', 'year'].includes(grain())));
    $('hintValue').classList.toggle('warn', !!warn);

    document.querySelectorAll('.fx-dep').forEach((el) => el.classList.toggle('off', !field(el.dataset.dep).checked));
  }

  function datesHint () {
    if (!isTime()) return 'Your Date field is not a real date, so labels come from Tableau as they are.';
    const raw = ctx.rawGrain || 'period';
    if (cfg.dateLevel === 'auto') {
      return raw === 'day'
        ? 'Your data has daily dates. If it is really monthly, set Date level to Month to roll it up (or use a continuous MONTH(Date) pill in Tableau).'
        : `Detected ${raw}ly data – labels are shown per ${raw}.`.replace('dayly', 'daily');
    }
    return `Values are combined per ${cfg.dateLevel} (see "Combine values by" above). Click a point to select all its rows in Tableau.`;
  }

  function valueHint (v) {
    const latest = ctx.latest ? ` (${ctx.latest})` : '';
    const auto = cfg.kpiValue === 'auto' ? 'Automatic → ' : '';
    switch (v) {
      case 'latest': return `${auto}value at the latest date in the data${latest}.${ctx.hasKpiShelf ? '' : ' Tip: drop your own calculation on the KPI shelf to show it here instead.'}`;
      case 'previous': return 'The period before the latest – useful when the current month is not complete yet.';
      case 'mtd': return grain() === 'day' || grain() === 'week'
        ? 'Adds up every period from the 1st of the latest month to the latest date.'
        : `Your Date is at ${grain()} level, so MTD equals the latest ${grain()}. Use a day-level date for a true MTD.`;
      case 'qtd': return ['quarter', 'year'].includes(grain())
        ? `Your Date is at ${grain()} level, so QTD equals the latest ${grain()}.`
        : 'Adds up every period from the start of the latest quarter to the latest date.';
      case 'ytd': return 'Adds up every period from 1 January of the latest year to the latest date.';
      case 'total': return 'Adds up every period shown in the chart (follows your filters).';
      case 'average': return 'Average value per period across the chart.';
      case 'shelf': return `${auto}shows ${ctx.kpiShelfNames && ctx.kpiShelfNames[0] ? ctx.kpiShelfNames[0] : 'your KPI shelf calculation'} at the latest date.`;
      default: return '';
    }
  }

  function compareHint (v, c) {
    if (v === 'shelf') {
      return ctx.kpiShelfNames && ctx.kpiShelfNames[1]
        ? `Compared with ${ctx.kpiShelfNames[1]} (2nd measure on the KPI shelf).`
        : 'Add a 2nd measure to the KPI shelf to compare against it.';
    }
    if (c === 'none') return '';
    if (c === 'yoy') return 'The same period one year earlier.';
    if (c === 'first') return 'The first period visible in the chart.';
    if (c === 'peak') return 'The highest period so far.';
    if (c === 'previous') {
      if (v === 'mtd') return 'Same days of the previous month (e.g. 1–15 Oct vs 1–15 Sep).';
      if (v === 'qtd') return 'Same days of the previous quarter.';
      return 'The period right before it.';
    }
    return '';
  }

  // ------------------------------------------------------------ save (debounced, live preview)
  let timer = null;
  function scheduleSave () { clearTimeout(timer); timer = setTimeout(save, 350); }
  async function save () {
    clearTimeout(timer);
    try {
      tableau.extensions.settings.set('config', JSON.stringify(cfg));
      await tableau.extensions.settings.saveAsync();
    } catch (e) { console.warn('Could not save settings', e); }
  }

  init().catch((e) => { document.body.innerHTML = '<p style="padding:20px">Could not open the format dialog: ' + (e.message || e) + '</p>'; });
})();
