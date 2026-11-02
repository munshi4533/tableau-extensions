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
    cfg = { ...DEFAULTS, ...saved };

    fill();
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
    $('reset').addEventListener('click', () => { cfg = { ...DEFAULTS }; fill(); refreshUi(); scheduleSave(); });
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
