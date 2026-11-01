/* Smooth Trend – Tableau Viz Extension
 * Encodings (see SmoothTrend.trex): date, value, series (optional), tooltip (optional, up to 5)
 * Features: smooth line, header with icon + KPI + growth pill, smart/Tableau tooltips,
 * growth/degrowth line coloring, high/low labels, click-to-select (drives dashboard actions),
 * KPI header (latest / previous / MTD / QTD / YTD / total / average / own calculation on the KPI shelf),
 * settings edited in Tableau's "Format Extension" dialog (format.html) and saved in the workbook.
 */
/* global d3, tableau */
'use strict';

(function () {
  // ---------------------------------------------------------------- config
  const DEFAULTS = {
    title: '',
    icon: 'auto',
    showHeader: true,
    subtitle: 'range', // range | asof | none
    kpiValue: 'auto', // auto | latest | previous | mtd | qtd | ytd | total | average | shelf
    kpiCompare: 'previous', // previous | yoy | first | peak | none
    kpiAgg: 'auto', // auto | sum | avg  (how MTD/QTD/YTD/total combine periods)
    shortNumbers: false,
    dateLevel: 'auto', // auto | day | week | month | quarter | year  (rolls the data up to this level)
    dateFormat: 'auto', // auto | tableau | mmm-yyyy | mmmm-yyyy | yyyy-mm | mm/yyyy | dd-mmm-yyyy | quarter | yyyy
    colorByGrowth: true,
    higherIsBetter: true,
    upColor: '#0ca30c',
    downColor: '#d03b3b',
    curve: 'smooth',
    lineColor: '#2a78d6',
    lineWidth: 2.5,
    showArea: true,
    showPoints: false,
    showMinMax: true,
    yZero: true,
    animate: true,
    tooltipMode: 'custom'
  };
  // Categorical order for multiple series (validated palette, assigned in fixed order)
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];
  const OTHER_COLOR = '#898781';
  const MAX_SERIES = 8;

  const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';
  const ICONS = {
    up: `<svg ${ICON_ATTRS}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>`,
    down: `<svg ${ICON_ATTRS}><polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/></svg>`,
    flat: `<svg ${ICON_ATTRS}><path d="M3 12h18"/><path d="m15 6 6 6-6 6"/></svg>`,
    chart: `<svg ${ICON_ATTRS}><path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/></svg>`,
    money: `<svg ${ICON_ATTRS}><rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/></svg>`,
    users: `<svg ${ICON_ATTRS}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
    activity: `<svg ${ICON_ATTRS}><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>`
  };

  let cfg = { ...DEFAULTS };
  let worksheet = null;
  let model = null;
  let lastData = null; // cached summary data, so settings changes can rebuild without re-querying
  let lastEnc = null;
  let hasAnimated = false;
  let lastHoverTuple = 0;
  let selectedTuple = 0;

  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- init
  async function init () {
    try {
      // "configure" is called by Tableau's Format Extension button (see <context-menu> in the .trex)
      await tableau.extensions.initializeAsync({ configure: openFormatDialog });
    } catch (e) {
      showEmpty('<b>Could not start the extension.</b><br>' + escapeHtml(e.message || String(e)));
      return;
    }
    worksheet = tableau.extensions.worksheetContent.worksheet;

    loadSettings();

    worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, refresh);
    try {
      tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, () => {
        loadSettings();
        hasAnimated = true;
        rebuild();
        render();
      });
    } catch (e) { /* settings events not available in this host */ }

    const ro = new ResizeObserver(debounce(render, 60));
    ro.observe(document.body);

    refresh();
  }

  async function refresh () {
    try {
      [lastData, lastEnc] = await Promise.all([getSummaryRows(), getEncodings()]);
      model = buildModel(lastData, lastEnc);
    } catch (e) {
      console.error(e);
      model = { error: e.message || String(e) };
    }
    render();
  }

  function rebuild () {
    if (!lastData || !lastEnc) return;
    try { model = buildModel(lastData, lastEnc); } catch (e) { console.error(e); model = { error: e.message || String(e) }; }
  }

  // ---------------------------------------------------------------- data access
  async function getSummaryRows () {
    const reader = await worksheet.getSummaryDataReaderAsync(undefined, {
      ignoreSelection: true,
      applyWorksheetFormatting: true
    });
    const rows = [];
    let columns = [];
    let offset = 0;
    for (let p = 0; p < reader.pageCount; p++) {
      const page = await reader.getPageAsync(p);
      columns = page.columns;
      for (let i = 0; i < page.data.length; i++) {
        const row = { __tupleId: offset + i + 1 };
        for (const col of columns) row[col.fieldName] = page.data[i][col.index];
        rows.push(row);
      }
      offset += page.data.length;
    }
    await reader.releaseAsync();
    return { rows, columns };
  }

  async function getEncodings () {
    const spec = await worksheet.getVisualSpecificationAsync();
    const map = {};
    if (spec.activeMarksSpecificationIndex < 0) return map;
    const card = spec.marksSpecifications[spec.activeMarksSpecificationIndex];
    for (const enc of card.encodings) {
      (map[enc.id] = map[enc.id] || []).push(enc.field);
    }
    return map;
  }

  // ---------------------------------------------------------------- model
  function buildModel ({ rows, columns }, enc) {
    const dateF = enc.date && enc.date[0];
    const valF = enc.value && enc.value[0];
    const serF = enc.series && enc.series[0];
    const ttF = enc.tooltip || [];
    const kpiF = enc.kpi || [];
    if (!dateF || !valF) return { empty: true, needDate: !dateF, needValue: !valF };

    const colNames = columns.map((c) => c.fieldName);
    const key = (f) => resolveColumn(f, colNames);
    const dateK = key(dateF);
    const valK = key(valF);
    const serK = serF ? key(serF) : null;
    // Extra tooltip fields = whatever sits on Tableau's built-in Tooltip (or Detail) tile,
    // i.e. every summary-data column not used by our own shelves.
    const used = new Set([dateK, valK, serK, ...kpiF.map(key)].filter(Boolean));
    const ttNamed = ttF.map((f) => ({ name: f.name, k: key(f) })).filter((t) => t.k);
    const ttK = ttNamed.length ? ttNamed : colNames.filter((c) => !used.has(c)).map((c) => ({ name: c, k: c }));
    const kpiK = kpiF.map((f) => ({ name: cleanName(f.name), k: key(f) })).filter((t) => t.k);
    let kpiRow = null; // row of the KPI shelf at the latest date

    // Decide the x type from the data
    const parsed = rows.map((r) => parseX(r[dateK]));
    const types = new Set(parsed.filter(Boolean).map((p) => p.t));
    const xType = types.size === 1 ? [...types][0] : 'ordinal';

    // Date level: detect it from the data, or roll the data up to the level chosen in Format
    let rawGrain = 'period';
    if (xType === 'time') {
      const uniq = [...new Set(parsed.filter(Boolean).map((p) => +p.v))].sort((a, b) => a - b);
      rawGrain = detectGrain(uniq).grain;
    }
    const level = xType === 'time' && cfg.dateLevel !== 'auto' ? cfg.dateLevel : null;
    if (level) parsed.forEach((p) => { if (p) p.v = floorDate(p.v, level); });

    const ordinalOrder = [];
    const seenOrd = new Set();
    const seriesMap = new Map();
    let unitSample = null;

    rows.forEach((r, i) => {
      const dv = r[valK];
      const y = toNumber(dv);
      const px = parsed[i];
      if (y === null || !px) return;
      const xLabel = formatted(r[dateK]);
      const x = xType === 'ordinal' ? xLabel : px.v;
      const k = xType === 'ordinal' ? xLabel : +px.v;
      if (xType === 'ordinal' && !seenOrd.has(k)) { seenOrd.add(k); ordinalOrder.push(k); }
      if (!unitSample && dv && dv.formattedValue) unitSample = dv.formattedValue;
      if (kpiK.length && toNumber(r[kpiK[0].k]) !== null) {
        const rank = xType === 'ordinal' ? ordinalOrder.indexOf(k) : k;
        if (!kpiRow || rank >= kpiRow.rank) kpiRow = { rank, r };
      }

      const sName = serK ? formatted(r[serK]) : (valF.name ? cleanName(valF.name) : 'Value');
      if (!seriesMap.has(sName)) seriesMap.set(sName, new Map());
      const pts = seriesMap.get(sName);
      if (pts.has(k)) { // same period twice (rolled-up dates, or a dimension on Detail) -> combine
        const p = pts.get(k);
        p.y += y;
        p.n++;
        p.yLabel = null;
        p.tupleIds.push(r.__tupleId);
      } else {
        pts.set(k, {
          k,
          x,
          xLabel,
          y,
          yLabel: dv.formattedValue,
          tupleId: r.__tupleId,
          tupleIds: [r.__tupleId],
          n: 1,
          extras: ttK.map((t) => ({ name: cleanName(t.name), value: formatted(r[t.k]) }))
        });
      }
    });

    const unit = detectUnit(unitSample);
    // Combined periods: sum, or average for % measures / when "Average" is chosen
    const useAvg = cfg.kpiAgg === 'avg' || (cfg.kpiAgg === 'auto' && unit.pct);
    if (useAvg) seriesMap.forEach((m) => m.forEach((p) => { if (p.n > 1) p.y /= p.n; }));
    const keyOrder = xType === 'ordinal'
      ? ordinalOrder
      : [...new Set([].concat(...[...seriesMap.values()].map((m) => [...m.keys()])))].sort((a, b) => a - b);
    const keyIndex = new Map(keyOrder.map((k, i) => [k, i]));

    let series = [...seriesMap.entries()].map(([name, m]) => ({
      name,
      points: [...m.values()].sort((a, b) => keyIndex.get(a.k) - keyIndex.get(b.k))
    }));

    // Grain of what we plot (day / week / month / quarter / year)
    let grain = 'period'; let grainMs = 0;
    if (xType === 'time') {
      if (level) { grain = level; grainMs = GRAIN_MS[level]; } else ({ grain, grainMs } = detectGrain(keyOrder));
      // Date labels follow the grain (e.g. "Jan 2025" for monthly data) unless "As in Tableau" is chosen
      if (cfg.dateFormat !== 'tableau' || level) {
        series.forEach((s) => s.points.forEach((p) => { p.xLabel = fmtDate(new Date(p.k), grain); }));
      }
    }

    // Fold series beyond the palette into "Other" (never generate extra hues)
    if (series.length > MAX_SERIES) {
      series.sort((a, b) => lastY(b) - lastY(a));
      const keep = series.slice(0, MAX_SERIES - 1);
      const rest = series.slice(MAX_SERIES - 1);
      const om = new Map();
      rest.forEach((s) => s.points.forEach((p) => {
        const o = om.get(p.k) || { k: p.k, x: p.x, xLabel: p.xLabel, y: 0, yLabel: null, tupleId: 0, extras: [] };
        o.y += p.y; om.set(p.k, o);
      }));
      keep.push({ name: `Other (${rest.length})`, other: true, points: [...om.values()].sort((a, b) => keyIndex.get(a.k) - keyIndex.get(b.k)) });
      series = keep;
    }
    series.forEach((s, i) => {
      s.color = s.other ? OTHER_COLOR : PALETTE[i % PALETTE.length];
      s.byKey = new Map(s.points.map((p, j) => [p.k, j]));
    });

    // Total per period, for the header KPI
    const totals = keyOrder.map((k) => {
      let y = 0; let label = null; let n = 0;
      for (const s of series) {
        const j = s.byKey.get(k);
        if (j !== undefined) { y += s.points[j].y; label = label || s.points[j].xLabel; n++; }
      }
      return n ? { k, y, xLabel: label } : null;
    }).filter(Boolean);

    if (!totals.length) return { empty: true, noData: true };

    let kpiShelf = null;
    if (kpiRow) {
      const [a, b] = kpiK;
      kpiShelf = {
        name: a.name,
        value: toNumber(kpiRow.r[a.k]),
        valueLabel: formatted(kpiRow.r[a.k]),
        compareName: b ? b.name : null,
        compare: b ? toNumber(kpiRow.r[b.k]) : null
      };
    }

    return {
      xType,
      keys: keyOrder,
      series,
      totals,
      unit,
      single: series.length === 1,
      grain,
      grainMs,
      rawGrain,
      kpiShelf,
      valueName: cleanName(valF.name || 'Value'),
      seriesName: serF ? cleanName(serF.name) : null
    };
  }

  const GRAIN_MS = { day: 864e5, week: 7 * 864e5, month: 30.44 * 864e5, quarter: 91.3 * 864e5, year: 365.25 * 864e5 };

  function detectGrain (sortedKeys) {
    if (sortedKeys.length < 2) return { grain: 'month', grainMs: GRAIN_MS.month };
    const ms = d3.median(d3.pairs(sortedKeys, (a, b) => b - a));
    const days = ms / 864e5;
    const grain = days <= 1.5 ? 'day' : days <= 8 ? 'week' : days <= 32 ? 'month' : days <= 95 ? 'quarter' : 'year';
    return { grain, grainMs: ms };
  }

  function floorDate (d, level) {
    const y = d.getUTCFullYear(); const m = d.getUTCMonth();
    switch (level) {
      case 'year': return new Date(Date.UTC(y, 0, 1));
      case 'quarter': return new Date(Date.UTC(y, m - (m % 3), 1));
      case 'month': return new Date(Date.UTC(y, m, 1));
      case 'week': return d3.utcSunday.floor(d); // weeks start on Sunday (Tableau default)
      default: return d3.utcDay.floor(d);
    }
  }

  const DATE_FORMATS = { 'mmm-yyyy': '%b %Y', 'mmmm-yyyy': '%B %Y', 'yyyy-mm': '%Y-%m', 'mm/yyyy': '%m/%Y', 'dd-mmm-yyyy': '%-d %b %Y', yyyy: '%Y' };
  const quarterLabel = (d) => `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;

  function fmtDate (d, grain) {
    const f = cfg.dateFormat;
    if (f === 'quarter') return quarterLabel(d);
    if (DATE_FORMATS[f]) return d3.utcFormat(DATE_FORMATS[f])(d);
    switch (grain) {
      case 'year': return d3.utcFormat('%Y')(d);
      case 'quarter': return quarterLabel(d);
      case 'month': return d3.utcFormat('%b %Y')(d);
      case 'week': return d3.utcFormat('Week of %-d %b %Y')(d);
      default: return d3.utcFormat('%-d %b %Y')(d);
    }
  }

  function resolveColumn (field, colNames) {
    if (!field) return null;
    if (colNames.includes(field.name)) return field.name;
    const hit = colNames.find((c) => c.toLowerCase() === String(field.name).toLowerCase()) ||
      colNames.find((c) => c.includes(cleanName(field.name)));
    return hit || field.name;
  }

  function parseX (dv) {
    if (!dv) return null;
    const nv = dv.nativeValue;
    if (nv === null || nv === undefined || nv === '%null%') return null;
    if (nv instanceof Date && !isNaN(nv)) return { t: 'time', v: nv };
    if (typeof nv === 'number') return { t: 'number', v: nv };
    const s = typeof dv.value === 'string' ? dv.value : '';
    const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):?(\d{2})?)?/);
    if (m) return { t: 'time', v: new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))) };
    return { t: 'ordinal', v: formatted(dv) };
  }

  function toNumber (dv) {
    if (!dv) return null;
    const v = typeof dv.nativeValue === 'number' ? dv.nativeValue : Number(dv.value);
    return Number.isFinite(v) ? v : null;
  }
  const formatted = (dv) => (dv ? String(dv.formattedValue ?? dv.value ?? '') : '');
  const lastY = (s) => (s.points.length ? s.points[s.points.length - 1].y : -Infinity);
  const cleanName = (n) => String(n || '').replace(/^(SUM|AVG|MIN|MAX|CNT|CNTD|COUNT|COUNTD|MEDIAN|ATTR|AGG|STDEV|VAR|YEAR|QUARTER|MONTH|WEEK|DAY|MY|MDY|QR|TMN|TQR|TYR|TWK|TDY)\((.*)\)$/i, '$2');

  // ---------------------------------------------------------------- number formatting
  function detectUnit (sample) {
    if (!sample) return { prefix: '', suffix: '', pct: false };
    const s = String(sample).trim();
    const prefix = (s.match(/^[^\d\-−(.]*/) || [''])[0];
    const suffix = (s.match(/[^\d.,)]*$/) || [''])[0];
    return { prefix, suffix, pct: /%/.test(suffix) };
  }

  function fmtNum (v, unit, compact) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    const u = unit || model.unit;
    let n = u.pct ? v * 100 : v;
    const neg = n < 0;
    n = Math.abs(n);
    let body;
    if (u.pct) body = d3.format(',.1f')(n);
    else if (compact && n >= 1000) body = d3.format('.3~s')(n).replace('G', 'B');
    else body = d3.format(n >= 100 ? ',.0f' : ',.2~f')(n);
    return (neg ? '−' : '') + u.prefix + body + u.suffix;
  }

  // Absolute change; for percentage measures this is percentage points (pp)
  function fmtDelta (d) {
    const sign = d > 0 ? '+' : d < 0 ? '−' : '';
    if (model.unit.pct) return sign + d3.format('.1f')(Math.abs(d * 100)) + ' pp';
    return sign + fmtNum(Math.abs(d), null, true);
  }

  function fmtPct (p) {
    if (p === null || !Number.isFinite(p)) return null;
    const a = Math.abs(p * 100);
    return (a >= 100 ? d3.format(',.0f')(a) : d3.format('.1f')(a)) + '%';
  }

  function change (curr, base) {
    const delta = curr - base;
    const pct = base !== 0 ? delta / Math.abs(base) : null;
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const tone = dir === 'flat' ? 'flat' : ((dir === 'up') === !!cfg.higherIsBetter ? 'good' : 'bad');
    return { delta, pct, dir, tone };
  }
  const arrow = (dir) => (dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■');
  const toneColor = (tone) => (tone === 'good' ? cfg.upColor : tone === 'bad' ? cfg.downColor : '#898781');

  // ---------------------------------------------------------------- render
  function render () {
    hideTooltip();
    const chartEl = $('chart');
    chartEl.innerHTML = '';
    if (!model) return;

    if (model.error) { $('header').hidden = true; $('legend').hidden = true; showEmpty('<b>Something went wrong.</b><br>' + escapeHtml(model.error)); return; }
    if (model.empty) {
      $('header').hidden = true; $('legend').hidden = true;
      if (model.noData) showEmpty('<b>No data to plot.</b><br>Check filters or null values.');
      else {
        const need = [model.needDate && '<b>Date</b> (a date or period field)', model.needValue && '<b>Value</b> (a measure)'].filter(Boolean).join(' and ');
        showEmpty(`${ICONS.chart.replace('<svg', '<svg width="28" height="28" style="color:#2a78d6"')}<div>Drag ${need} onto the Marks card<br>to draw the smooth trend.</div>`);
      }
      return;
    }
    $('empty').hidden = true;

    const tiny = window.innerHeight < 130;
    renderHeader(tiny);
    renderLegend(tiny);
    drawChart(chartEl);
  }

  function renderHeader (tiny) {
    const header = $('header');
    header.hidden = !cfg.showHeader || tiny;
    if (header.hidden) return;

    const t = model.totals;
    const last = t[t.length - 1];
    const kpi = computeKpi();

    $('kpiLabel').textContent = kpi.label;
    $('kpiValue').textContent = kpi.valueText || fmtNum(kpi.value, null, cfg.shortNumbers);
    $('kpiValue').title = kpi.tooltip || '';

    const pill = $('deltaPill');
    if (kpi.base !== null && kpi.base !== undefined && Number.isFinite(kpi.value)) {
      const c = change(kpi.value, kpi.base);
      const pctTxt = fmtPct(c.pct);
      pill.hidden = false;
      pill.className = 'st-pill ' + c.tone;
      pill.textContent = `${arrow(c.dir)} ${c.dir === 'down' ? '−' : c.dir === 'up' ? '+' : ''}${pctTxt || fmtDelta(c.delta).replace(/^[+−]/, '')}`;
      pill.title = `Change: ${fmtDelta(c.delta)} (from ${fmtNum(kpi.base, null, true)})`;
      $('deltaCaption').textContent = kpi.baseCaption;
      setIcon(c.dir, c.tone);
    } else {
      pill.hidden = !kpi.baseCaption;
      pill.className = 'st-pill flat'; pill.textContent = kpi.baseCaption ? '—' : '';
      $('deltaCaption').textContent = kpi.baseCaption || '';
      setIcon('flat', 'flat');
    }

    $('title').textContent = cfg.title || `${model.valueName} Trend`;
    let sub = '';
    if (cfg.subtitle === 'asof') sub = `Data as of ${last.xLabel}`;
    else if (cfg.subtitle === 'range') {
      const parts = [`${t[0].xLabel} – ${last.xLabel}`, `${t.length} ${periodWord(t.length)}`];
      if (!model.single) parts.push(`by ${model.seriesName || 'series'} (${model.series.length})`);
      sub = parts.join(' · ');
    }
    $('subtitle').textContent = sub;
    $('subtitle').hidden = !sub;
  }

  function periodWord (n) {
    const w = { day: 'day', week: 'week', month: 'month', quarter: 'quarter', year: 'year' }[model.grain] || 'period';
    return n === 1 ? w : w + 's';
  }

  // ---------------------------------------------------------------- KPI engine (header number)
  // Returns { value, valueText, label, base, baseCaption, tooltip }
  function computeKpi () {
    const t = model.totals;
    const n = t.length;
    const last = t[n - 1];
    const time = model.xType === 'time';
    let mode = cfg.kpiValue;
    if (mode === 'auto') mode = model.kpiShelf ? 'shelf' : 'latest';
    if (mode === 'shelf' && !model.kpiShelf) mode = 'latest';
    if (['mtd', 'qtd', 'ytd'].includes(mode) && !time) mode = 'latest';
    if (mode === 'previous' && n < 2) mode = 'latest';
    const cmp = cfg.kpiCompare;
    const out = { value: null, valueText: '', label: '', base: null, baseCaption: '', tooltip: '' };

    // 1) Your own calculation on the KPI shelf
    if (mode === 'shelf') {
      const k = model.kpiShelf;
      out.value = k.value;
      out.valueText = cfg.shortNumbers ? '' : k.valueLabel;
      out.label = k.name;
      out.tooltip = `${k.name} at ${last.xLabel}`;
      if (k.compare !== null) { out.base = k.compare; out.baseCaption = `vs ${k.compareName}`; }
      return out;
    }

    // 2) One period: latest (max date) or the one before it
    if (mode === 'latest' || mode === 'previous') {
      const i = mode === 'latest' ? n - 1 : n - 2;
      const p = t[i];
      out.value = p.y;
      out.label = mode === 'latest' ? p.xLabel : `${p.xLabel} · previous`;
      out.tooltip = model.single ? p.xLabel : `Total of all lines, ${p.xLabel}`;
      if (model.single && !cfg.shortNumbers) {
        const sp = model.series[0].points.find((q) => q.k === p.k);
        out.valueText = sp && sp.yLabel ? sp.yLabel : '';
      }
      let b = null;
      if (cmp === 'previous' && i > 0) b = t[i - 1];
      else if (cmp === 'yoy' && time) b = nearestPoint(+utcAddMonths(new Date(p.k), -12));
      else if (cmp === 'first' && i > 0) b = t[0];
      else if (cmp === 'peak') {
        b = t.slice(0, i + 1).reduce((a, q) => (q.y > a.y ? q : a), t[0]);
        if (b === p) { out.baseCaption = 'at peak'; b = null; }
      }
      if (b) { out.base = b.y; out.baseCaption = cmp === 'yoy' ? `vs ${b.xLabel} (last year)` : cmp === 'peak' ? `vs peak (${b.xLabel})` : `vs ${b.xLabel}`; } else if (cmp === 'yoy' && time && !out.baseCaption) out.baseCaption = 'no data last year';
      return out;
    }

    // 3) Period to date: MTD / QTD / YTD, ending at the max date
    if (['mtd', 'qtd', 'ytd'].includes(mode)) {
      const unit = { mtd: 'month', qtd: 'quarter', ytd: 'year' }[mode];
      const end = new Date(last.k);
      const start = periodStart(end, unit);
      out.value = aggregate(inRange(t, start, end));
      const y = end.getUTCFullYear();
      out.label = mode === 'ytd' ? `YTD ${y}` : mode === 'qtd' ? `QTD Q${Math.floor(end.getUTCMonth() / 3) + 1} ${y}` : `MTD ${d3.utcFormat('%b %Y')(end)}`;
      out.tooltip = `${aggWord()} from ${d3.utcFormat('%d %b %Y')(start)} to ${last.xLabel}`;
      let shift = 0;
      if (cmp === 'previous') shift = unit === 'month' ? -1 : unit === 'quarter' ? -3 : -12;
      else if (cmp === 'yoy') shift = -12;
      if (shift) {
        const prev = inRange(t, utcAddMonths(start, shift), utcAddMonths(end, shift));
        if (prev.length) {
          out.base = aggregate(prev);
          out.baseCaption = shift === -12 ? 'vs same period last year' : `vs previous ${unit} (same days)`;
        } else out.baseCaption = shift === -12 ? 'no data last year' : `no data previous ${unit}`;
      }
      return out;
    }

    // 4) Whole visible range: total or average per period
    const isTotal = mode === 'total';
    const calc = (pts) => (isTotal ? d3.sum(pts, (p) => p.y) : d3.mean(pts, (p) => p.y));
    out.value = calc(t);
    out.label = isTotal ? `Total · ${n} ${periodWord(n)}` : `Average per ${periodWord(1)}`;
    out.tooltip = `${t[0].xLabel} – ${last.xLabel}`;
    if (cmp === 'yoy' && time) {
      const prev = inRange(t, utcAddMonths(new Date(t[0].k), -12), utcAddMonths(new Date(last.k), -12));
      if (prev.length) { out.base = calc(prev); out.baseCaption = 'vs same range last year'; }
    }
    return out;
  }

  function aggMode () { return cfg.kpiAgg === 'auto' ? (model.unit.pct ? 'avg' : 'sum') : cfg.kpiAgg; }
  function aggWord () { return aggMode() === 'avg' ? 'Average' : 'Sum'; }
  function aggregate (pts) {
    if (!pts.length) return null;
    const sum = d3.sum(pts, (p) => p.y);
    return aggMode() === 'avg' ? sum / pts.length : sum;
  }
  function inRange (pts, a, b) { const lo = +a; const hi = +b; return pts.filter((p) => p.k >= lo && p.k <= hi); }
  function nearestPoint (target) {
    const tol = Math.max(model.grainMs / 2, 864e5);
    let best = null; let bd = Infinity;
    for (const p of model.totals) { const d = Math.abs(p.k - target); if (d < bd) { bd = d; best = p; } }
    return bd <= tol ? best : null;
  }
  function utcAddMonths (d, months) {
    const y = d.getUTCFullYear(); const m = d.getUTCMonth() + months;
    const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
  }
  function periodStart (d, unit) {
    const y = d.getUTCFullYear(); const m = d.getUTCMonth();
    if (unit === 'month') return new Date(Date.UTC(y, m, 1));
    if (unit === 'quarter') return new Date(Date.UTC(y, m - (m % 3), 1));
    return new Date(Date.UTC(y, 0, 1));
  }

  function setIcon (dir, tone) {
    const el = $('icon');
    if (cfg.icon === 'none') { el.innerHTML = ''; return; }
    el.innerHTML = cfg.icon === 'auto' ? ICONS[dir] : (ICONS[cfg.icon] || ICONS.chart);
    el.style.setProperty('--icon-color', cfg.icon === 'auto' ? toneColor(tone) : cfg.lineColor);
  }

  function renderLegend (tiny) {
    const lg = $('legend');
    if (model.single || tiny) { lg.hidden = true; return; }
    lg.hidden = false;
    lg.innerHTML = model.series.map((s) => `<span><i style="background:${s.color}"></i>${escapeHtml(s.name)}</span>`).join('');
  }

  function curveFactory () {
    switch (cfg.curve) {
      case 'natural': return d3.curveCatmullRom.alpha(0.5);
      case 'linear': return d3.curveLinear;
      case 'step': return d3.curveStep;
      default: return d3.curveMonotoneX;
    }
  }

  function drawChart (chartEl) {
    const W = chartEl.clientWidth;
    const H = chartEl.clientHeight;
    if (W < 60 || H < 50) return;

    const { series, keys, xType, single } = model;
    const allY = [].concat(...series.map((s) => s.points.map((p) => p.y)));
    let [y0, y1] = d3.extent(allY);
    if (cfg.yZero) { y0 = Math.min(0, y0); y1 = Math.max(0, y1); }
    if (y0 === y1) { y0 -= Math.abs(y0 || 1) * 0.1; y1 += Math.abs(y1 || 1) * 0.1; }
    const pad = (y1 - y0) * 0.06;
    if (!(cfg.yZero && y0 === 0)) y0 -= pad;
    y1 += pad;

    const yTicksN = Math.max(2, Math.floor(H / 48));
    const yTmp = d3.scaleLinear().domain([y0, y1]).nice(yTicksN);
    const tickLabels = yTmp.ticks(yTicksN).map((v) => fmtNum(v, null, true));
    const maxTickW = d3.max(tickLabels, (s) => s.length) * 6.2;

    const endLabels = !single && series.length <= 4;
    const endW = endLabels ? Math.min(110, d3.max(series, (s) => s.name.length) * 5.8 + 12) : 0;
    const m = { top: 16, right: Math.max(14, endW), bottom: 24, left: Math.ceil(maxTickW) + 10 };
    const iw = Math.max(10, W - m.left - m.right);
    const ih = Math.max(10, H - m.top - m.bottom);

    const y = yTmp.range([ih, 0]);
    let x;
    if (xType === 'time') x = d3.scaleUtc().domain(d3.extent(keys, (k) => new Date(k))).range([0, iw]);
    else if (xType === 'number') x = d3.scaleLinear().domain(d3.extent(keys)).range([0, iw]);
    else x = d3.scalePoint().domain(keys).range([0, iw]).padding(keys.length > 1 ? 0.1 : 0.5);
    if (keys.length === 1 && xType !== 'ordinal') x.range([iw / 2, iw / 2]);
    const px = (p) => (xType === 'ordinal' ? x(p.k) : x(xType === 'time' ? new Date(p.k) : p.k));
    const keyX = (k) => (xType === 'ordinal' ? x(k) : x(xType === 'time' ? new Date(k) : k));

    const svg = d3.select(chartEl).append('svg').attr('width', W).attr('height', H)
      .attr('role', 'img').attr('aria-label', `${model.valueName} trend line chart`);
    try { svg.attr('class', tableau.ClassNameKey.Worksheet); } catch (e) { /* older API */ }
    const defs = svg.append('defs');
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // Grid + axes
    g.append('g').attr('class', 'st-yaxis')
      .call(d3.axisLeft(y).ticks(yTicksN).tickSize(-iw).tickPadding(8).tickFormat((v) => fmtNum(v, null, true)))
      .call((a) => a.select('.domain').remove());

    const xAxis = d3.axisBottom(x).tickSizeOuter(0).tickSize(4).tickPadding(6);
    if (xType === 'time') applyTimeTicks(xAxis, keys, iw);
    else if (xType === 'number') xAxis.ticks(Math.max(2, Math.floor(iw / 70))).tickFormat(d3.format('~g'));
    else {
      const maxLen = d3.max(keys, (k) => String(k).length) || 1;
      const fit = Math.max(1, Math.floor(iw / (maxLen * 6.2 + 14)));
      const step = Math.ceil(keys.length / fit);
      xAxis.tickValues(keys.filter((_, i) => i % step === 0));
    }
    g.append('g').attr('class', 'st-xaxis').attr('transform', `translate(0,${ih})`).call(xAxis)
      .call((a) => a.selectAll('.tick line').attr('stroke', 'var(--axis)'));

    const curve = curveFactory();
    const lineGen = d3.line().curve(curve).x(px).y((p) => y(p.y));
    const [d0, d1] = y.domain();
    const baseY = y(Math.min(d1, Math.max(d0, 0))); // area sits on zero, or on the axis floor
    const areaGen = d3.area().curve(curve).x(px).y0(baseY).y1((p) => y(p.y));
    const lw = +cfg.lineWidth || 2.5;
    const plot = g.append('g').attr('class', 'st-plot');
    const animate = cfg.animate && !hasAnimated;

    const gradient = (id, color) => {
      const lg = defs.append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
      lg.append('stop').attr('offset', '0%').attr('stop-color', color).attr('stop-opacity', 0.22);
      lg.append('stop').attr('offset', '100%').attr('stop-color', color).attr('stop-opacity', 0.01);
      return `url(#${id})`;
    };

    if (single) {
      const s = series[0];
      const pts = s.points;
      // Growth coloring needs room: on dense data (e.g. daily over 2 years) it turns into noise, so skip it
      const growth = cfg.colorByGrowth && pts.length > 1 && iw / pts.length >= 6;
      const neutral = cfg.lineColor;
      const areaFill = cfg.showArea ? gradient('st-g-base', neutral) : null;
      if (cfg.showArea) plot.append('path').attr('class', 'st-area').attr('d', areaGen(pts)).attr('fill', areaFill);
      plot.append('path').attr('class', 'st-line').attr('d', lineGen(pts)).attr('stroke', neutral).attr('stroke-width', lw);

      if (growth) {
        // Clip copies of the same smooth path into rising/falling x-ranges so the curve stays continuous
        const goodUp = !!cfg.higherIsBetter;
        const clips = { up: [], down: [] };
        for (let i = 0; i < pts.length - 1; i++) {
          const dir = pts[i + 1].y > pts[i].y ? 'up' : pts[i + 1].y < pts[i].y ? 'down' : null;
          if (!dir) continue;
          const xa = px(pts[i]) - (i === 0 ? lw * 2 : 0.5);
          const xb = px(pts[i + 1]) + (i === pts.length - 2 ? lw * 2 : 0.5);
          clips[dir].push([xa, xb]);
        }
        ['up', 'down'].forEach((dir) => {
          if (!clips[dir].length) return;
          const id = `st-clip-${dir}`;
          const cp = defs.append('clipPath').attr('id', id);
          clips[dir].forEach(([a, b]) => cp.append('rect').attr('x', a).attr('y', -m.top).attr('width', b - a).attr('height', ih + m.top + m.bottom));
          const color = (dir === 'up') === goodUp ? cfg.upColor : cfg.downColor;
          const layer = plot.append('g').attr('clip-path', `url(#${id})`);
          layer.append('path').attr('class', 'st-line').attr('d', lineGen(pts)).attr('stroke', color).attr('stroke-width', lw);
        });
      }

      if (cfg.showPoints) {
        plot.append('g').selectAll('circle').data(pts).join('circle')
          .attr('cx', px).attr('cy', (p) => y(p.y)).attr('r', Math.max(2.5, lw))
          .attr('fill', (p, i) => (growth && i > 0 ? toneColor(change(p.y, pts[i - 1].y).tone) : neutral))
          .attr('stroke', 'var(--surface)').attr('stroke-width', 1.5);
      }

      if (cfg.showMinMax && pts.length > 2) drawMinMax(plot, pts, px, y, iw);

      // Last point emphasis
      const lp = pts[pts.length - 1];
      const lastColor = growth ? toneColor(change(lp.y, pts[pts.length - 2].y).tone) : neutral;
      plot.append('circle').attr('cx', px(lp)).attr('cy', y(lp.y)).attr('r', lw + 2.5)
        .attr('fill', lastColor).attr('stroke', 'var(--surface)').attr('stroke-width', 2);
    } else {
      series.forEach((s) => {
        plot.append('path').attr('class', 'st-line').attr('d', lineGen(s.points))
          .attr('stroke', s.color).attr('stroke-width', s.other ? Math.max(1.5, lw - 1) : lw)
          .attr('stroke-dasharray', s.other ? '4 3' : null);
        if (cfg.showPoints) {
          plot.append('g').selectAll('circle').data(s.points).join('circle')
            .attr('cx', px).attr('cy', (p) => y(p.y)).attr('r', Math.max(2.5, lw))
            .attr('fill', s.color).attr('stroke', 'var(--surface)').attr('stroke-width', 1.5);
        }
        const lp = s.points[s.points.length - 1];
        if (lp) plot.append('circle').attr('cx', px(lp)).attr('cy', y(lp.y)).attr('r', lw + 1.5).attr('fill', s.color).attr('stroke', 'var(--surface)').attr('stroke-width', 2);
      });
      if (endLabels) drawEndLabels(plot, series, px, y);
    }

    if (animate) {
      plot.selectAll('.st-line').each(function () {
        const len = this.getTotalLength ? this.getTotalLength() : 0;
        if (!len) return;
        const dash = d3.select(this).attr('stroke-dasharray');
        d3.select(this).attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
          .transition().duration(1100).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
          .on('end', function () { d3.select(this).attr('stroke-dasharray', dash); });
      });
      plot.selectAll('.st-area, circle, text').attr('opacity', 0).transition().delay(500).duration(600).attr('opacity', 1);
      hasAnimated = true;
    }

    setupHover(g, { iw, ih, px, keyX, y });
  }

  // Ticks only on real periods of the data's grain (no in-between days for monthly data)
  function applyTimeTicks (xAxis, keys, iw) {
    const g = model.grain;
    const fit = Math.max(2, Math.floor(iw / 70));
    if (g === 'day' || g === 'period') { xAxis.ticks(Math.max(2, Math.floor(iw / 90))).tickFormat(utcMultiFormat); return; }
    const dates = keys.map((k) => new Date(k));
    const conf = {
      month: [(d) => d.getUTCFullYear() * 12 + d.getUTCMonth(), [1, 2, 3, 6, 12, 24, 60]],
      quarter: [(d) => d.getUTCFullYear() * 4 + Math.floor(d.getUTCMonth() / 3), [1, 2, 4, 8, 20]],
      year: [(d) => d.getUTCFullYear(), [1, 2, 5, 10, 20, 50]],
      week: [(d, i) => i, [1, 2, 4, 8, 13, 26, 52, 104]]
    }[g];
    const [idx, steps] = conf;
    const step = steps.find((st) => Math.ceil(dates.length / st) <= fit) || steps[steps.length - 1];
    let ticks = dates.filter((d, i) => idx(d, i) % step === 0);
    if (ticks.length < 2) ticks = [dates[0], dates[dates.length - 1]].filter((d, i, a) => i === 0 || +d !== +a[0]);
    xAxis.tickValues(ticks).tickFormat((d, i) => {
      const yr = d.getUTCFullYear();
      if (g === 'year') return String(yr);
      if (g === 'quarter') { const q = Math.floor(d.getUTCMonth() / 3) + 1; return step >= 4 ? String(yr) : (i === 0 || q === 1 ? `Q${q} ${yr}` : `Q${q}`); }
      if (g === 'month') return step >= 12 ? String(yr) : d3.utcFormat(i === 0 || d.getUTCMonth() === 0 ? '%b %Y' : '%b')(d);
      return d3.utcFormat(i === 0 ? '%-d %b %Y' : '%-d %b')(d);
    });
  }

  function drawMinMax (plot, pts, px, y, iw) {
    let hi = 0; let lo = 0;
    pts.forEach((p, i) => { if (p.y > pts[hi].y) hi = i; if (p.y < pts[lo].y) lo = i; });
    if (hi === lo) return;
    [[hi, 'High', -9], [lo, 'Low', 15]].forEach(([i, label, dy]) => {
      const p = pts[i];
      const cx = px(p); const cy = y(p.y);
      plot.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 3).attr('fill', 'var(--surface)').attr('stroke', 'var(--ink-2)').attr('stroke-width', 1.5);
      const anchor = cx < 40 ? 'start' : cx > iw - 40 ? 'end' : 'middle';
      plot.append('text').attr('class', 'st-annot').attr('x', cx).attr('y', cy + dy).attr('text-anchor', anchor)
        .text(`${label} ${p.yLabel || fmtNum(p.y, null, true)}`);
    });
  }

  function drawEndLabels (plot, series, px, y) {
    const items = series.map((s) => {
      const lp = s.points[s.points.length - 1];
      return lp ? { s, x: px(lp) + 8, y: y(lp.y) } : null;
    }).filter(Boolean).sort((a, b) => a.y - b.y);
    for (let i = 1; i < items.length; i++) if (items[i].y - items[i - 1].y < 12) items[i].y = items[i - 1].y + 12;
    items.forEach((it) => {
      plot.append('text').attr('class', 'st-endlabel').attr('x', it.x).attr('y', it.y).attr('dy', '0.32em').text(it.s.name);
    });
  }

  // ---------------------------------------------------------------- hover, tooltip & selection
  function setupHover (g, { iw, ih, px, keyX, y }) {
    const { keys, series } = model;
    const xs = keys.map(keyX);
    const hoverG = g.append('g').style('display', 'none');
    const cross = hoverG.append('line').attr('class', 'st-crosshair').attr('y1', 0).attr('y2', ih);
    const dots = hoverG.selectAll('circle').data(series).join('circle').attr('class', 'st-hover-dot')
      .attr('r', 5).attr('fill', (s) => (model.single ? cfg.lineColor : s.color));

    const nearestKeyIndex = (mx) => {
      let best = 0; let bd = Infinity;
      for (let i = 0; i < xs.length; i++) { const d = Math.abs(xs[i] - mx); if (d < bd) { bd = d; best = i; } }
      return best;
    };
    const hitAt = (event) => {
      const [mx, my] = d3.pointer(event, g.node());
      const k = keys[nearestKeyIndex(mx)];
      const hits = series.map((s) => {
        const j = s.byKey.get(k);
        return j === undefined ? null : { s, j, p: s.points[j] };
      }).filter(Boolean);
      let nearest = null; let nd = Infinity;
      hits.forEach((h) => { const d = Math.abs(y(h.p.y) - my); if (d < nd) { nd = d; nearest = h; } });
      return { k, hits, nearest };
    };

    g.append('rect').attr('class', 'st-overlay').attr('x', -6).attr('y', -6).attr('width', iw + 12).attr('height', ih + 12)
      .on('mousemove', (event) => {
        const { k, hits, nearest } = hitAt(event);
        const cx = keyX(k);
        hoverG.style('display', null);
        cross.attr('x1', cx).attr('x2', cx);
        dots.style('display', (s) => (s.byKey.has(k) ? null : 'none'))
          .attr('cx', cx)
          .attr('cy', (s) => (s.byKey.has(k) ? y(s.points[s.byKey.get(k)].y) : 0))
          .attr('fill', (s) => {
            if (!model.single || !cfg.colorByGrowth) return model.single ? cfg.lineColor : s.color;
            const j = s.byKey.get(k);
            return j > 0 ? toneColor(change(s.points[j].y, s.points[j - 1].y).tone) : cfg.lineColor;
          });

        if (cfg.tooltipMode === 'custom') showTooltip(event, hits);
        else if (cfg.tooltipMode === 'tableau' && nearest && nearest.p.tupleId && nearest.p.tupleId !== lastHoverTuple) {
          lastHoverTuple = nearest.p.tupleId;
          worksheet.hoverTupleAsync(nearest.p.tupleId, { tooltipAnchorPoint: { x: event.pageX, y: event.pageY } }).catch(() => {});
        }
      })
      .on('mouseleave', () => {
        hoverG.style('display', 'none');
        hideTooltip();
        if (cfg.tooltipMode === 'tableau' && lastHoverTuple) {
          lastHoverTuple = 0;
          worksheet.hoverTupleAsync(0, { tooltipAnchorPoint: { x: 0, y: 0 } }).catch(() => {});
        }
      })
      .on('click', (event) => {
        const { nearest } = hitAt(event);
        const id = nearest && nearest.p.tupleId;
        const ids = nearest && nearest.p.tupleIds ? nearest.p.tupleIds.filter(Boolean) : [id];
        const anchor = { tooltipAnchorPoint: { x: event.pageX, y: event.pageY } };
        if (!id || (id === selectedTuple && !(event.ctrlKey || event.metaKey))) {
          selectedTuple = 0;
          worksheet.selectTuplesAsync([], tableau.SelectOptions.Simple, anchor).catch(() => {});
          return;
        }
        selectedTuple = id;
        const opt = event.ctrlKey || event.metaKey ? tableau.SelectOptions.Toggle : tableau.SelectOptions.Simple;
        worksheet.selectTuplesAsync(ids, opt, anchor).catch(() => {});
      });
  }

  function showTooltip (event, hits) {
    if (!hits.length) { hideTooltip(); return; }
    const tt = $('tooltip');
    const head = escapeHtml(hits[0].p.xLabel);
    const sorted = model.single ? hits : [...hits].sort((a, b) => b.p.y - a.p.y);
    const rows = sorted.map(({ s, j, p }) => {
      let color = model.single ? cfg.lineColor : s.color;
      if (model.single && cfg.colorByGrowth && j > 0) color = toneColor(change(p.y, s.points[j - 1].y).tone);
      let delta = '';
      if (j > 0) {
        const prev = s.points[j - 1];
        const c = change(p.y, prev.y);
        const pct = fmtPct(c.pct);
        const sign = c.delta > 0 ? '+' : c.delta < 0 ? '−' : '';
        delta = `<div class="st-tt-delta ${c.tone}">${arrow(c.dir)} ${pct ? sign + pct + ' (' + fmtDelta(c.delta) + ')' : fmtDelta(c.delta)} vs ${escapeHtml(prev.xLabel)}</div>`;
      } else {
        delta = '<div class="st-tt-delta flat">First period</div>';
      }
      return `<div class="st-tt-row"><i style="background:${color}"></i><span class="st-tt-name">${escapeHtml(model.single ? model.valueName : s.name)}</span><span class="st-tt-val">${escapeHtml(p.yLabel || fmtNum(p.y, null, false))}</span>${delta}</div>`;
    }).join('');

    let extra = '';
    if (model.single) {
      const { j, p, s } = hits[0];
      const items = (p.extras || []).filter((e) => e.value !== '');
      const first = s.points[0];
      if (j > 0 && cfg.kpiCompare === 'first') {
        const c = change(p.y, first.y);
        items.unshift({ name: `vs ${first.xLabel}`, value: `${arrow(c.dir)} ${c.pct !== null ? (c.delta < 0 ? '−' : '+') + fmtPct(c.pct) : fmtDelta(c.delta)}` });
      }
      if (items.length) extra = `<div class="st-tt-extra">${items.map((e) => `<div><span>${escapeHtml(e.name)}</span><b>${escapeHtml(e.value)}</b></div>`).join('')}</div>`;
    } else {
      const total = hits.reduce((a, h) => a + h.p.y, 0);
      extra = `<div class="st-tt-extra"><div><span>Total</span><b>${escapeHtml(fmtNum(total, null, true))}</b></div></div>`;
    }

    tt.innerHTML = `<div class="st-tt-head">${head}</div>${rows}${extra}`;
    tt.hidden = false;
    const r = tt.getBoundingClientRect();
    let left = event.clientX + 14;
    let top = event.clientY - r.height / 2;
    if (left + r.width > window.innerWidth - 4) left = event.clientX - r.width - 14;
    top = Math.max(4, Math.min(top, window.innerHeight - r.height - 4));
    tt.style.left = Math.max(4, left) + 'px';
    tt.style.top = top + 'px';
  }

  function hideTooltip () { const tt = $('tooltip'); if (tt) tt.hidden = true; }

  // ---------------------------------------------------------------- settings panel
  function loadSettings () {
    let saved = {};
    try {
      const raw = tableau.extensions.settings.get('config');
      if (raw) saved = JSON.parse(raw);
    } catch (e) { /* no saved settings */ }
    if (saved.compareMode && !saved.kpiCompare) saved.kpiCompare = saved.compareMode; // v1.0 settings
    cfg = { ...DEFAULTS, ...saved };
  }

  // Opens format.html in a Tableau dialog. The dialog saves settings itself (live preview),
  // which fires SettingsChanged here, so we only need to re-read on close.
  async function openFormatDialog () {
    const url = new URL('format.html', window.location.href).href;
    const ctx = model && !model.empty && !model.error ? {
      xType: model.xType,
      grain: model.grain,
      rawGrain: model.rawGrain,
      hasKpiShelf: !!model.kpiShelf,
      kpiShelfNames: model.kpiShelf ? [model.kpiShelf.name, model.kpiShelf.compareName].filter(Boolean) : [],
      single: model.single,
      valueName: model.valueName,
      latest: model.totals[model.totals.length - 1].xLabel
    } : {};
    try {
      await tableau.extensions.ui.displayDialogAsync(url, JSON.stringify({ ctx, defaults: DEFAULTS }), { width: 460, height: 680 });
    } catch (e) {
      if (!(tableau.ErrorCodes && e.errorCode === tableau.ErrorCodes.DialogClosedByUser)) console.error(e);
    }
    loadSettings();
    hasAnimated = true;
    rebuild();
    render();
  }

  // ---------------------------------------------------------------- helpers
  function showEmpty (html) {
    const el = $('empty');
    el.innerHTML = `<div>${html}</div>`;
    el.hidden = false;
  }

  function escapeHtml (s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  function debounce (fn, ms) {
    let t;
    return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  }

  const fmtDay = d3.utcFormat('%d %b');
  const fmtMonth = d3.utcFormat('%b');
  const fmtYear = d3.utcFormat('%Y');
  const fmtHour = d3.utcFormat('%H:%M');
  function utcMultiFormat (date) {
    return (d3.utcDay(date) < date ? fmtHour
      : d3.utcMonth(date) < date ? fmtDay
        : d3.utcYear(date) < date ? fmtMonth
          : fmtYear)(date);
  }

  init();
})();
