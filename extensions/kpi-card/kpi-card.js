/* KPI Card – Tableau Viz Extension
 * A row of KPI cards from a plain date and your measures. The extension works out each period
 * (last day, MTD, last month) from the daily data, so every card is correct for any period:
 *   - each measure has a ROLL-UP rule for combining days: Sum (amounts, counts), Latest value
 *     (balances, stock), Average, Max, Min;
 *   - CALCULATED KPIs are formulas over those measures (e.g. [Loan Amount] / [Loans]); every part is
 *     rolled up for the period first, then the formula runs. So MTD Average Loan Size is
 *     sum(amount MTD) / sum(loans MTD), not an average of daily averages.
 * Encodings: date (1), measures (up to 20).
 */
/* global d3, tableau, ExtMenu, KpiFormula */
'use strict';

(function () {
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#eda100', '#e87ba4', '#008300', '#e34948'];
  const DAY = 864e5;
  const DEFAULTS = {
    period: 'mtd', // day | mtd | lastmonth | ytd | total  (default big number for all cards)
    switcher: true, // buttons so viewers can switch every card at once
    switchPeriods: ['day', 'mtd', 'lastmonth', 'ytd'], // periods offered on the buttons and as small values
    chartType: 'spark', // spark (mini trend) | combo (daily bars + running total) | bars | line | running | none
    chartRange: 'all', // all | months | days   (for combo / bars / line / running)
    runReset: 'none', // running total restarts: none | month | year
    chartAxis: true, // date labels under the chart
    chartLegend: true, // "● Running total ● Day" next to the card name
    lineCurve: 'extra', // straight | smooth | extra   (lines in charts and the mini trend)
    barRound: true, // rounded ends on bars (top and bottom)
    statusIcon: true, // round trend icon left of the big number, colored green / yellow / red
    iconStyle: 'soft', // soft (tinted circle) | solid (filled circle)
    colorNumber: false, // also color the big number
    // text style: weight 400 regular | 600 semibold | 700 bold; colors
    valueWeight: '700', valueColor: '#0b0b0b',
    labelWeight: '600', labelColor: '#52514e',
    detailWeight: '400', detailColor: '#898781',
    compare: 'auto', // auto (previous day / LMTD / previous month) | yoy | none
    title: '',
    columns: 'auto', // auto | 1..6
    sparkline: 'auto', // auto | days | months | none
    sparkMonths: 12, // how many months the month-by-month trend shows
    sparkDays: 30, // how many days the day-by-day trend shows
    sparkSize: 'fill', // fill (all space under the numbers) | large | medium | small
    secondary: true, // small values for the other periods
    showRange: true, // "1–8 Nov 2026" under the label
    progress: true, // target bar (cards with a target)
    cardStyle: 'card', // card | plain
    align: 'left', // left | center
    background: 'transparent',
    bgColor: '#ffffff',
    labelSize: 12,
    valueSize: 0, // 0 = fit to the card
    detailSize: 11,
    measures: {}, // field name -> card settings (see CARD)
    calcs: [], // [{ id, label, formula, ...card settings }]
    order: [] // card ids in display order ('m:<field>' / 'c:<id>')
  };
  // settings every card has (measures and calculated KPIs)
  const CARD = {
    label: '', hidden: false, rollup: 'sum', period: '', better: 'up',
    format: 'auto', decimals: 'auto', prefix: '', suffix: '', color: '',
    targetType: 'none', targetValue: '', targetKey: '', targetFormula: '',
    chartType: '', barColor: '', lineColor: '', // '' = as set for all cards
    statusRule: 'change', // what decides green / yellow / red: change | value | target
    icon: 'auto', // auto (hidden when there is nothing to show, e.g. Total) | always | hide
    statusGood: '', statusWarn: '', statusBand: '' // thresholds (see statusOf)
  };
  const LINE_DEFAULT = '#eda100';
  const ROLLUPS = { sum: 'Sum of days', last: 'Latest value', avg: 'Average of days', max: 'Highest day', min: 'Lowest day' };

  let cfg = { ...DEFAULTS };
  let worksheet = null;
  let model = null;
  let lastData = null; let lastEnc = null;
  let viewerPeriod = null; // set by the switcher (this session only)
  const formulaCache = new Map();
  const $ = (id) => document.getElementById(id);

  // ================================================================ init + data
  async function init () {
    try {
      await tableau.extensions.initializeAsync({ configure: openFormatDialog });
    } catch (e) {
      showEmpty('<b>Could not start the extension.</b><br>' + esc(e.message || e));
      return;
    }
    worksheet = tableau.extensions.worksheetContent.worksheet;
    loadSettings();
    worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, refresh);
    try {
      tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, () => { loadSettings(); rebuild(); render(); });
    } catch (e) { /* not available */ }
    const ro = new ResizeObserver(debounce(() => {
      const c = $('cards');
      if (model && (c.clientWidth !== drawnSize.w || c.clientHeight !== drawnSize.h)) render();
    }, 60));
    ro.observe(document.body); ro.observe($('cards'));
    document.addEventListener('visibilitychange', () => { if (!document.hidden && model && !drawnSize.w) render(); });
    ExtMenu.attach(() => { hideTooltip(); return [ExtMenu.authoring() && { label: 'Format Extension…', icon: 'format', action: openFormatDialog }]; });
    load();
  }

  // One data reader at a time; a burst of SummaryDataChanged events becomes one load.
  let loading = false; let loadAgain = false; let eventTimer = 0;
  function refresh () { clearTimeout(eventTimer); eventTimer = setTimeout(load, 40); }
  async function load () {
    if (loading) { loadAgain = true; return; }
    loading = true; loadAgain = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [data, enc] = await Promise.all([getRows(), getEncodings()]);
        lastData = data; lastEnc = enc;
        model = buildModel(data, enc);
        break;
      } catch (e) {
        console.error(e);
        if (loadAgain) break;
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 300)); continue; }
        if (!lastData) model = { error: e.message || String(e) };
      }
    }
    loading = false;
    render();
    if (loadAgain) load();
  }
  function rebuild () { if (lastData) { try { model = buildModel(lastData, lastEnc); } catch (e) { model = { error: e.message }; } } }

  async function getRows () {
    const reader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true, applyWorksheetFormatting: true });
    const rows = []; let columns = [];
    try {
      for (let p = 0; p < reader.pageCount; p++) {
        const page = await reader.getPageAsync(p);
        columns = page.columns;
        for (const d of page.data) {
          const row = {};
          for (const c of columns) row[c.fieldName] = d[c.index];
          rows.push(row);
        }
      }
    } finally { await reader.releaseAsync().catch(() => {}); }
    return { rows, columns };
  }

  async function getEncodings () {
    const spec = await worksheet.getVisualSpecificationAsync();
    const map = {};
    if (spec.activeMarksSpecificationIndex < 0) return map;
    for (const enc of spec.marksSpecifications[spec.activeMarksSpecificationIndex].encodings) (map[enc.id] = map[enc.id] || []).push(enc.field);
    return map;
  }

  // ================================================================ model
  function buildModel ({ rows, columns }, enc) {
    const dateF = enc.date && enc.date[0];
    const mFields = enc.measures || [];
    if (!dateF || !mFields.length) return { empty: true, needDate: !dateF, needMeasures: !mFields.length };
    const names = columns.map((c) => c.fieldName);
    const taken = new Set();
    const key = (f) => { const k = resolve(f.name, names.filter((n) => !taken.has(n))) || resolve(f.name, names); if (k) taken.add(k); return k; };
    const dateK = key(dateF);
    const measures = mFields.map(key).filter(Boolean).map((k, i) => ({ key: k, name: cleanName(k), index: i, byDay: new Map(), sample: null }));
    if (!dateK || !measures.length) throw new Error('Could not find the fields in the sheet data.');

    let notDates = 0;
    for (const r of rows) {
      const t = parseDate(r[dateK]);
      if (t === null) { if (r[dateK] && r[dateK].nativeValue !== null) notDates++; continue; }
      for (const m of measures) {
        const dv = r[m.key]; const y = toNumber(dv);
        if (y === null) continue;
        const prev = m.byDay.get(t);
        m.byDay.set(t, prev === undefined ? y : prev + y); // several rows per day (Detail) -> add up
        if (dv.formattedValue && (!m.sample || Math.abs(y) > Math.abs(m.sample.y))) m.sample = { text: dv.formattedValue, y };
      }
    }
    const dates = [...new Set([].concat(...measures.map((m) => [...m.byDay.keys()])))].sort((a, b) => a - b);
    if (!dates.length) return { empty: true, noData: true, notDates: notDates > 0 };
    let grain = 'day';
    if (dates.length > 1) {
      const gap = d3.median(d3.pairs(dates, (a, b) => b - a)) / DAY;
      grain = gap <= 1.5 ? 'day' : gap <= 8 ? 'week' : gap <= 32 ? 'month' : gap <= 95 ? 'quarter' : 'year';
    }
    measures.forEach((m) => {
      m.unit = m.sample ? detectUnit(m.sample.text, m.sample.y) : detectUnit(null);
      m.defRollup = defaultRollup(m);
      m.sortedDays = [...m.byDay.keys()].sort((a, b) => a - b);
    });
    return { measures, dates, grain, dateName: cleanName(dateF.name) };
  }

  // sensible first guess; always changeable in Format → Cards
  function defaultRollup (m) {
    if (/^AVG\(/i.test(m.key) || m.unit.pct) return 'avg';
    if (/balance|outstanding|portfolio|\bbook\b|\bactive\b|headcount|\bstock\b|\bbase\b/i.test(m.key)) return 'last';
    return 'sum';
  }

  // ---------------------------------------------------------------- cards
  function cardList () {
    if (!model || !model.measures) return [];
    const all = [
      ...model.measures.map((m) => ({ id: 'm:' + m.key, kind: 'measure', m })),
      ...(cfg.calcs || []).map((c) => ({ id: 'c:' + c.id, kind: 'calc', c }))
    ];
    const pos = (id) => { const i = (cfg.order || []).indexOf(id); return i < 0 ? 1e6 : i; };
    return all.map((x, i) => ({ ...x, n: i })).sort((a, b) => pos(a.id) - pos(b.id) || a.n - b.n);
  }
  function ccfg (card) {
    if (card.kind === 'measure') return { ...CARD, rollup: card.m.defRollup, ...((cfg.measures || {})[card.m.key] || {}) };
    return { ...CARD, ...card.c };
  }
  function mcfgOf (m) { return ccfg({ kind: 'measure', m }); }
  const cardName = (card, c) => c.label || (card.kind === 'measure' ? card.m.name : 'Calculated KPI');

  function findMeasure (name) {
    const n = String(name).toLowerCase().trim();
    const ms = model.measures;
    return ms.find((m) => m.key.toLowerCase() === n) || ms.find((m) => m.name.toLowerCase() === n) ||
      ms.find((m) => (mcfgOf(m).label || '').toLowerCase() === n) || null;
  }
  function compiled (formula) {
    if (!formulaCache.has(formula)) formulaCache.set(formula, KpiFormula.compile(formula));
    return formulaCache.get(formula);
  }
  function formulaProblem (formula) {
    const f = compiled(formula);
    if (f.error) return f.error;
    const miss = f.refs.filter((r) => !findMeasure(r));
    return miss.length ? `Unknown field ${miss.map((r) => `[${r}]`).join(', ')}. Use a measure on the Measures shelf.` : null;
  }

  // ---------------------------------------------------------------- periods
  const ymd = (t) => { const d = new Date(t); return [d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()]; };
  const monthStart = (y, m) => Date.UTC(y, m, 1);
  const daysIn = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  function shiftMonths (t, n) { const [y, m, d] = ymd(t); return Date.UTC(y, m + n, Math.min(d, daysIn(y, m + n))); }

  function availablePeriods () {
    if (model.grain === 'day') return ['day', 'mtd', 'lastmonth', 'ytd', 'total'];
    if (model.grain === 'month') return ['day', 'lastmonth', 'ytd', 'total'];
    return ['day', 'ytd', 'total'];
  }
  function periodLabel (p) {
    if (p === 'day') return model.grain === 'day' ? 'Last day' : model.grain === 'month' ? 'This month' : `Latest ${model.grain}`;
    return p === 'mtd' ? 'MTD' : p === 'ytd' ? 'YTD' : p === 'total' ? 'Total' : 'Last month';
  }
  function effectivePeriod (c) {
    const av = availablePeriods();
    let p = viewerPeriod || c.period || cfg.period;
    if (p === 'mtd' && !av.includes('mtd')) p = 'day';
    return av.includes(p) ? p : av[0];
  }
  function rangeOf (p) {
    const D = model.latest; const [y, m] = ymd(D);
    if (p === 'mtd') return [monthStart(y, m), D];
    if (p === 'lastmonth') return [monthStart(y, m - 1), monthStart(y, m) - 1];
    if (p === 'ytd') return [Date.UTC(y, 0, 1), D];
    if (p === 'total') return [model.dates[0], D]; // every date in the data (your Tableau filters decide the range)
    return [D, D];
  }
  // the comparison period must be fully inside the data, otherwise "+4,000% vs LYTD" from a half-covered period
  function compareOf (p, range) {
    const cmp = compareRaw(p, range);
    if (!cmp || cmp.range[0] < model.dates[0]) return null;
    return cmp;
  }
  function compareRaw (p, range) {
    if (cfg.compare === 'none' || p === 'total') return null;
    if (cfg.compare === 'yoy') return { range: [shiftMonths(range[0], -12), shiftMonths(range[1], -12)], caption: 'vs last year' };
    const D = model.latest; const [y, m, d] = ymd(D);
    if (p === 'day') {
      const i = model.dates.indexOf(D);
      if (i < 1) return null;
      const P = model.dates[i - 1];
      return { range: [P, P], caption: model.grain === 'day' ? 'vs previous day' : `vs previous ${model.grain}` };
    }
    if (p === 'mtd') return { range: [monthStart(y, m - 1), Date.UTC(y, m - 1, Math.min(d, daysIn(y, m - 1)))], caption: 'vs LMTD' };
    if (p === 'ytd') return { range: [Date.UTC(y - 1, 0, 1), shiftMonths(D, -12)], caption: 'vs LYTD' }; // same days last year
    return { range: [monthStart(y, m - 2), monthStart(y, m - 1) - 1], caption: 'vs previous month' };
  }
  function fmtRange ([a, b]) {
    const f = d3.utcFormat;
    if (model.grain !== 'day') return model.grain === 'month' ? f('%b %Y')(new Date(a)) : f('%-d %b %Y')(new Date(a));
    if (a === b) return f('%-d %b %Y')(new Date(a));
    const [ya, ma, da] = ymd(a); const [yb, mb, db] = ymd(b);
    if (da === 1 && ya === yb && ma === mb && db === daysIn(yb, mb)) return f('%b %Y')(new Date(a));
    if (ya === yb && ma === mb) return `${da}–${db} ${f('%b %Y')(new Date(b))}`;
    return `${f('%-d %b')(new Date(a))} – ${f('%-d %b %Y')(new Date(b))}`;
  }

  // ---------------------------------------------------------------- values
  function rollup (m, [a, b], how) {
    const days = m.sortedDays;
    let lo = d3.bisectLeft(days, a); const hi = d3.bisectRight(days, b);
    if (lo >= hi) return null;
    if (how === 'last') return m.byDay.get(days[hi - 1]);
    let s = 0; let mx = -Infinity; let mn = Infinity; const n = hi - lo;
    for (; lo < hi; lo++) { const v = m.byDay.get(days[lo]); s += v; if (v > mx) mx = v; if (v < mn) mn = v; }
    return how === 'avg' ? s / n : how === 'max' ? mx : how === 'min' ? mn : s;
  }
  function daysWithData (range) { return model.dates.filter((t) => t >= range[0] && t <= range[1]).length; }
  function evalFormula (formula, range) {
    if (formulaProblem(formula)) return null;
    return compiled(formula).run((name) => { const m = findMeasure(name); return m ? rollup(m, range, mcfgOf(m).rollup) : null; }, { days: daysWithData(range) });
  }
  function valueOf (card, c, range) {
    if (card.kind === 'measure') return rollup(card.m, range, c.rollup);
    return evalFormula(c.formula, range);
  }
  function partsOf (card, c, range) { // for the tooltip of calculated KPIs
    if (card.kind !== 'calc' || formulaProblem(c.formula)) return [];
    return compiled(c.formula).refs.map((r) => { const m = findMeasure(r); return { name: mcfgOf(m).label || m.name, how: mcfgOf(m).rollup, v: rollup(m, range, mcfgOf(m).rollup), unit: m.unit }; });
  }
  function unitOf (card) {
    if (card.kind === 'measure') return card.m.unit;
    const f = compiled(card.c.formula || '');
    const first = f.refs && f.refs.length ? findMeasure(f.refs[0]) : null; // a ratio keeps the currency of its first field
    return first ? { prefix: first.unit.pct ? '' : first.unit.prefix, suffix: '', pct: false, scale: 1, decimals: 0, calc: true } : null;
  }

  function targetOf (card, c, p, range, v, force) {
    if ((!cfg.progress && !force) || c.targetType === 'none' || v === null) return null;
    let T = null; let pace = null; let caption = 'target';
    if (c.targetType === 'fixed') {
      if (p === 'total') return null; // a monthly target has no meaning for "all dates"
      const monthly = parseAmount(c.targetValue);
      if (monthly === null) return null;
      const [y, m, d] = ymd(model.latest);
      // amounts that build up over the month (Sum) are paced; balances, averages and ratios are compared as they are
      const builds = card.kind === 'measure' && c.rollup === 'sum';
      if (builds && p === 'day' && model.grain === 'day') { T = monthly / daysIn(y, m); caption = 'Daily target (monthly ÷ days)'; } else if (builds && p === 'ytd') { T = monthly * 12; caption = 'Annual target (monthly × 12)'; } else { T = monthly; caption = builds ? 'Monthly target' : 'Target'; }
      if (builds && p === 'mtd') pace = d / daysIn(y, m);
      if (builds && p === 'ytd') { const doy = (model.latest - Date.UTC(y, 0, 1)) / DAY + 1; pace = doy / (Date.UTC(y + 1, 0, 1) - Date.UTC(y, 0, 1)) * DAY; }
    } else if (c.targetType === 'measure') {
      const m = model.measures.find((x) => x.key === c.targetKey);
      if (!m) return null;
      T = rollup(m, range, mcfgOf(m).rollup); caption = (mcfgOf(m).label || m.name);
    } else if (c.targetType === 'formula') {
      T = evalFormula(c.targetFormula, range); caption = 'Target';
    }
    if (T === null || T === 0) return null;
    return { T, pct: v / T, pace, caption };
  }

  function sparkPoints (card, c, p) {
    let mode = cfg.sparkline;
    if (mode === 'none') return null;
    if (mode === 'auto') mode = model.grain !== 'day' ? 'days' : (p === 'day' || model.latest - model.dates[0] < 75 * DAY) ? 'days' : 'months';
    const pts = [];
    if (mode === 'days' || model.grain !== 'day') {
      const n = Math.max(2, model.grain === 'day' ? +cfg.sparkDays || 30 : (+cfg.sparkMonths || 12) + 1);
      const ds = model.dates.filter((t) => t <= model.latest).slice(-n);
      for (const t of ds) pts.push({ t, v: valueOf(card, c, [t, t]), label: fmtRange([t, t]) });
    } else {
      // month by month, like for like: MTD -> the same days of every month (1st–8th), Last month -> full months
      const [y, m, d] = ymd(model.latest);
      if (p === 'ytd' && m > 0) { // YTD: how the year built up, month by month (Jan, Jan–Feb, … Jan–today)
        for (let i = 0; i <= m; i++) {
          const b = i === m ? model.latest : monthStart(y, i + 1) - 1;
          pts.push({ t: monthStart(y, i), v: valueOf(card, c, [Date.UTC(y, 0, 1), b]), label: `YTD to ${fmtRange([b, b])}` });
        }
        const okY = pts.filter((q) => q.v !== null);
        return okY.length > 1 ? { pts: okY, mode: 'ytd' } : null;
      }
      const last = p === 'lastmonth' ? 1 : 0;
      const nm = Math.max(2, +cfg.sparkMonths || 12);
      for (let i = nm - 1 + last; i >= last; i--) {
        const a = monthStart(y, m - i);
        const b = p === 'mtd' ? Date.UTC(y, m - i, Math.min(d, daysIn(y, m - i))) : monthStart(y, m - i + 1) - 1;
        if (b < model.dates[0]) continue;
        pts.push({ t: a, v: valueOf(card, c, [a, b]), label: fmtRange([a, b]) });
      }
    }
    const ok = pts.filter((q) => q.v !== null);
    return ok.length > 1 ? { pts: ok, mode } : null;
  }

  // ================================================================ render
  let drawnSize = { w: 0, h: 0 };
  function render () {
    try {
      renderInner();
      const c = $('cards');
      drawnSize = c.children.length ? { w: c.clientWidth, h: c.clientHeight } : { w: 0, h: 0 };
    } catch (e) {
      console.error(e);
      $('cards').innerHTML = ''; $('header').hidden = true;
      showEmpty('<b>Could not draw the cards.</b><br>' + esc(e.message || String(e)));
    }
  }

  function renderInner () {
    hideTooltip();
    applyStyle();
    const box = $('cards');
    box.innerHTML = '';
    if (!model) return;
    if (model.error) { $('header').hidden = true; return showEmpty('<b>Something went wrong.</b><br>' + esc(model.error)); }
    if (model.empty) {
      $('header').hidden = true;
      if (model.noData) return showEmpty(model.notDates ? '<b>Date needs a real date.</b><br>Use DAY(your date) or an exact date on <b>Date</b>.' : '<b>No data.</b> Check the filters.');
      return showEmpty(`Drag ${[model.needDate && 'a <b>Date</b> (DAY level)', model.needMeasures && 'one or more <b>Measures</b>'].filter(Boolean).join(' and ')} onto the Marks card.<br><span style="color:var(--ink-3)">Then add calculated KPIs and choose MTD / last month / last day in Format Extension.</span>`);
    }

    const cards = cardList().filter((cd) => !ccfg(cd).hidden);
    // latest date = last day any shown card has data (a target table may run into the future)
    const used = new Set();
    cards.forEach((cd) => {
      if (cd.kind === 'measure') used.add(cd.m);
      else if (!formulaProblem(cd.c.formula)) compiled(cd.c.formula).refs.forEach((r) => used.add(findMeasure(r)));
    });
    const src = used.size ? [...used] : model.measures;
    model.latest = d3.max(src, (m) => m.sortedDays[m.sortedDays.length - 1]);
    if (model.latest === undefined) model.latest = model.dates[model.dates.length - 1];

    renderHeader();
    if (!cards.length) return showEmpty('All cards are hidden.<br><span style="color:var(--ink-3)">Show them again in Format Extension → Cards.</span>');
    $('empty').hidden = true;

    // grid: as many columns as fit, rows share the height
    const W = box.clientWidth || 600;
    const cols = cfg.columns === 'auto' ? Math.max(1, Math.min(cards.length, Math.floor(W / 190))) : Math.min(+cfg.columns, cards.length);
    const rows = Math.ceil(cards.length / cols);
    box.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    box.style.gridTemplateRows = `repeat(${rows}, minmax(0, 1fr))`;

    const built = cards.map((cd, i) => buildCard(cd, i));
    built.forEach((b) => box.appendChild(b.el));
    fitValues(built);
    built.forEach((b) => { if (b.spark) drawSpark(b); if (b.chart) drawChart(b); });
  }

  // periods offered on the viewer buttons and as small values (always including the default one)
  function offeredPeriods () {
    const av = availablePeriods();
    const want = new Set(Array.isArray(cfg.switchPeriods) && cfg.switchPeriods.length ? cfg.switchPeriods : DEFAULTS.switchPeriods);
    want.add(cfg.period === 'mtd' && !av.includes('mtd') ? 'day' : cfg.period);
    return av.filter((p) => want.has(p));
  }
  function renderHeader () {
    const av = offeredPeriods();
    const showSwitch = cfg.switcher && av.length > 1;
    const sw = $('switcher');
    sw.hidden = !showSwitch;
    if (showSwitch) {
      const cur = viewerPeriod || (av.includes(cfg.period) ? cfg.period : av[0]);
      sw.innerHTML = av.map((p) => `<button type="button" role="tab" data-p="${p}" class="${p === cur ? 'on' : ''}" aria-selected="${p === cur}">${esc(periodLabel(p))}</button>`).join('');
      sw.onclick = (e) => { const b = e.target.closest('[data-p]'); if (!b) return; viewerPeriod = b.dataset.p; render(); };
    }
    $('title').textContent = cfg.title || '';
    $('header').hidden = !showSwitch && !cfg.title;
  }

  function buildCard (card, i) {
    const c = ccfg(card);
    const p = effectivePeriod(c);
    const range = rangeOf(p);
    const unit = unitOf(card);
    const color = c.color || PALETTE[0];
    const el = document.createElement('div');
    el.className = 'kc-card' + (cfg.cardStyle === 'plain' ? ' plain' : '') + (cfg.align === 'center' ? ' center' : '');
    el.style.setProperty('--accent', color);
    const name = cardName(card, c);

    if (card.kind === 'calc' && formulaProblem(c.formula)) {
      el.innerHTML = `<div class="kc-label"><span class="kc-name">${esc(name)}</span></div><div class="kc-error">${esc(formulaProblem(c.formula))}</div>`;
      return { el };
    }

    const v = valueOf(card, c, range);
    const cmp = compareOf(p, range);
    const b = cmp ? valueOf(card, c, cmp.range) : null;
    const tgt = targetOf(card, c, p, range, v);
    const fmt = (x) => fmtCard(x, c, unit);

    let delta = '';
    let dinfo = null;
    if (v !== null && b !== null) {
      dinfo = change(v, b, c, unit);
      delta = `<div class="kc-delta ${dinfo.tone}"><b>${dinfo.arrow} ${esc(dinfo.text)}</b> <span>${esc(cmp.caption)}</span></div>`;
    }
    const st = statusOf(c, v, dinfo, targetOf(card, c, p, range, v, true), unit);
    // auto: no icon when there is neither a direction nor a status (e.g. Total has no comparison)
    const iconMode = c.icon || 'auto';
    const showIcon = cfg.statusIcon && v !== null && iconMode !== 'hide' && (iconMode === 'always' || dinfo || st !== 'neutral');
    const icon = showIcon ? statusIcon(st, dinfo ? dinfo.dir : null) : '';
    const others = cfg.secondary ? offeredPeriods().filter((q) => q !== p) : [];
    const sec = others.length ? `<div class="kc-sec">${others.map((q) => `<span>${esc(periodLabel(q))} <b>${esc(fmt(valueOf(card, c, rangeOf(q))))}</b></span>`).join('')}</div>` : '';
    let prog = '';
    if (tgt) {
      const w = Math.max(0, Math.min(100, tgt.pct * 100));
      const good = c.better === 'down' ? tgt.pct <= (tgt.pace || 1) : tgt.pct >= (tgt.pace || 1);
      prog = `<div class="kc-prog"><div class="kc-bar"><i class="${c.better === 'none' ? '' : good ? 'good' : 'bad'}" style="width:${w}%"></i>${tgt.pace ? `<b style="left:${tgt.pace * 100}%" title="Where MTD should be today"></b>` : ''}</div>` +
        `<span>${Math.round(tgt.pct * 100)}% of ${esc(fmt(tgt.T))}</span></div>`;
    }
    const ct = chartTypeOf(c);
    const cols = chartColors(c, ct, color);
    const legend = cfg.chartLegend && ct === 'combo'
      ? `<div class="kc-legend"><span><i style="background:${cols.line}"></i>${esc(runName())}</span><span><i style="background:${cols.bar}"></i>${esc(dayName())}</span></div>` : '';
    el.innerHTML =
      `<div class="kc-head"><div class="kc-label"><span class="kc-name">${esc(name)}</span>${cfg.showRange ? `<span class="kc-range">${esc(periodLabel(p))} · ${esc(fmtRange(range))}</span>` : ''}</div>${legend}</div>` +
      `<div class="kc-value${cfg.colorNumber && st !== 'neutral' ? ' s-' + st : ''}">${icon}<span>${esc(fmt(v))}</span></div>${delta}${sec}${prog}${ct === 'spark' ? '<div class="kc-spark"></div>' : ct === 'none' ? '' : '<div class="kc-chart"></div>'}`;

    // hover: what's behind the number
    el.addEventListener('mousemove', (e) => {
      if (e.target.closest('.kc-spark svg, .kc-chart svg')) return;
      const rows = [[`${periodLabel(p)} · ${fmtRange(range)}`, fmt(v), true]];
      if (cmp) { const k = cmp.caption.replace(/^vs /, ''); rows.push([`${k.charAt(0).toUpperCase() + k.slice(1)} · ${fmtRange(cmp.range)}`, fmt(b)]); }
      if (dinfo) rows.push(['Change', `${dinfo.text}${dinfo.abs ? ` (${dinfo.abs})` : ''}`]);
      const parts = partsOf(card, c, range);
      let html = `<div class="kc-tt-head">${esc(name)}</div>` + rows.map(([k, val, strong]) => `<div class="kc-tt-row"><span>${esc(k)}</span><b class="${strong ? 'big' : ''}">${esc(val)}</b></div>`).join('');
      if (parts.length) html += `<div class="kc-tt-sub">= ${esc(c.formula)}</div>` + parts.map((q) => `<div class="kc-tt-row"><span>${esc(q.name)} <i>${esc(ROLLUPS[q.how].toLowerCase())}</i></span><b>${esc(fmtCard(q.v, { ...CARD }, q.unit))}</b></div>`).join('');
      else if (card.kind === 'measure' && (p !== 'day' || model.grain !== 'day')) html += `<div class="kc-tt-sub">Days combined: ${esc(ROLLUPS[c.rollup].toLowerCase())}</div>`;
      if (tgt) html += `<div class="kc-tt-row"><span>${esc(tgt.caption)}</span><b>${esc(fmt(tgt.T))} · ${Math.round(tgt.pct * 100)}%</b></div>` + (tgt.pace ? `<div class="kc-tt-row"><span>Month elapsed</span><b>${Math.round(tgt.pace * 100)}%</b></div>` : '');
      showTooltip(html, e);
    });
    el.addEventListener('mouseleave', hideTooltip);
    return { el, spark: ct === 'spark' ? sparkPoints(card, c, p) : null, chart: ct !== 'spark' && ct !== 'none' ? chartData(card, c) : null, ct, cols, card, c, unit, color, i };
  }

  // ---------------------------------------------------------------- chart (bars per date + running total)
  function chartTypeOf (c) {
    const t = c.chartType || cfg.chartType || 'spark';
    return t === 'spark' && cfg.sparkline === 'none' ? 'none' : t;
  }
  function chartColors (c, ct, color) {
    return { bar: c.barColor || color, line: c.lineColor || (ct === 'combo' ? LINE_DEFAULT : color) };
  }
  const curveOf = () => (cfg.lineCurve === 'straight' ? d3.curveLinear : cfg.lineCurve === 'extra' ? d3.curveBasis : d3.curveMonotoneX);
  const runName = () => (cfg.runReset === 'month' ? 'Month to date' : cfg.runReset === 'year' ? 'Year to date' : 'Cumulative');
  const dayName = () => (model.grain === 'day' ? 'Day' : model.grain === 'month' ? 'Month' : 'Period');

  // one point per date: the value of that date and the running total up to it
  function chartData (card, c) {
    let ds = model.dates.filter((t) => t <= model.latest);
    if (cfg.chartRange === 'months') {
      const [y, m] = ymd(model.latest);
      const from = monthStart(y, m - Math.max(1, +cfg.sparkMonths || 12) + 1);
      ds = ds.filter((t) => t >= from);
    } else if (cfg.chartRange === 'days') ds = ds.slice(-Math.max(2, +cfg.sparkDays || 30));
    if (!ds.length) return null;
    const reset = (t) => { const [y, m] = ymd(t); return cfg.runReset === 'month' ? monthStart(y, m) : cfg.runReset === 'year' ? Date.UTC(y, 0, 1) : ds[0]; };
    // amounts and counts add up; ratios, balances and averages are recalculated "to date" (e.g. approval rate so far)
    const additive = card.kind === 'measure' && c.rollup === 'sum';
    let run = 0; let start = null;
    const pts = ds.map((t) => {
      const day = valueOf(card, c, [t, t]);
      let cum;
      if (additive) {
        const r = reset(t);
        if (r !== start) { run = 0; start = r; }
        run += day || 0; cum = run;
      } else cum = valueOf(card, c, [Math.max(reset(t), ds[0]), t]);
      return { t, day, cum };
    });
    pts.additive = additive;
    return pts.some((q) => q.day !== null) ? pts : null;
  }

  function drawChart (b) {
    const host = b.el.querySelector('.kc-chart');
    if (!host) return;
    const W = host.clientWidth; const H = host.clientHeight;
    if (W < 60 || H < 30) return;
    const pts = b.chart; const n = pts.length;
    const showAxis = cfg.chartAxis && H >= 80;
    const fmtTick = d3.utcFormat(model.grain === 'day' ? '%d-%b' : model.grain === 'month' ? "%b '%y" : '%d-%b');
    const fs = Math.max(8, (+cfg.detailSize || 11) - 1);
    const m = { top: 4, right: 2, bottom: showAxis ? Math.round(fs * 0.62 * 6.2) + 6 : 2, left: 2 };
    const iw = W - m.left - m.right; const ih = H - m.top - m.bottom;
    if (ih < 16) return;
    const ct = b.ct;
    const hasBars = ct === 'combo' || ct === 'bars';
    const hasDayLine = ct === 'line';
    const hasRun = ct === 'combo' || ct === 'running';
    const x = d3.scaleBand().domain(d3.range(n)).range([0, iw]).paddingInner(n > 120 ? 0.15 : 0.3).paddingOuter(0.1);
    const cx = (i) => x(i) + x.bandwidth() / 2;
    const ext = (key) => { const v = pts.map((q) => q[key]).filter((q) => q !== null); return v.length ? [Math.min(0, d3.min(v)), Math.max(0, d3.max(v))] : [0, 1]; };
    const yDay = d3.scaleLinear().domain(ext('day')).nice().range([ih, 0]);
    // counts and amounts grow from zero; ratios, averages and balances use their own range so changes are visible
    const fit = (key) => { const v = pts.map((q) => q[key]).filter((q) => q !== null); if (!v.length) return [0, 1]; let [a, z] = d3.extent(v); if (a === z) { a -= Math.abs(a || 1) * 0.05; z += Math.abs(z || 1) * 0.05; } const pad = (z - a) * 0.08; return [a - pad, z + pad]; };
    const yRun = d3.scaleLinear().domain(pts.additive ? ext('cum') : fit('cum')).nice().range([ih, 0]);
    if (ct === 'line') yDay.domain(fit('day')).nice();

    const svg = d3.select(host).append('svg').attr('width', W).attr('height', H);
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);
    if (hasBars) {
      const bw = Math.max(1, x.bandwidth());
      g.append('g').selectAll('rect').data(pts.filter((q) => q.day !== null)).join('rect')
        .attr('x', (q) => cx(pts.indexOf(q)) - bw / 2).attr('width', bw)
        .attr('y', (q) => Math.min(yDay(q.day), yDay(0))).attr('height', (q) => Math.max(0.5, Math.abs(yDay(q.day) - yDay(0))))
        .attr('rx', cfg.barRound ? Math.min(bw / 2, 6) : 0)
        .attr('fill', b.cols.bar).attr('opacity', ct === 'combo' ? 0.75 : 0.85);
    }
    const lineOf = (key, y) => d3.line().defined((q) => q[key] !== null).x((q, i) => cx(i)).y((q) => y(q[key])).curve(curveOf())(pts);
    if (ct === 'running') {
      const gid = `kc-r${b.i}`;
      const gr = svg.append('defs').append('linearGradient').attr('id', gid).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
      gr.append('stop').attr('offset', '0%').attr('stop-color', b.cols.line).attr('stop-opacity', 0.2);
      gr.append('stop').attr('offset', '100%').attr('stop-color', b.cols.line).attr('stop-opacity', 0);
      g.append('path').attr('d', d3.area().defined((q) => q.cum !== null).x((q, i) => cx(i)).y0(ih).y1((q) => yRun(q.cum)).curve(curveOf())(pts)).attr('fill', `url(#${gid})`);
    }
    if (hasRun) g.append('path').attr('d', lineOf('cum', yRun)).attr('fill', 'none').attr('stroke', b.cols.line).attr('stroke-width', 2).attr('stroke-linejoin', 'round').attr('stroke-linecap', 'round');
    if (hasDayLine) g.append('path').attr('d', lineOf('day', yDay)).attr('fill', 'none').attr('stroke', b.cols.line).attr('stroke-width', 1.6).attr('stroke-linejoin', 'round');

    if (showAxis) {
      const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / (fs + 3)))));
      const ax = g.append('g').attr('class', 'kc-axis').attr('transform', `translate(0,${ih + 4})`);
      ax.selectAll('text').data(pts.filter((q, i) => (n - 1 - i) % every === 0)).join('text')
        .attr('transform', (q) => `translate(${cx(pts.indexOf(q)) + fs * 0.35},0) rotate(-90)`)
        .attr('text-anchor', 'end').style('font-size', fs + 'px').text((q) => fmtTick(new Date(q.t)));
    }

    // hover: the date, its value and the running total
    const guide = g.append('line').attr('class', 'kc-guide').attr('y1', 0).attr('y2', ih).attr('display', 'none');
    const dot = g.append('circle').attr('r', 3.2).attr('fill', b.cols.line).attr('stroke', '#fff').attr('stroke-width', 1.5).attr('display', 'none');
    const fmtV = (v) => fmtCard(v, b.c, b.unit);
    g.append('rect').attr('width', iw).attr('height', ih).attr('fill', 'transparent').style('cursor', 'crosshair')
      .on('mousemove', (ev) => {
        const [mx] = d3.pointer(ev);
        const i = Math.max(0, Math.min(n - 1, Math.floor((mx - x(0) + x.step() * x.paddingInner() / 2) / x.step())));
        const q = pts[i];
        guide.attr('display', null).attr('x1', cx(i)).attr('x2', cx(i));
        if (hasRun && q.cum !== null) dot.attr('display', null).attr('cx', cx(i)).attr('cy', yRun(q.cum)); else if (hasDayLine && q.day !== null) dot.attr('display', null).attr('cx', cx(i)).attr('cy', yDay(q.day)); else dot.attr('display', 'none');
        const rows = [];
        if (ct !== 'running') rows.push([dayName(), fmtV(q.day)]);
        if (hasRun || ct === 'bars' || ct === 'line') rows.push([runName() === 'Cumulative' ? 'Running total' : runName(), fmtV(q.cum)]);
        showTooltip(`<div class="kc-tt-head">${esc(fmtRange([q.t, q.t]))}</div>` + rows.map(([k, v]) => `<div class="kc-tt-row"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join(''), ev);
      })
      .on('mouseleave', () => { guide.attr('display', 'none'); dot.attr('display', 'none'); hideTooltip(); });
  }

  // ---------------------------------------------------------------- status: green / yellow / red
  // change (default): growing in the good direction = green, the other way = red; a small change
  //   within "Flat band" (e.g. ±2%) = yellow
  // value: the number against two thresholds (e.g. Approval Rate: green ≥ 85%, yellow ≥ 75%, else red)
  // target: % of target, against where MTD/YTD should be today (green ≥ 100%, yellow ≥ 90%)
  function statusOf (c, v, dinfo, tgt, unit) {
    const rule = c.statusRule || 'change';
    const up = c.better !== 'down';
    const pctNum = (s, def) => { const x = parseFloat(String(s ?? '').replace(/[%\s,]/g, '')); return Number.isFinite(x) ? x : def; };
    if (rule === 'value') {
      let g = parseAmount(c.statusGood); let w = parseAmount(c.statusWarn);
      if (isPct(c, unit)) { // "85" or "85%" both mean 85% on a % card
        if (g !== null && !/%/.test(c.statusGood) && Math.abs(g) > 1.5) g /= 100;
        if (w !== null && !/%/.test(c.statusWarn) && Math.abs(w) > 1.5) w /= 100;
      }
      if (g === null || v === null) return 'neutral';
      if (up ? v >= g : v <= g) return 'good';
      if (w !== null && (up ? v >= w : v <= w)) return 'warn';
      return 'bad';
    }
    if (rule === 'target') {
      if (!tgt) return 'neutral';
      const r = (tgt.pace ? tgt.pct / tgt.pace : tgt.pct) * 100;
      const g = pctNum(c.statusGood, 100); const w = pctNum(c.statusWarn, null); // no yellow threshold = only green / red
      if (up ? r >= g : r <= g) return 'good';
      if (w !== null && (up ? r >= w : r <= w)) return 'warn';
      return 'bad';
    }
    if (!dinfo || c.better === 'none') return 'neutral';
    const band = pctNum(c.statusBand, 0);
    const size = dinfo.pp ? Math.abs(dinfo.d * 100) : dinfo.pct === null ? Infinity : Math.abs(dinfo.pct * 100);
    if (band > 0 && size <= band) return 'warn';
    return dinfo.tone === 'good' ? 'good' : dinfo.tone === 'bad' ? 'bad' : 'warn';
  }
  const ICON_PATHS = {
    up: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    down: '<path d="M3 7l6 6 4-4 8 8"/><path d="M15 17h6v-6"/>',
    flat: '<path d="M4 12h15"/><path d="M15 8l4 4-4 4"/>',
    dot: '<circle cx="12" cy="12" r="3.5" fill="currentColor"/>'
  };
  function statusIcon (st, dir) {
    const shape = dir === 'up' || dir === 'down' || dir === 'flat' ? dir : 'dot';
    return `<i class="kc-ico s-${st}${cfg.iconStyle === 'solid' ? ' solid' : ''}" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[shape]}</svg></i>`;
  }

  // the same big-number size on every card, as large as the smallest card allows
  function fitValues (built) {
    const vals = built.map((b) => b.el.querySelector('.kc-value')).filter(Boolean);
    if (!vals.length) return;
    if (+cfg.valueSize) { vals.forEach((v) => { v.style.fontSize = cfg.valueSize + 'px'; }); return; }
    let size = 44;
    for (const b of built) {
      const v = b.el.querySelector('.kc-value');
      if (!v) continue;
      const cw = b.el.clientWidth - 28; const ch = b.el.clientHeight;
      const chars = Math.max(3, v.textContent.length) + (v.querySelector('.kc-ico') ? 1.5 : 0);
      size = Math.min(size, cw / (chars * 0.6), ch * (b.chart ? 0.18 : 0.3));
    }
    size = Math.max(14, Math.floor(size));
    vals.forEach((v) => { v.style.fontSize = size + 'px'; });
  }

  function drawSpark (b) {
    const host = b.el.querySelector('.kc-spark');
    const W = host.clientWidth; const H = host.clientHeight;
    if (W < 40 || H < 14) return;
    const { pts } = b.spark;
    const pad = 3;
    const x = d3.scaleLinear().domain([0, pts.length - 1]).range([pad, W - pad]);
    const ext = d3.extent(pts, (q) => q.v);
    if (ext[0] === ext[1]) { ext[0] -= 1; ext[1] += 1; }
    const y = d3.scaleLinear().domain(ext).range([H - pad, pad]);
    const svg = d3.select(host).append('svg').attr('width', W).attr('height', H);
    const id = `kc-g${b.i}`;
    const g = svg.append('defs').append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
    g.append('stop').attr('offset', '0%').attr('stop-color', b.color).attr('stop-opacity', 0.18);
    g.append('stop').attr('offset', '100%').attr('stop-color', b.color).attr('stop-opacity', 0);
    svg.append('path').attr('d', d3.area().x((q, i) => x(i)).y0(H).y1((q) => y(q.v)).curve(curveOf())(pts)).attr('fill', `url(#${id})`);
    svg.append('path').attr('d', d3.line().x((q, i) => x(i)).y((q) => y(q.v)).curve(curveOf())(pts)).attr('fill', 'none').attr('stroke', b.color).attr('stroke-width', H > 70 ? 2 : 1.6).attr('stroke-linecap', 'round');
    const last = pts[pts.length - 1];
    svg.append('circle').attr('cx', x(pts.length - 1)).attr('cy', y(last.v)).attr('r', 2.8)
      .attr('fill', b.color).attr('stroke', b.color).attr('stroke-width', 1.5);
    const dot = svg.append('circle').attr('r', 3).attr('fill', b.color).attr('display', 'none');
    svg.append('rect').attr('width', W).attr('height', H).attr('fill', 'transparent')
      .on('mousemove', (ev) => {
        const [mx] = d3.pointer(ev);
        const i = Math.max(0, Math.min(pts.length - 1, Math.round(x.invert(mx))));
        const q = pts[i];
        dot.attr('display', null).attr('cx', x(i)).attr('cy', y(q.v));
        showTooltip(`<div class="kc-tt-row"><span>${esc(q.label)}</span><b>${esc(fmtCard(q.v, b.c, b.unit))}</b></div>${b.spark.mode === 'months' && b.c && effectivePeriod(b.c) === 'mtd' ? '<div class="kc-tt-sub">Same days of each month, like MTD</div>' : ''}`, ev);
      })
      .on('mouseleave', () => { dot.attr('display', 'none'); hideTooltip(); });
  }

  // ---------------------------------------------------------------- change + formatting
  function isPct (c, unit) { return c.format === 'percent' || (c.format === 'auto' && unit && unit.pct); }
  function change (v, b, c, unit) {
    const d = v - b;
    const pct = b !== 0 ? d / Math.abs(b) : null;
    const pp = isPct(c, unit);
    const dir = d > 0 ? 'up' : d < 0 ? 'down' : 'flat';
    const tone = dir === 'flat' || c.better === 'none' ? 'flat' : (dir === 'up') === (c.better !== 'down') ? 'good' : 'bad';
    const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■';
    const sign = d > 0 ? '+' : d < 0 ? '−' : '';
    let text;
    if (pp) text = `${sign}${Math.abs(d * 100).toFixed(1)} pp`;
    else if (pct === null) text = 'new';
    else { const a = Math.abs(pct * 100); text = `${sign}${a >= 100 ? Math.round(a).toLocaleString('en-US') : a.toFixed(1)}%`; }
    return { tone, arrow, text, dir, pct, pp, d, abs: pp ? '' : `${sign}${fmtCard(Math.abs(d), c, unit)}` };
  }

  function fmtCard (v, c, unit) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    const neg = v < 0; let n = Math.abs(v);
    const dec = c.decimals === 'auto' || c.decimals === '' || c.decimals === undefined ? null : +c.decimals;
    const fx = (x, d) => d3.format(`,.${d}f`)(x);
    let body; let pre = c.prefix || ''; let suf = c.suffix || '';
    const scaled = (div, s, d) => { const q = n / div; return fx(q, d ?? (q < 10 ? 2 : q < 100 ? 1 : 0)) + s; };
    const compact = (d) => (n >= 1e9 ? scaled(1e9, 'B', d) : n >= 1e6 ? scaled(1e6, 'M', d) : n >= 1e4 ? scaled(1e3, 'K', d) : fx(n, d ?? (n >= 100 ? 0 : 2)));
    switch (c.format) {
      case 'number': body = fx(n, dec ?? (n >= 100 ? 0 : 2)); break;
      case 'compact': body = compact(dec); break;
      case 'k': body = scaled(1e3, 'K', dec); break;
      case 'm': body = scaled(1e6, 'M', dec); break;
      case 'mn': body = scaled(1e6, ' Mn', dec); break;
      case 'b': body = scaled(1e9, 'B', dec); break;
      case 'percent': body = fx(n * 100, dec ?? 1) + '%'; break;
      default: // auto: Tableau's own format (prefix, %, display units like "892 Mn"), compact when very long
        if (unit && unit.pct) body = fx(n * 100, dec ?? 1) + '%';
        else if (unit && unit.scale > 1) { const q = n / unit.scale; body = fx(q, dec ?? Math.max(unit.decimals || 0, q < 10 ? 1 : 0)) + unit.suffix; } else body = n >= 1e6 ? compact(dec) : fx(n, dec ?? (n >= 1000 || (unit && !unit.calc && !unit.decimals) ? 0 : n >= 100 ? 1 : 2)) + (unit && !unit.calc ? unit.suffix : '');
        if (!c.prefix && unit) pre = unit.prefix;
    }
    return (neg ? '−' : '') + pre + body + suf;
  }

  // "1.2M", "1,200 Mn", "850k", "1e6" -> number
  function parseAmount (s) {
    const m = String(s || '').replace(/,/g, '').trim().match(/^(-?\d*\.?\d+(?:e[+-]?\d+)?)\s*(k|m|mn|b|bn|%)?$/i);
    if (!m) return null;
    const mult = { k: 1e3, m: 1e6, mn: 1e6, b: 1e9, bn: 1e9, '%': 0.01 }[(m[2] || '').toLowerCase()] || 1;
    return parseFloat(m[1]) * mult;
  }

  // ================================================================ chrome
  function applyStyle () {
    const bg = cfg.background === 'white' ? '#ffffff' : cfg.background === 'custom' ? (cfg.bgColor || '#ffffff') : 'transparent';
    const r = document.documentElement.style;
    r.setProperty('--surface', bg);
    r.setProperty('--card-bg', bg === 'transparent' ? '#ffffff' : bg);
    r.setProperty('--label-size', (+cfg.labelSize || 12) + 'px');
    r.setProperty('--detail-size', (+cfg.detailSize || 11) + 'px');
    r.setProperty('--value-weight', cfg.valueWeight || '700'); r.setProperty('--value-color', cfg.valueColor || '#0b0b0b');
    r.setProperty('--label-weight', cfg.labelWeight || '600'); r.setProperty('--label-color', cfg.labelColor || '#52514e');
    r.setProperty('--detail-weight', cfg.detailWeight || '400'); r.setProperty('--detail-color', cfg.detailColor || '#898781');
    r.setProperty('--spark-max', { large: '120px', medium: '64px', small: '36px' }[cfg.sparkSize] || 'none');
  }
  function showTooltip (html, ev) {
    const tt = $('tooltip');
    tt.innerHTML = html; tt.hidden = false;
    const r = tt.getBoundingClientRect();
    let x = ev.clientX + 14; let y = ev.clientY + 14;
    if (x + r.width > window.innerWidth - 4) x = ev.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 4) y = Math.max(4, ev.clientY - r.height - 14);
    tt.style.left = Math.max(4, x) + 'px'; tt.style.top = y + 'px';
  }
  function hideTooltip () { const t = $('tooltip'); if (t) t.hidden = true; }
  function showEmpty (html) { const el = $('empty'); el.innerHTML = `<div>${html}</div>`; el.hidden = false; }

  // ================================================================ settings + dialog
  function loadSettings () {
    let saved = {};
    try { const raw = tableau.extensions.settings.get('config'); if (raw) saved = JSON.parse(raw); } catch (e) { /* none */ }
    cfg = { ...DEFAULTS, ...saved };
    cfg.measures = cfg.measures || {}; cfg.calcs = cfg.calcs || []; cfg.order = cfg.order || [];
    if (!saved.chartType && saved.sparkline === 'none') cfg.chartType = 'none'; // settings from 1.0–1.2
  }

  async function openFormatDialog () {
    const url = new URL('format.html' + window.location.search, window.location.href).href;
    const ctx = model && model.measures ? {
      measures: model.measures.map((m) => ({ key: m.key, name: m.name, defRollup: m.defRollup, sample: m.sample ? m.sample.text : '' })),
      order: cardList().map((cd) => cd.id),
      grain: model.grain
    } : { measures: [], order: [], grain: 'day' };
    try {
      await tableau.extensions.ui.displayDialogAsync(url, JSON.stringify({ ctx, defaults: DEFAULTS, card: CARD }), { width: 560, height: 760 });
    } catch (e) {
      if (!(tableau.ErrorCodes && e.errorCode === tableau.ErrorCodes.DialogClosedByUser)) console.error(e);
    }
    loadSettings(); rebuild(); render();
  }

  // ================================================================ helpers
  function parseDate (dv) {
    if (!dv) return null;
    const nv = dv.nativeValue;
    if (nv === null || nv === undefined || nv === '%null%') return null;
    if (nv instanceof Date && !isNaN(nv)) return Date.UTC(nv.getUTCFullYear(), nv.getUTCMonth(), nv.getUTCDate());
    const s = typeof dv.value === 'string' ? dv.value : '';
    const mm = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return mm ? Date.UTC(+mm[1], +mm[2] - 1, +mm[3]) : null;
  }
  function toNumber (dv) {
    if (!dv) return null;
    const v = typeof dv.nativeValue === 'number' ? dv.nativeValue : (dv.nativeValue === null ? NaN : Number(dv.value));
    return Number.isFinite(v) ? v : null;
  }
  function resolve (name, names) {
    if (names.includes(name)) return name;
    const lc = String(name).toLowerCase(); const cn = cleanName(name).toLowerCase();
    return names.find((n) => n.toLowerCase() === lc) || names.find((n) => cleanName(n).toLowerCase() === cn) || names.find((n) => n.toLowerCase().includes(cn)) || null;
  }
  const cleanName = (n) => String(n || '').replace(/^(SUM|AVG|MIN|MAX|CNT|CNTD|COUNT|COUNTD|MEDIAN|ATTR|AGG|YEAR|QUARTER|MONTH|WEEK|DAY|MDY)\((.*)\)$/i, '$2');
  // prefix / suffix and display units ("892 Mn" for 892,000,000 -> scale 1e6) from Tableau's formatted text
  function detectUnit (sample, value) {
    if (!sample) return { prefix: '', suffix: '', pct: false, scale: 1, decimals: 0 };
    const s = String(sample).trim();
    const prefix = (s.match(/^[^\d\-−(.]*/) || [''])[0];
    const suffix = (s.match(/[^\d.,)]*$/) || [''])[0];
    const pct = /%\s*$/.test(s);
    const num = (s.match(/\d[\d,]*(\.\d+)?/) || [''])[0];
    const shown = parseFloat(num.replace(/,/g, ''));
    let scale = 1;
    if (!pct && Number.isFinite(value) && value !== 0 && shown > 0) {
      const r = Math.log10(Math.abs(value) / shown);
      const best = [0, 3, 6, 9, 12].reduce((a, e) => (Math.abs(r - e) < Math.abs(r - a) ? e : a), 0);
      if (Math.abs(r - best) < 0.3) scale = Math.pow(10, best);
    }
    const dm = num.match(/\.(\d+)$/);
    return { prefix, suffix, pct, scale, decimals: dm ? dm[1].length : 0 };
  }
  function esc (s) { return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  function debounce (fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  { const v = document.querySelector('meta[name="ext-version"]'); console.log('[' + document.title + '] version', v ? v.content : '?'); }
  init();
})();
