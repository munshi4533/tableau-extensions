/* Multi Measure Trend – Tableau Viz Extension
 * Several measures against one date/period. Each measure is a line (solid / dashed / dotted),
 * an area or bars, with its own color, curve, labels and left or right axis.
 * Encodings: date (1), measures (up to 10). Tableau's Tooltip / Detail tiles add tooltip rows.
 */
/* global d3, tableau, ExtMenu */
'use strict';

(function () {
  const PALETTE = ['#2a78d6', '#e34948', '#eb6834', '#1baf7a', '#6250d6', '#eda100', '#e87ba4', '#008300'];
  const DEFAULTS = {
    title: '', // empty = automatic ("A vs B")
    subtitle: 'range', // range | none
    showHeader: true,
    legend: 'top', // top | bottom | none
    legendValues: true, // latest value next to each name
    yAxis: 'auto', // auto | zero | fit
    leftTitle: '',
    rightTitle: '',
    showGrid: true,
    dateFormat: 'auto',
    tooltipMode: 'custom', // custom | tableau | off
    tooltipCompare: 'previous', // previous | first | none
    higherIsBetter: true,
    background: 'transparent',
    bgColor: '#ffffff',
    titleSize: 14,
    legendSize: 11,
    xAxisSize: 10,
    yAxisSize: 10,
    labelSize: 10,
    animate: true,
    measures: {} // field name -> per-measure settings (see measureDefaults)
  };
  const measureDefaults = (i) => ({
    label: '',
    color: PALETTE[i % PALETTE.length],
    type: 'line', // line | area | bar
    style: i % 2 ? 'dashed' : 'solid', // solid | dashed | dotted
    width: 2,
    curve: 'straight', // straight | smooth | step
    axis: 'left', // left | right
    points: false,
    labels: 'none', // none | last | minmax | all
    hidden: false
  });

  let cfg = { ...DEFAULTS };
  let worksheet = null;
  let model = null;
  let lastData = null;
  let lastEnc = null;
  let hasAnimated = false;
  const hiddenNow = new Set(); // measures switched off by clicking the legend (this session only)
  let lastHoverTuple = 0;

  const $ = (id) => document.getElementById(id);
  const size = (k, d) => +cfg[k] || d;

  // ================================================================ init
  async function init () {
    try {
      await tableau.extensions.initializeAsync({ configure: openFormatDialog });
    } catch (e) {
      showEmpty('<b>Could not start the extension.</b><br>' + esc(e.message || e));
      return;
    }
    worksheet = tableau.extensions.worksheetContent.worksheet;
    if (!model) document.body.classList.add('is-first-load');
    loadSettings();
    worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, refresh);
    try { worksheet.addEventListener(tableau.TableauEventType.FilterChanged, refresh); } catch (e) { /* not in this host */ }
    watchParameters();
    try {
      tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, () => { loadSettings(); hasAnimated = true; rebuild(); render(); });
    } catch (e) { /* not available */ }
    // redraw only when the chart area really changed size (not after our own header/legend updates)
    const ro = new ResizeObserver(debounce(() => {
      const c = $('chart');
      if (model && (c.clientWidth !== drawnSize.w || c.clientHeight !== drawnSize.h)) render();
    }, 60));
    ro.observe(document.body); ro.observe($('chart'));
    // a sheet that loads hidden (dashboard tab, show/hide container) has no size yet: draw when it appears
    document.addEventListener('visibilitychange', () => { if (!document.hidden && model && !drawnSize.w) render(); });
    ExtMenu.attach(() => { hideTooltip(); return [ExtMenu.authoring() && { label: 'Format Extension…', icon: 'format', action: openFormatDialog }]; });
    load();
  }

  const EVENT_MERGE_MS = 40;
  let loading = false; let loadAgain = false; let eventTimer = 0;
  function refresh () { clearTimeout(eventTimer); eventTimer = setTimeout(load, EVENT_MERGE_MS); }
  // Smooth updates when other sheets filter this one (dashboard actions, filters, parameters):
  //  - Tableau can answer with no rows while it is still applying a filter: keep the cards and ask again
  //    (shows "No data" only when it stays empty);
  //  - the same data again (duplicate events, selections) does not redraw anything.
  let lastSig = ''; let emptyTries = 0;
  let selfSelectAt = 0; // time of our own selectTuplesAsync (a click on a bar)
  const EMPTY_WAITS = [400, 800, 1500, 3000, 4500];
  let updTimer = 0;
  function setUpdating (on) {
    clearTimeout(updTimer);
    let badge = document.getElementById('updating');
    if (on && !badge) { badge = document.createElement('div'); badge.id = 'updating'; badge.className = 'ext-updating'; badge.innerHTML = '<i></i>Updating…'; document.body.appendChild(badge); }
    document.body.classList.toggle('is-updating', !!on);
  }
  async function load () {
    if (loading) { loadAgain = true; return; }
    loading = true; loadAgain = false;
    let changed = false; let waiting = false;
    // a slow answer (Tableau Server): show "Updating…" after a moment instead of looking frozen
    // (not for the reload Tableau sends after our own click: that would fade the point you just clicked)
    if (lastData) updTimer = setTimeout(() => { if (Date.now() - selfSelectAt > 4000) setUpdating(true); }, 450); // checked when it fires: the click may come a moment later
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [data, enc] = await Promise.all([getRows(), getEncodings()]);
        // Tableau Server can answer "no rows" for several seconds on a cold filter query: keep the chart
        // (faded, "Updating…") and ask again with growing gaps, ~10 s in total, before showing "No data"
        if (!data.rows.length && lastData && lastData.rows.length && emptyTries < EMPTY_WAITS.length) {
          setUpdating(true); setTimeout(refresh, EMPTY_WAITS[emptyTries++]); waiting = true; break;
        }
        emptyTries = 0;
        const sig = signature(data, enc);
        if (sig !== lastSig || !model || model.error) { lastSig = sig; lastData = data; lastEnc = enc; model = buildModel(data, enc); changed = true; }
        break;
      } catch (e) {
        console.error(e);
        if (loadAgain) break;
        if (attempt === 0) { await new Promise((r) => setTimeout(r, 300)); continue; }
        if (!lastData) { model = { error: e.message || String(e) }; changed = true; }
      }
    }
    loading = false;
    document.body.classList.remove('is-first-load');
    if (!waiting) setUpdating(false);
    if (changed) render();
    if (loadAgain) load();
  }
  // quick fingerprint of the data (fields + every value) to skip redraws when nothing changed
  function signature ({ rows, columns }, enc) {
    let h = 2166136261;
    const add = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } };
    add(JSON.stringify(Object.keys(enc).map((k) => [k, (enc[k] || []).map((f) => f.name)])));
    add(columns.map((c) => c.fieldName).join('|'));
    for (const r of rows) for (const c of columns) { const dv = r[c.fieldName]; add(dv ? String(dv.value) + '\u0001' + (dv.formattedValue ?? '') : ''); }
    return rows.length + ':' + (h >>> 0);
  }
  async function watchParameters () {
    try {
      const list = await worksheet.getParametersAsync();
      list.forEach((p) => p.addEventListener(tableau.TableauEventType.ParameterChanged, () => { refresh(); setTimeout(refresh, 800); }));
    } catch (e) { /* parameters not available */ }
  }


  function rebuild () { if (lastData) { try { model = buildModel(lastData, lastEnc); } catch (e) { model = { error: e.message }; } } }

  async function getRows () {
    const reader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true, applyWorksheetFormatting: true });
    const rows = []; let columns = []; let offset = 0;
    try {
    for (let p = 0; p < reader.pageCount; p++) {
      const page = await reader.getPageAsync(p);
      columns = page.columns;
      page.data.forEach((d, i) => {
        const row = { __tupleId: offset + i + 1 };
        for (const c of columns) row[c.fieldName] = d[c.index];
        rows.push(row);
      });
      offset += page.data.length;
    }
    } finally { await reader.releaseAsync().catch(() => {}); } // always release, or every later load fails
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
    const mKeys = mFields.map(key).filter(Boolean);
    if (!dateK || !mKeys.length) throw new Error('Could not find the fields in the sheet data (' + [!dateK && dateF.name, !mKeys.length && mFields.map((f) => f.name).join(', ')].filter(Boolean).join('; ') + ').');
    const used = new Set([dateK, ...mKeys]);
    const ttF = enc.tooltip || [];
    const extraKeys = (ttF.length ? ttF.map(key) : names.filter((n) => !used.has(n))).filter((k) => k && !used.has(k));

    const parsed = rows.map((r) => parseX(r[dateK]));
    const types = new Set(parsed.filter(Boolean).map((p) => p.t));
    const xType = types.size === 1 ? [...types][0] : 'ordinal';
    const order = []; const seen = new Set();
    const measures = mKeys.map((k, i) => ({ key: k, name: cleanName(k), index: i, byKey: new Map(), unit: null }));
    const extras = new Map(); // key -> [{name, value}]
    const tuples = new Map(); // key -> [tupleIds]
    const labels = new Map(); // key -> label

    rows.forEach((r, i) => {
      const px = parsed[i];
      if (!px) return;
      const lab = formatted(r[dateK]);
      const k = xType === 'ordinal' ? lab : +px.v;
      if (!seen.has(k)) { seen.add(k); order.push(k); labels.set(k, lab); }
      (tuples.get(k) || tuples.set(k, []).get(k)).push(r.__tupleId);
      for (const m of measures) {
        const dv = r[m.key];
        const y = toNumber(dv);
        if (y === null) continue;
        if (dv.formattedValue && (!m.sample || Math.abs(y) > Math.abs(m.sample.y))) m.sample = { text: dv.formattedValue, y }; // largest value: best for spotting K / Mn display units
        const prev = m.byKey.get(k);
        if (prev) { prev.y += y; prev.label = null; } else m.byKey.set(k, { y, label: dv.formattedValue });
      }
      if (extraKeys.length && !extras.has(k)) extras.set(k, extraKeys.map((ek) => ({ name: cleanName(ek), value: formatted(r[ek]) })).filter((e) => e.value !== ''));
    });
    measures.forEach((m) => { m.unit = m.sample ? detectUnit(m.sample.text, m.sample.y) : detectUnit(null); });
    const keys = xType === 'ordinal' ? order : order.slice().sort((a, b) => a - b);
    if (!keys.length) return { empty: true, noData: true };

    let grain = 'period';
    if (xType === 'time' && keys.length > 1) {
      const days = d3.median(d3.pairs(keys, (a, b) => b - a)) / 864e5;
      grain = days <= 1.5 ? 'day' : days <= 8 ? 'week' : days <= 32 ? 'month' : days <= 95 ? 'quarter' : 'year';
    }
    if (xType === 'time' && cfg.dateFormat !== 'tableau') keys.forEach((k) => labels.set(k, fmtDate(new Date(k), grain)));
    return { xType, keys, labels, measures, extras, tuples, grain, dateName: cleanName(dateF.name), dateField: dateF.name };
  }

  // a measure in a different unit than the first one (Margin % next to SAR, a count next to Mn) starts on the right axis
  const unitKind = (u) => (u ? (u.pct ? '%' : u.prefix + '|' + u.suffix) : '');
  function defaultsFor (m) {
    const d = measureDefaults(m.index);
    const first = model && model.measures && model.measures[0];
    const peak = (mm) => d3.max([...mm.byKey.values()], (p) => Math.abs(p.y)) || 0;
    const farApart = (a, b) => { const x = peak(a); const y = peak(b); return x > 0 && y > 0 && Math.max(x, y) / Math.min(x, y) > 20; };
    if (first && m !== first && unitKind(m.unit) !== unitKind(first.unit) && (m.unit.pct || first.unit.pct || farApart(m, first))) d.axis = 'right';
    return d;
  }
  function mcfg (m) { return { ...defaultsFor(m), ...((cfg.measures || {})[m.key] || {}) }; }
  function visibleMeasures () { return model.measures.filter((m) => !mcfg(m).hidden && !hiddenNow.has(m.key)); }
  const mName = (m) => mcfg(m).label || m.name;

  // ================================================================ render
  let drawnSize = { w: 0, h: 0 };
  function render () {
    try { renderInner(); const c = $('chart'); drawnSize = c.querySelector('svg') ? { w: c.clientWidth, h: c.clientHeight } : { w: 0, h: 0 }; } catch (e) {
      console.error(e);
      hideChrome(); $('chart').innerHTML = '';
      showEmpty('<b>Could not draw the chart.</b><br>' + esc(e.message || String(e)));
    }
  }
  function renderInner () {
    hideTooltip();
    applyStyle();
    const chartEl = $('chart');
    chartEl.innerHTML = '';
    if (!model) return;
    if (model.error) { hideChrome(); showEmpty('<b>Something went wrong.</b><br>' + esc(model.error)); return; }
    if (model.empty) {
      hideChrome();
      if (model.noData) showEmpty('<b>No data to plot.</b>');
      else showEmpty(`Drag ${[model.needDate && '<b>Date</b> (a date or period)', model.needMeasures && 'one or more measures to <b>Measures</b>'].filter(Boolean).join(' and ')} on the Marks card.<br><span style="color:var(--ink-3)">Style each measure (dashed, bars, colors, right axis) in Format Extension.</span>`);
      return;
    }
    $('empty').hidden = true;
    renderHeader();
    renderLegend();
    drawChart(chartEl);
  }

  function hideChrome () { $('header').hidden = true; $('legend').hidden = true; $('legendBottom').hidden = true; }

  function applyStyle () {
    const bg = cfg.background === 'white' ? '#ffffff' : cfg.background === 'custom' ? (cfg.bgColor || '#ffffff') : 'transparent';
    const root = document.documentElement.style;
    root.setProperty('--surface', bg);
    root.setProperty('--halo', bg === 'transparent' ? 'rgba(255,255,255,.85)' : bg);
    for (const [v, k, d] of [['--title-size', 'titleSize', 14], ['--legend-size', 'legendSize', 11], ['--x-size', 'xAxisSize', 10], ['--y-size', 'yAxisSize', 10], ['--label-size', 'labelSize', 10]]) root.setProperty(v, size(k, d) + 'px');
  }

  function renderHeader () {
    const h = $('header');
    h.hidden = !cfg.showHeader;
    if (h.hidden) return;
    const ms = model.measures;
    $('title').textContent = cfg.title || (ms.length === 1 ? mName(ms[0]) : ms.slice(0, 2).map(mName).join(' vs ') + (ms.length > 2 ? ` +${ms.length - 2}` : ''));
    const k = model.keys;
    $('subtitle').textContent = cfg.subtitle === 'none' ? '' : `${model.labels.get(k[0])} – ${model.labels.get(k[k.length - 1])} · ${k.length} ${model.grain === 'period' ? 'periods' : model.grain + 's'}`;
  }

  function swatch (m, w = 22, h = 10) {
    const c = mcfg(m);
    if (c.type === 'bar') return `<svg width="${w}" height="${h}"><rect x="${w / 2 - 5}" y="0" width="10" height="${h}" rx="2" fill="${c.color}"/></svg>`;
    const dash = dashArray(c.style, 2);
    const area = c.type === 'area' ? `<rect x="1" y="${h / 2}" width="${w - 2}" height="${h / 2}" fill="${c.color}" opacity=".25"/>` : '';
    return `<svg width="${w}" height="${h}">${area}<line x1="1" x2="${w - 1}" y1="${h / 2}" y2="${h / 2}" stroke="${c.color}" stroke-width="2.5" stroke-linecap="round" ${dash ? `stroke-dasharray="${dash}"` : ''}/></svg>`;
  }

  function latest (m) {
    for (let i = model.keys.length - 1; i >= 0; i--) { const p = m.byKey.get(model.keys[i]); if (p) return p; }
    return null;
  }

  function renderLegend () {
    const top = $('legend'); const bottom = $('legendBottom');
    top.hidden = true; bottom.hidden = true;
    if (cfg.legend === 'none') return;
    const el = cfg.legend === 'bottom' ? bottom : top;
    el.hidden = false;
    el.innerHTML = model.measures.filter((m) => !mcfg(m).hidden).map((m) => {
      const l = latest(m);
      const val = cfg.legendValues && l ? ` <b>${esc(l.label || fmtNum(l.y, m.unit, true))}</b>` : '';
      return `<span class="item${hiddenNow.has(m.key) ? ' off' : ''}" data-k="${esc(m.key)}" title="Click to show / hide">${swatch(m)}<span>${esc(mName(m))}</span>${val}</span>`;
    }).join('');
    el.onclick = (e) => {
      const it = e.target.closest('[data-k]');
      if (!it) return;
      const k = it.dataset.k;
      if (hiddenNow.has(k)) hiddenNow.delete(k); else hiddenNow.add(k);
      hasAnimated = true; render();
    };
  }

  function dashArray (style, w) {
    if (style === 'dashed') return `${w * 3} ${w * 2.2}`;
    if (style === 'dotted') return `0.1 ${w * 2.4}`;
    return null;
  }
  function curveOf (c) { return c.curve === 'smooth' ? d3.curveMonotoneX : c.curve === 'step' ? d3.curveStepAfter : d3.curveLinear; }

  function drawChart (chartEl) {
    const W = chartEl.clientWidth; const H = chartEl.clientHeight;
    if (W < 80 || H < 60) return;
    const vis = visibleMeasures();
    const { keys, xType } = model;
    const left = vis.filter((m) => mcfg(m).axis !== 'right');
    const right = vis.filter((m) => mcfg(m).axis === 'right');
    const ys = size('yAxisSize', 10); const xs = size('xAxisSize', 10); const ls = size('labelSize', 10);

    const domainFor = (ms) => {
      const vals = [].concat(...ms.map((m) => [...m.byKey.values()].map((p) => p.y)));
      if (!vals.length) return null;
      let [a, b] = d3.extent(vals);
      const hasBar = ms.some((m) => mcfg(m).type !== 'line');
      let zero = cfg.yAxis === 'zero' || hasBar;
      if (!hasBar && cfg.yAxis === 'auto') { const dist = a > 0 ? a : b < 0 ? -b : 0; zero = b < 0 ? false : dist <= 1.5 * (b - a); }
      if (zero) { a = Math.min(0, a); b = Math.max(0, b); }
      if (a === b) { a -= Math.abs(a || 1) * 0.1; b += Math.abs(b || 1) * 0.1; }
      const pad = (b - a) * 0.06;
      if (!(zero && a === 0)) a -= pad;
      if (!(zero && b === 0)) b += pad;
      return [a, b];
    };
    const ticksN = Math.max(2, Math.floor(H / 50));
    const unitOf = (ms) => (ms[0] ? ms[0].unit : null);
    const dL = domainFor(left.length ? left : vis); const dR = right.length ? domainFor(right) : null;
    const yL = d3.scaleLinear().domain(dL || [0, 1]).nice(ticksN);
    const yR = dR ? d3.scaleLinear().domain(dR).nice(ticksN) : null;
    const wOf = (sc, u) => (sc ? d3.max(sc.ticks(ticksN).map((v) => fmtNum(v, u, true).length)) * 0.62 * ys : 0);
    const m = {
      top: ls + 8,
      right: (yR ? wOf(yR, unitOf(right)) + 14 : 12) + (cfg.rightTitle && yR ? ys + 6 : 0),
      bottom: xs + 16,
      left: wOf(yL, unitOf(left.length ? left : vis)) + 12 + (cfg.leftTitle ? ys + 6 : 0)
    };
    const iw = Math.max(20, W - m.left - m.right); const ih = Math.max(20, H - m.top - m.bottom);
    yL.range([ih, 0]); if (yR) yR.range([ih, 0]);
    const yOf = (mm) => (mcfg(mm).axis === 'right' && yR ? yR : yL);

    // x scale (bars need half a step of room at both ends)
    const bars = vis.filter((mm) => mcfg(mm).type === 'bar');
    let x;
    const pad = bars.length ? Math.min(40, iw / Math.max(1, keys.length) / 2) : 0;
    if (xType === 'time') x = d3.scaleUtc().domain(d3.extent(keys, (k) => new Date(k))).range([pad, iw - pad]);
    else if (xType === 'number') x = d3.scaleLinear().domain(d3.extent(keys)).range([pad, iw - pad]);
    else x = d3.scalePoint().domain(keys).range([0, iw]).padding(bars.length ? 0.5 : 0.1);
    if (keys.length === 1 && xType !== 'ordinal') x.range([iw / 2, iw / 2]);
    const kx = (k) => (xType === 'ordinal' ? x(k) : x(xType === 'time' ? new Date(k) : k));
    const xs0 = keys.map(kx);
    const step = keys.length > 1 ? d3.min(d3.pairs(xs0, (a, b) => b - a)) : iw / 2;

    const svg = d3.select(chartEl).append('svg').attr('width', W).attr('height', H);
    try { svg.attr('class', tableau.ClassNameKey.Worksheet); } catch (e) { /* older API */ }
    const defs = svg.append('defs');
    const g = svg.append('g').attr('transform', `translate(${m.left},${m.top})`);

    // axes
    g.append('g').attr('class', 'mt-yaxis')
      .call(d3.axisLeft(yL).ticks(ticksN).tickSize(cfg.showGrid ? -iw : 0).tickPadding(6).tickFormat((v) => fmtNum(v, unitOf(left.length ? left : vis), true)))
      .call((a) => a.select('.domain').remove());
    if (yR) {
      g.append('g').attr('class', 'mt-yaxis').attr('transform', `translate(${iw},0)`)
        .call(d3.axisRight(yR).ticks(ticksN).tickSize(0).tickPadding(6).tickFormat((v) => fmtNum(v, unitOf(right), true)))
        .call((a) => a.select('.domain').remove());
    }
    if (cfg.leftTitle) g.append('text').attr('class', 'mt-axis-title').attr('transform', `translate(${-m.left + ys},${ih / 2}) rotate(-90)`).attr('text-anchor', 'middle').text(cfg.leftTitle);
    if (cfg.rightTitle && yR) g.append('text').attr('class', 'mt-axis-title').attr('transform', `translate(${iw + m.right - 4},${ih / 2}) rotate(90)`).attr('text-anchor', 'middle').text(cfg.rightTitle);

    const xAxis = d3.axisBottom(x).tickSizeOuter(0).tickSize(4).tickPadding(6);
    const maxLab = d3.max(keys, (k) => String(model.labels.get(k)).length) || 1;
    const fit = Math.max(2, Math.floor(iw / (maxLab * 0.62 * xs + 14)));
    if (xType === 'time' && model.grain === 'day' && keys.length > fit) xAxis.ticks(Math.max(2, Math.floor(iw / 90)));
    else {
      const every = Math.ceil(keys.length / fit);
      const tv = keys.filter((_, i) => i % every === 0);
      xAxis.tickValues(xType === 'time' ? tv.map((k) => new Date(k)) : tv)
        .tickFormat((v) => { const k = xType === 'time' ? +v : v; return model.labels.get(k) ?? String(v); });
    }
    if (xType === 'time' && model.grain === 'day' && keys.length > fit) xAxis.tickFormat(d3.utcFormat('%-d %b'));
    g.append('g').attr('class', 'mt-xaxis').attr('transform', `translate(0,${ih})`).call(xAxis)
      .call((a) => a.selectAll('.tick line').attr('stroke', 'var(--axis)'));

    const plot = g.append('g');
    const animate = cfg.animate && !hasAnimated && !document.hidden; // no draw-in in a background tab
    const series = vis.map((mm) => ({ m: mm, c: mcfg(mm), pts: keys.map((k) => { const p = mm.byKey.get(k); return p ? { k, y: p.y, label: p.label } : null; }) }));

    // areas first, then bars, then lines on top
    series.filter((s) => s.c.type === 'area').forEach((s, i) => {
      const y = yOf(s.m);
      const base = y(Math.min(y.domain()[1], Math.max(y.domain()[0], 0)));
      const id = `mt-grad-${i}`;
      const lg = defs.append('linearGradient').attr('id', id).attr('x1', 0).attr('x2', 0).attr('y1', 0).attr('y2', 1);
      lg.append('stop').attr('offset', '0%').attr('stop-color', s.c.color).attr('stop-opacity', 0.28);
      lg.append('stop').attr('offset', '100%').attr('stop-color', s.c.color).attr('stop-opacity', 0.03);
      plot.append('path').attr('class', 'mt-area').attr('fill', `url(#${id})`)
        .attr('d', d3.area().defined((p) => p).curve(curveOf(s.c)).x((p) => kx(p.k)).y0(base).y1((p) => y(p.y))(s.pts));
    });
    const barSeries = series.filter((s) => s.c.type === 'bar');
    if (barSeries.length) {
      const group = Math.max(2, step * 0.72);
      const bw = Math.max(1, group / barSeries.length - (barSeries.length > 1 ? 2 : 0));
      barSeries.forEach((s, j) => {
        const y = yOf(s.m);
        const zero = y(Math.min(y.domain()[1], Math.max(y.domain()[0], 0)));
        plot.append('g').selectAll('rect').data(s.pts.filter(Boolean)).join('rect')
          .attr('class', 'mt-bar')
          .attr('x', (p) => kx(p.k) - group / 2 + j * (group / barSeries.length) + 1)
          .attr('width', bw)
          .attr('y', (p) => Math.min(y(p.y), zero))
          .attr('height', (p) => Math.max(1, Math.abs(zero - y(p.y))))
          .attr('rx', Math.min(3, bw / 3))
          .attr('fill', s.c.color).attr('opacity', 0.9);
      });
    }
    series.filter((s) => s.c.type !== 'bar').forEach((s) => {
      const y = yOf(s.m);
      const w = +s.c.width || 2;
      plot.append('path').attr('class', 'mt-line')
        .attr('d', d3.line().defined((p) => p).curve(curveOf(s.c)).x((p) => kx(p.k)).y((p) => y(p.y))(s.pts))
        .attr('stroke', s.c.color).attr('stroke-width', w)
        .attr('stroke-dasharray', dashArray(s.c.style, w))
        .attr('data-dash', dashArray(s.c.style, w) || '');
      if (s.c.points) {
        plot.append('g').selectAll('circle').data(s.pts.filter(Boolean)).join('circle')
          .attr('cx', (p) => kx(p.k)).attr('cy', (p) => y(p.y)).attr('r', Math.max(2.5, w)).attr('fill', s.c.color)
          .attr('stroke', 'var(--halo)').attr('stroke-width', 1.5);
      }
    });

    drawLabels(plot, series, { kx, yOf, iw, ih, m });

    if (animate) {
      plot.selectAll('.mt-line').each(function () {
        const len = this.getTotalLength ? this.getTotalLength() : 0;
        if (!len) return;
        const el = d3.select(this); const dash = el.attr('data-dash') || null;
        el.attr('stroke-dasharray', `${len} ${len}`).attr('stroke-dashoffset', len)
          .transition().duration(900).ease(d3.easeCubicOut).attr('stroke-dashoffset', 0)
          .on('end', function () { d3.select(this).attr('stroke-dasharray', dash).attr('stroke-dashoffset', null); });
      });
      plot.selectAll('.mt-bar').attr('opacity', 0).transition().duration(600).attr('opacity', 0.9);
      plot.selectAll('.mt-area, .mt-label').attr('opacity', 0).transition().delay(400).duration(600).attr('opacity', 1);
      hasAnimated = true;
    }

    setupHover(g, { iw, ih, kx, yOf, series, xs0 });
  }

  // value labels: last / high & low / all, greedily placed so they never overlap
  function drawLabels (plot, series, { kx, yOf, iw, ih, m }) {
    const ls = size('labelSize', 10);
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = `600 ${ls}px ${getComputedStyle(document.body).fontFamily}`;
    const placed = [];
    const cands = [];
    series.forEach((s) => {
      if (s.c.labels === 'none') return;
      const pts = s.pts.filter(Boolean);
      if (!pts.length) return;
      let hi = pts[0]; let lo = pts[0];
      pts.forEach((p) => { if (p.y > hi.y) hi = p; if (p.y < lo.y) lo = p; });
      const last = pts[pts.length - 1];
      pts.forEach((p) => {
        const isLast = p === last; const ext = p === hi || p === lo;
        if (s.c.labels === 'last' && !isLast) return;
        if (s.c.labels === 'minmax' && !ext) return;
        cands.push({ s, p, prio: (isLast ? 0 : ext ? 1 : 2), above: p === lo ? false : true });
      });
    });
    cands.sort((a, b) => a.prio - b.prio);
    for (const c of cands) {
      const y = yOf(c.s.m);
      const cx = kx(c.p.k); const cy = y(c.p.y);
      const text = c.p.label && c.s.c.type !== 'bar' && c.s.labelsFull ? c.p.label : fmtNum(c.p.y, c.s.m.unit, true);
      const w = ctx.measureText(text).width + 4;
      for (const side of c.above ? ['above', 'below'] : ['below', 'above']) {
        const x0 = Math.max(0, Math.min(cx - w / 2, iw - w));
        const top = side === 'above' ? cy - ls - 7 : cy + 5;
        const r = { x0, x1: x0 + w, y0: top, y1: top + ls + 2 };
        if (r.y0 < -m.top + 2 || r.y1 > ih) continue;
        if (placed.some((q) => r.x0 < q.x1 && r.x1 > q.x0 && r.y0 < q.y1 && r.y1 > q.y0)) continue;
        placed.push(r);
        plot.append('text').attr('class', 'mt-label').attr('x', x0 + w / 2).attr('y', top + ls).attr('text-anchor', 'middle')
          .attr('fill', c.s.c.color).text(text);
        break;
      }
    }
  }

  // ================================================================ hover, tooltip, selection
  function setupHover (g, { iw, ih, kx, yOf, series, xs0 }) {
    const keys = model.keys;
    const hov = g.append('g').style('display', 'none');
    const cross = hov.append('line').attr('class', 'mt-cross').attr('y1', 0).attr('y2', ih);
    const dots = hov.selectAll('circle').data(series.filter((s) => s.c.type !== 'bar')).join('circle').attr('class', 'mt-dot').attr('r', 4.5).attr('fill', (s) => s.c.color);
    const nearest = (mx) => { let b = 0; let bd = Infinity; xs0.forEach((x0, i) => { const d = Math.abs(x0 - mx); if (d < bd) { bd = d; b = i; } }); return b; };
    g.append('rect').attr('class', 'mt-overlay').attr('x', -4).attr('y', -4).attr('width', iw + 8).attr('height', ih + 8)
      .on('mousemove', (ev) => {
        const [mx] = d3.pointer(ev, g.node());
        const i = nearest(mx); const k = keys[i];
        hov.style('display', null);
        cross.attr('x1', kx(k)).attr('x2', kx(k));
        dots.style('display', (s) => (s.pts[i] ? null : 'none')).attr('cx', kx(k)).attr('cy', (s) => (s.pts[i] ? yOf(s.m)(s.pts[i].y) : 0));
        if (cfg.tooltipMode === 'custom') showTooltip(ev, i, series);
        else if (cfg.tooltipMode === 'tableau') {
          const id = (model.tuples.get(k) || [])[0];
          if (id && id !== lastHoverTuple) { lastHoverTuple = id; worksheet.hoverTupleAsync(id, { tooltipAnchorPoint: { x: ev.pageX, y: ev.pageY } }).catch(() => {}); }
        }
      })
      .on('mouseleave', () => {
        hov.style('display', 'none'); hideTooltip();
        if (lastHoverTuple) { lastHoverTuple = 0; worksheet.hoverTupleAsync(0, { tooltipAnchorPoint: { x: 0, y: 0 } }).catch(() => {}); }
      })
      .on('click', (ev) => {
        const [mx] = d3.pointer(ev, g.node());
        const ids = model.tuples.get(keys[nearest(mx)]) || [];
        const opt = ev.ctrlKey || ev.metaKey ? tableau.SelectOptions.Toggle : tableau.SelectOptions.Simple;
        selfSelectAt = Date.now(); worksheet.selectTuplesAsync(ids, opt, { tooltipAnchorPoint: { x: ev.pageX, y: ev.pageY } }).catch(() => {});
      });
  }

  function change (curr, base) {
    const delta = curr - base;
    const pct = base !== 0 ? delta / Math.abs(base) : null;
    const dir = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat';
    const tone = dir === 'flat' ? 'flat' : ((dir === 'up') === !!cfg.higherIsBetter ? 'good' : 'bad');
    return { delta, pct, dir, tone };
  }

  function showTooltip (ev, i, series) {
    const k = model.keys[i];
    const rows = []; const first = series[0];
    series.forEach((s, j) => {
      const p = s.pts[i];
      const val = p ? (p.label || fmtNum(p.y, s.m.unit, false)) : '–';
      let delta = '';
      if (p && cfg.tooltipCompare === 'previous') {
        let b = null; let bk = null;
        for (let q = i - 1; q >= 0; q--) if (s.pts[q]) { b = s.pts[q]; bk = model.keys[q]; break; }
        if (b) delta = deltaHtml(change(p.y, b.y), s.m.unit, `vs ${model.labels.get(bk)}`);
      } else if (p && cfg.tooltipCompare === 'first' && j > 0 && first.pts[i] && comparable(s, first)) {
        delta = deltaHtml(change(p.y, first.pts[i].y), s.m.unit, `vs ${mName(first.m)}`);
      }
      rows.push(`<div class="mt-tt-row">${swatch(s.m, 20, 10)}<span class="mt-tt-name">${esc(mName(s.m))}</span><span class="mt-tt-val">${esc(val)}</span>${delta}</div>`);
    });
    if (cfg.tooltipCompare === 'first' && series.length > 1 && series[0].pts[i]) {
      // first measure compared with the second one, so the reference row has context too
      const s = series[0]; const o = series[1];
      if (o.pts[i] && comparable(s, o)) rows[0] = rows[0].replace('</div>', deltaHtml(change(s.pts[i].y, o.pts[i].y), s.m.unit, `vs ${mName(o.m)}`) + '</div>');
    }
    const ex = model.extras.get(k) || [];
    const extra = ex.length ? `<div class="mt-tt-extra">${ex.map((e) => `<div><span>${esc(e.name)}</span><b>${esc(e.value)}</b></div>`).join('')}</div>` : '';
    const tt = $('tooltip');
    let head = String(model.labels.get(k));
    if (model.xType !== 'time' && /^\d+$/.test(head)) head = /^DAY\(/i.test(model.dateField) ? `Day ${head}` : `${model.dateName} ${head}`; // "17" -> "Day 17"
    tt.innerHTML = `<div class="mt-tt-head">${esc(head)}</div>${rows.join('')}${extra}`;
    tt.hidden = false;
    const r = tt.getBoundingClientRect();
    let left = ev.clientX + 14;
    if (left + r.width > window.innerWidth - 4) left = ev.clientX - r.width - 14;
    tt.style.left = Math.max(4, left) + 'px';
    tt.style.top = Math.max(4, Math.min(ev.clientY - r.height / 2, window.innerHeight - r.height - 4)) + 'px';
  }

  // only compare measures of the same kind (same axis, both % or both amounts)
  function comparable (a, b) { return a.c.axis === b.c.axis && !!a.m.unit.pct === !!b.m.unit.pct; }

  function deltaHtml (c, unit, caption) {
    const sign = c.delta > 0 ? '+' : c.delta < 0 ? '−' : '';
    const arrow = c.dir === 'up' ? '▲' : c.dir === 'down' ? '▼' : '■';
    const pct = c.pct === null ? '' : `${sign}${Math.abs(c.pct * 100) >= 100 ? Math.round(Math.abs(c.pct * 100)) : Math.abs(c.pct * 100).toFixed(1)}% `;
    const abs = unit && unit.pct ? `${sign}${Math.abs(c.delta * 100).toFixed(1)} pp` : `${sign}${fmtNum(Math.abs(c.delta), unit, true)}`;
    return `<div class="mt-tt-delta ${c.tone}">${arrow} ${pct}(${esc(abs)}) ${esc(caption)}</div>`;
  }
  function hideTooltip () { const t = $('tooltip'); if (t) t.hidden = true; }

  // ================================================================ settings + dialog
  function loadSettings () {
    let saved = {};
    try { const raw = tableau.extensions.settings.get('config'); if (raw) saved = JSON.parse(raw); } catch (e) { /* none */ }
    cfg = { ...DEFAULTS, ...saved };
    cfg.measures = cfg.measures || {};
  }

  async function openFormatDialog () {
    const url = new URL('format.html' + window.location.search, window.location.href).href;
    const ctx = model && model.measures ? { measures: model.measures.map((mm) => ({ key: mm.key, name: mm.name, def: defaultsFor(mm) })), xType: model.xType } : { measures: [] };
    try {
      await tableau.extensions.ui.displayDialogAsync(url, JSON.stringify({ ctx, defaults: DEFAULTS }), { width: 520, height: 720 });
    } catch (e) {
      if (!(tableau.ErrorCodes && e.errorCode === tableau.ErrorCodes.DialogClosedByUser)) console.error(e);
    }
    loadSettings(); hasAnimated = true; rebuild(); render();
  }

  // ================================================================ helpers
  function parseX (dv) {
    if (!dv) return null;
    const nv = dv.nativeValue;
    if (nv === null || nv === undefined || nv === '%null%') return null;
    if (nv instanceof Date && !isNaN(nv)) return { t: 'time', v: nv };
    if (typeof nv === 'number') return { t: 'number', v: nv };
    const s = typeof dv.value === 'string' ? dv.value : '';
    const mm = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}):?(\d{2})?)?/);
    if (mm) return { t: 'time', v: new Date(Date.UTC(+mm[1], +mm[2] - 1, +mm[3], +(mm[4] || 0), +(mm[5] || 0), +(mm[6] || 0))) };
    return { t: 'ordinal', v: formatted(dv) };
  }
  const DATE_FORMATS = { 'mmm-yyyy': '%b %Y', 'mmmm-yyyy': '%B %Y', 'yyyy-mm': '%Y-%m', 'dd-mmm-yyyy': '%-d %b %Y', yyyy: '%Y' };
  function fmtDate (d, grain) {
    if (DATE_FORMATS[cfg.dateFormat]) return d3.utcFormat(DATE_FORMATS[cfg.dateFormat])(d);
    if (grain === 'year') return d3.utcFormat('%Y')(d);
    if (grain === 'quarter') return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
    if (grain === 'month') return d3.utcFormat('%b %Y')(d);
    return d3.utcFormat('%-d %b %Y')(d);
  }
  function toNumber (dv) {
    if (!dv) return null;
    const v = typeof dv.nativeValue === 'number' ? dv.nativeValue : (dv.nativeValue === null ? NaN : Number(dv.value));
    return Number.isFinite(v) ? v : null;
  }
  const formatted = (dv) => (dv ? String(dv.formattedValue ?? dv.value ?? '') : '');
  function resolve (name, names) {
    if (names.includes(name)) return name;
    const lc = String(name).toLowerCase(); const cn = cleanName(name).toLowerCase();
    return names.find((n) => n.toLowerCase() === lc) || names.find((n) => cleanName(n).toLowerCase() === cn) || names.find((n) => n.toLowerCase().includes(cn)) || null;
  }
  const cleanName = (n) => String(n || '').replace(/^(SUM|AVG|MIN|MAX|CNT|CNTD|COUNT|COUNTD|MEDIAN|ATTR|AGG|YEAR|QUARTER|MONTH|WEEK|DAY|MY|MDY|TMN|TQR|TYR|TDY)\((.*)\)$/i, '$2');
  // Reads prefix/suffix from Tableau's formatted text, and the display scale by comparing the text
  // with the real value: "892 Mn" for 892,000,000 -> scale 1e6, so our own numbers print the same way.
  function detectUnit (sample, value) {
    if (!sample) return { prefix: '', suffix: '', pct: false, scale: 1, decimals: null };
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
  function fmtNum (v, unit, compact) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    const u = unit || { prefix: '', suffix: '', pct: false };
    let n = u.pct ? v * 100 : v;
    const neg = n < 0; n = Math.abs(n);
    let body;
    if (u.pct) body = d3.format(',.1f')(n);
    else if (u.scale > 1) { // same display unit as Tableau (e.g. 892 Mn); small numbers get a decimal or two
      const q = n / u.scale;
      body = q === 0 ? '0' : d3.format(`,.${Math.max(u.decimals || 0, q < 1 ? 2 : q < 10 ? 1 : 0)}${compact ? '~' : ''}f`)(q); // axis ticks: 2.5M not 2.50M
    } else if (compact && n >= 1000) body = d3.format('.3~s')(n).replace('G', 'B');
    else body = d3.format(n >= 100 ? ',.0f' : ',.2~f')(n);
    return (neg ? '−' : '') + u.prefix + body + u.suffix;
  }
  function showEmpty (html) { const el = $('empty'); el.innerHTML = `<div>${html}</div>`; el.hidden = false; }
  function esc (s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
  function debounce (fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  { const v = document.querySelector('meta[name="ext-version"]'); console.log('[' + document.title + '] version', v ? v.content : '?'); }
  init();
})();
