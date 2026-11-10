/* Bar List – Tableau Viz Extension
 * Ranked horizontal bars for one dimension: value and % of total, Top N + Others, several KPIs
 * (switch buttons; calculated KPIs from a formula), optional Breakdown (segments) and Target.
 * Encodings: category (1), measures (up to 10), breakdown (1), target (1). Tooltip / Detail tiles add tooltip rows.
 */
/* global d3, tableau, ExtMenu, KpiFormula */
'use strict';

(function () {
  const PALETTE = ['#2a78d6', '#eb6834', '#1baf7a', '#6250d6', '#eda100', '#e87ba4', '#008300', '#e34948'];
  const NULL_COLOR = '#c9c8c2';
  const NULL_NAMES = ['', 'null', '%null%', 'not available', 'n/a', 'na', 'unknown', '(blank)', 'none'];
  const DEFAULTS = {
    title: '', // '' = the dimension name
    showTitle: true,
    titleAlign: 'center', // left | center
    kpi: '', // default KPI (measure field or 'c:<id>'); '' = first
    switcher: true, // KPI buttons when there are several
    sort: 'desc', // desc | asc | alpha | tableau
    topN: 0, // 0 = all
    others: true, // group the rest as "Others"
    nullLast: true, // Null / Not Available at the bottom, in grey
    labelContent: 'both', // both (value | %) | value | pct | none
    labelPos: 'auto', // auto (right of the bar, under it when it does not fit) | end | below | inside
    thickness: 'thin', // thin | normal | thick
    corners: 'pill', // square | slight | rounded | pill
    track: 'none', // none | full (light bar to the longest) | target
    colorMode: 'single', // single | top | scale | category
    barColor: '#2a78d6',
    labelAlign: 'left', // category labels: left | right
    labelSize: 11, valueSize: 11, titleSize: 14,
    labelColor: '#0b0b0b', valueColor: '#0b0b0b',
    valueWeight: '400',
    background: 'transparent', bgColor: '#ffffff',
    measures: {}, // field -> { label, format, decimals, prefix, suffix, pctOfTotal }
    calcs: [] // [{ id, label, formula, format, decimals, prefix, suffix }]
  };
  const KPI = { label: '', format: 'auto', decimals: 'auto', prefix: '', suffix: '', pctOfTotal: 'auto' };

  let cfg = { ...DEFAULTS };
  let worksheet = null;
  let model = null; let lastData = null; let lastEnc = null;
  let viewerKpi = null;
  const formulaCache = new Map();
  const $ = (id) => document.getElementById(id);

  // ================================================================ init + data
  async function init () {
    try { await tableau.extensions.initializeAsync({ configure: openFormatDialog }); } catch (e) { showEmpty('<b>Could not start the extension.</b><br>' + esc(e.message || e)); return; }
    worksheet = tableau.extensions.worksheetContent.worksheet;
    loadSettings();
    worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, refresh);
    try { worksheet.addEventListener(tableau.TableauEventType.FilterChanged, refresh); } catch (e) { /* n/a */ }
    watchParameters();
    // click an empty spot to clear the selection
    document.addEventListener('click', (e) => { if (selected && !e.target.closest('.bl-row, .bl-switch')) clearSelection(); });
    try { tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, () => { loadSettings(); rebuild(); render(); }); } catch (e) { /* n/a */ }
    const ro = new ResizeObserver(debounce(() => { const c = $('rows'); if (model && (c.clientWidth !== drawn.w || c.clientHeight !== drawn.h)) render(); }, 60));
    ro.observe(document.body); ro.observe($('rows'));
    ExtMenu.attach(() => { hideTooltip(); return [ExtMenu.authoring() && { label: 'Format Extension…', icon: 'format', action: openFormatDialog }]; });
    load();
  }
  let loading = false; let loadAgain = false; let eventTimer = 0;
  function refresh () { clearTimeout(eventTimer); eventTimer = setTimeout(load, 40); }
  // Smooth updates when other sheets filter this one: Tableau can answer with no rows while it is still
  // applying a filter, so keep the bars and ask again; the same data again does not redraw anything.
  let lastSig = ''; let emptyTries = 0;
  async function load () {
    if (loading) { loadAgain = true; return; }
    loading = true; loadAgain = false;
    let changed = false;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [data, enc] = await Promise.all([getRows(), getEncodings()]);
        if (!data.rows.length && lastData && lastData.rows.length && emptyTries < 3) { emptyTries++; setTimeout(refresh, 350 * emptyTries); break; }
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
    if (changed) render();
    if (loadAgain) load();
  }
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
        page.data.forEach((d, i) => { const row = { __tupleId: offset + i + 1 }; for (const c of columns) row[c.fieldName] = d[c.index]; rows.push(row); });
        offset += page.data.length;
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
    const catF = enc.category && enc.category[0];
    const mF = enc.measures || [];
    if (!catF || !mF.length) return { empty: true, needCat: !catF, needMeasures: !mF.length };
    const names = columns.map((c) => c.fieldName);
    const taken = new Set();
    const key = (f) => { if (!f) return null; const k = resolve(f.name, names.filter((n) => !taken.has(n))) || resolve(f.name, names); if (k) taken.add(k); return k; };
    const catK = key(catF);
    const brF = enc.breakdown && enc.breakdown[0]; const brK = key(brF);
    const tgF = enc.target && enc.target[0]; const tgK = key(tgF);
    const measures = mF.map(key).filter(Boolean).map((k, i) => ({ key: k, name: cleanName(k), index: i, sample: null }));
    const used = new Set([catK, brK, tgK, ...measures.map((m) => m.key)]);
    const extraKeys = names.filter((n) => !used.has(n));

    const cats = new Map(); // name -> { name, order, vals: {key: sum}, target, segs: Map, tuples: [], extras }
    const segNames = [];
    rows.forEach((r) => {
      const name = formatted(r[catK]);
      let c = cats.get(name);
      if (!c) { c = { name, order: cats.size, vals: {}, target: null, segs: new Map(), tuples: [], extras: new Map() }; cats.set(name, c); }
      c.tuples.push(r.__tupleId);
      for (const m of measures) {
        const dv = r[m.key]; const y = toNumber(dv);
        if (y === null) continue;
        c.vals[m.key] = (c.vals[m.key] || 0) + y;
        if (dv.formattedValue && (!m.sample || Math.abs(y) > Math.abs(m.sample.y))) m.sample = { text: dv.formattedValue, y };
      }
      if (tgK) { const t = toNumber(r[tgK]); if (t !== null) c.target = (c.target || 0) + t; }
      if (brK) {
        const s = formatted(r[brK]);
        if (!segNames.includes(s)) segNames.push(s);
        const seg = c.segs.get(s) || {};
        for (const m of measures) { const y = toNumber(r[m.key]); if (y !== null) seg[m.key] = (seg[m.key] || 0) + y; }
        c.segs.set(s, seg);
      }
      for (const k of extraKeys) { const dv = r[k]; if (dv && !c.extras.has(k)) c.extras.set(k, formatted(dv)); }
    });
    measures.forEach((m) => { m.unit = m.sample ? detectUnit(m.sample.text, m.sample.y) : detectUnit(null); });
    return { catName: cleanName(catF.name), measures, cats: [...cats.values()], segNames, hasBreakdown: !!brK, hasTarget: !!tgK, extraKeys };
  }

  // ---------------------------------------------------------------- KPIs
  function kpiList () {
    return [
      ...model.measures.map((m) => ({ id: m.key, kind: 'measure', m })),
      ...(cfg.calcs || []).map((c) => ({ id: 'c:' + c.id, kind: 'calc', c }))
    ];
  }
  function kcfg (k) { return k.kind === 'measure' ? { ...KPI, ...((cfg.measures || {})[k.m.key] || {}) } : { ...KPI, ...k.c }; }
  const kpiName = (k) => kcfg(k).label || (k.kind === 'measure' ? k.m.name : 'Calculated KPI');
  function currentKpi () {
    const list = kpiList();
    return list.find((k) => k.id === viewerKpi) || list.find((k) => k.id === cfg.kpi) || list[0];
  }
  function findMeasure (name) {
    const n = String(name).toLowerCase().trim();
    return model.measures.find((m) => m.key.toLowerCase() === n) || model.measures.find((m) => m.name.toLowerCase() === n) ||
      model.measures.find((m) => (((cfg.measures || {})[m.key] || {}).label || '').toLowerCase() === n) || null;
  }
  function compiled (f) { if (!formulaCache.has(f)) formulaCache.set(f, KpiFormula.compile(f)); return formulaCache.get(f); }
  function formulaProblem (f) {
    const c = compiled(f);
    if (c.error) return c.error;
    const miss = c.refs.filter((r) => !findMeasure(r));
    return miss.length ? `Unknown field ${miss.map((r) => `[${r}]`).join(', ')}` : null;
  }
  // value of a KPI from summed measure values (a category, a segment, Others or the total)
  function kpiValue (k, vals) {
    if (k.kind === 'measure') return vals[k.m.key] ?? null;
    if (formulaProblem(k.c.formula)) return null;
    return compiled(k.c.formula).run((n) => { const m = findMeasure(n); return m ? (vals[m.key] ?? null) : null; }, {});
  }
  function kpiUnit (k) {
    if (k.kind === 'measure') return k.m.unit;
    const f = compiled(k.c.formula || '');
    const first = f.refs && f.refs.length ? findMeasure(f.refs[0]) : null;
    return first ? { prefix: first.unit.pct ? '' : first.unit.prefix, suffix: '', pct: false, scale: 1, decimals: 0, calc: true } : null;
  }
  // % of total only makes sense for amounts and counts (not ratios or averages)
  function showsShare (k) {
    const c = kcfg(k);
    if (c.pctOfTotal === 'yes') return true;
    if (c.pctOfTotal === 'no') return false;
    if (k.kind === 'calc') return false;
    return !k.m.unit.pct && !/^(AVG|MEDIAN|MIN|MAX)\(/i.test(k.m.key);
  }

  // ---------------------------------------------------------------- rows to draw
  const isNull = (n) => NULL_NAMES.includes(String(n).trim().toLowerCase());
  function rowsFor (k) {
    const sum = (list, field) => { const o = {}; list.forEach((c) => { for (const key in c[field]) o[key] = (o[key] || 0) + c[field][key]; }); return o; };
    let list = model.cats.map((c) => ({ ...c, v: kpiValue(k, c.vals), isNull: isNull(c.name) }));
    const total = kpiValue(k, sum(model.cats, 'vals'));
    const byVal = (a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity);
    // Top N by value (Null / Not Available never takes a Top N place when it goes last)
    let rest = [];
    const n = +cfg.topN || 0;
    if (n > 0) {
      const ranked = list.filter((c) => !(cfg.nullLast && c.isNull)).sort(byVal);
      const keep = new Set(ranked.slice(0, n));
      rest = ranked.slice(n);
      list = list.filter((c) => keep.has(c) || (cfg.nullLast && c.isNull));
    }
    if (cfg.sort === 'desc') list.sort(byVal);
    else if (cfg.sort === 'asc') list.sort((a, b) => -byVal(a, b));
    else if (cfg.sort === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    else list.sort((a, b) => a.order - b.order);
    if (rest.length && cfg.others) {
      const vals = sum(rest, 'vals');
      const segs = new Map();
      rest.forEach((c) => c.segs.forEach((sv, s) => { const o = segs.get(s) || {}; for (const key in sv) o[key] = (o[key] || 0) + sv[key]; segs.set(s, o); }));
      const tg = rest.some((c) => c.target !== null) ? d3.sum(rest, (c) => c.target || 0) : null;
      list.push({ name: `Others (${rest.length})`, others: true, vals, segs, target: tg, v: kpiValue(k, vals), tuples: [].concat(...rest.map((c) => c.tuples)), extras: new Map() });
    }
    if (cfg.nullLast) list = [...list.filter((c) => !c.isNull), ...list.filter((c) => c.isNull)];
    return { list, total };
  }

  // ================================================================ render
  let drawn = { w: 0, h: 0 };
  function render () {
    try { renderInner(); const c = $('rows'); drawn = c.children.length ? { w: c.clientWidth, h: c.clientHeight } : { w: 0, h: 0 }; } catch (e) {
      console.error(e); $('rows').innerHTML = ''; showEmpty('<b>Could not draw the bars.</b><br>' + esc(e.message || String(e)));
    }
  }

  function renderInner () {
    hideTooltip(); applyStyle();
    const box = $('rows'); box.innerHTML = '';
    if (!model) return;
    if (model.error) { $('header').hidden = true; return showEmpty('<b>Something went wrong.</b><br>' + esc(model.error)); }
    if (model.empty) { $('header').hidden = true; return showEmpty(`Drag ${[model.needCat && 'a <b>Category</b> (dimension)', model.needMeasures && 'one or more <b>Measures</b>'].filter(Boolean).join(' and ')} onto the Marks card.`); }
    const k = currentKpi();
    if (k.kind === 'calc' && formulaProblem(k.c.formula)) return showEmpty('<b>' + esc(kpiName(k)) + '</b>: ' + esc(formulaProblem(k.c.formula)));
    $('empty').hidden = true;
    renderHeader(k);
    renderLegend();

    const { list, total } = rowsFor(k);
    if (!list.length) return showEmpty('<b>No data.</b>');
    const c = kcfg(k); const unit = kpiUnit(k);
    const fmt = (x) => fmtValue(x, c, unit);
    const share = showsShare(k) && total;
    const pctText = (v) => (share && v !== null ? fmtPct(v / total) : '');
    const label = (r) => {
      const val = fmt(r.v); const p = pctText(r.v);
      if (cfg.labelContent === 'none') return '';
      if (cfg.labelContent === 'value') return val;
      if (cfg.labelContent === 'pct') return p || val;
      return p ? `${val} | ${p}` : val;
    };

    // scale: bars relative to the longest bar (or its target), so the biggest fills the row
    const maxV = d3.max(list, (r) => Math.max(r.v || 0, cfg.track === 'target' ? (r.target || 0) : 0)) || 1;
    const W = box.clientWidth; const H = box.clientHeight;
    const font = (size, w) => `${w} ${size}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    const tw = (t, f) => { ctx.font = f; return ctx.measureText(t).width; };
    const labF = font(+cfg.labelSize || 11, 400); const valF = font(+cfg.valueSize || 11, cfg.valueWeight || 400);
    const labW = Math.min(W * 0.38, Math.max(40, d3.max(list, (r) => tw(r.name, labF)) + 10));
    const areaW = Math.max(40, W - labW - 8);
    const valW = d3.max(list, (r) => tw(label(r), valF)) + 8;
    // row height shares the zone; bar thickness follows the chosen style
    const rowH = Math.max(18, Math.min(64, H / list.length));
    const th = Math.max(2, Math.round({ thin: 5, normal: rowH * 0.42, thick: rowH * 0.66 }[cfg.thickness] || 5));
    const radius = { square: 0, slight: Math.min(3, th / 4), rounded: th * 0.3, pill: th / 2 }[cfg.corners] ?? th / 2;
    const pos = cfg.labelPos;
    const fullFor = pos === 'below' || pos === 'inside' ? areaW : areaW - valW; // bar room
    // with a track (or a target), labels need their own room at the right; without, long bars may put the label underneath
    const scaleW = pos === 'auto' && cfg.track === 'none' ? areaW : (pos === 'auto' ? areaW - valW : fullFor);
    const reserveBelow = pos === 'below' || pos === 'auto';
    const canBelow = rowH >= th + (+cfg.valueSize || 11) + 6;

    box.style.justifyContent = list.length * rowH > H + 1 ? 'flex-start' : ''; // many bars: scroll instead of squeezing
    list.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'bl-row' + (r.isNull && cfg.nullLast ? ' is-null' : '') + (r.others ? ' is-others' : '');
      el.dataset.name = r.name;
      el.style.height = rowH + 'px';
      el.style.gridTemplateColumns = `${labW}px 1fr`;
      const color = barColor(r, i, list, maxV);
      let w = r.v === null ? 0 : Math.max(r.v > 0 ? Math.min(th, 3) : 0, (Math.max(0, r.v) / maxV) * scaleW);
      // auto: right of the bar when it fits, otherwise under the bar's end (like a long "Not Available" bar)
      let where = pos;
      if (pos === 'auto') { where = w + valW <= areaW ? 'end' : (canBelow ? 'below' : 'end'); if (where === 'end' && w + valW > areaW) w = areaW - valW; }
      const trackW = cfg.track === 'full' ? scaleW : cfg.track === 'target' && r.target ? (r.target / maxV) * scaleW : 0;
      let bar = `<div class="bl-bar" style="width:${w}px;height:${th}px;border-radius:${radius}px;background:${model.hasBreakdown ? 'transparent' : color}">`;
      if (model.hasBreakdown && r.v) {
        bar += model.segNames.map((s, si) => { const sv = kpiValue(k, (r.segs.get(s) || {})); return sv > 0 ? `<i style="width:${(sv / r.v) * 100}%;background:${PALETTE[si % PALETTE.length]}" data-seg="${esc(s)}"></i>` : ''; }).join('');
      }
      bar += '</div>';
      // labels start after the bar, its target or the full track, whichever ends later
      const reach = cfg.track === 'full' && (where === 'end' || pos === 'auto') ? scaleW : Math.max(w, r.target ? (r.target / maxV) * scaleW + 2 : 0);
      if (cfg.track !== 'none' && where === 'below') where = 'end';
      const tick = r.target ? `<b class="bl-target" style="left:${(r.target / maxV) * scaleW}px;height:${th + 6}px"></b>` : '';
      const txt = label(r);
      const lab = txt ? `<span class="bl-val ${where}" style="${where === 'end' ? `left:${reach + 6}px` : where === 'below' ? `left:${Math.max(0, w - tw(txt, valF))}px;top:calc(50% + ${th / 2 + 2}px)` : 'left:6px'}">${esc(txt)}</span>` : '';
      el.innerHTML = `<div class="bl-lab ${cfg.labelAlign === 'right' ? 'right' : ''}" title="${esc(r.name)}">${esc(r.name)}</div>` +
        `<div class="bl-area">${trackW ? `<div class="bl-track" style="width:${trackW}px;height:${th}px;border-radius:${radius}px"></div>` : ''}${bar}${tick}${lab}</div>`;
      el.addEventListener('mousemove', (e) => showRowTip(e, r, k, total, fmt, share));
      el.addEventListener('mouseleave', hideTooltip);
      el.addEventListener('click', (e) => select(r, e));
      box.appendChild(el);
    });
    lastRows = list;
    if (selected) markSelection();
  }

  function barColor (r, i, list, maxV) {
    if (r.isNull && cfg.nullLast) return NULL_COLOR;
    if (r.others) return '#a5a49e';
    const base = cfg.barColor || PALETTE[0];
    if (cfg.colorMode === 'category') return PALETTE[i % PALETTE.length];
    if (cfg.colorMode === 'top') { const top = list.filter((x) => !x.isNull && !x.others).reduce((a, b) => ((b.v ?? -Infinity) > (a.v ?? -Infinity) ? b : a), list[0]); return r === top ? base : mix(base, '#ffffff', 0.55); }
    if (cfg.colorMode === 'scale') return mix(base, '#ffffff', 0.7 * (1 - Math.max(0, r.v || 0) / maxV));
    return base;
  }
  function mix (a, b, t) { const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); const x = p(a); const y = p(b); return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join(''); }

  function renderHeader (k) {
    const list = kpiList();
    const showSw = cfg.switcher && list.length > 1;
    const sw = $('switcher'); sw.hidden = !showSw;
    if (showSw) {
      sw.innerHTML = list.map((x) => `<button type="button" data-k="${esc(x.id)}" class="${x.id === k.id ? 'on' : ''}">${esc(kpiName(x))}</button>`).join('');
      sw.onclick = (e) => { const b = e.target.closest('[data-k]'); if (!b) return; viewerKpi = b.dataset.k; render(); };
    }
    $('title').textContent = cfg.showTitle ? (cfg.title || model.catName) : '';
    $('header').classList.toggle('center', cfg.titleAlign === 'center' && !showSw);
    $('header').hidden = !showSw && !cfg.showTitle;
  }
  function renderLegend () {
    const lg = $('legend');
    lg.hidden = !model.hasBreakdown;
    if (model.hasBreakdown) lg.innerHTML = model.segNames.map((s, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(s)}</span>`).join('');
  }

  function showRowTip (e, r, k, total, fmt, share) {
    const rows = [[kpiName(k), fmt(r.v), true]];
    if (share && r.v !== null) rows.push(['% of total', fmtPct(r.v / total)]);
    for (const x of kpiList()) if (x.id !== k.id) rows.push([kpiName(x), fmtValue(kpiValue(x, r.vals), kcfg(x), kpiUnit(x))]);
    if (r.target) rows.push(['Target', `${fmt(r.target)} · ${Math.round((r.v / r.target) * 100)}%`]);
    let html = `<div class="bl-tt-head">${esc(r.name)}</div>` + rows.map(([a, b, big]) => `<div class="bl-tt-row"><span>${esc(a)}</span><b class="${big ? 'big' : ''}">${esc(b)}</b></div>`).join('');
    const seg = e.target.closest && e.target.closest('[data-seg]');
    if (model.hasBreakdown) html += '<div class="bl-tt-sub">' + model.segNames.map((s, i) => { const sv = kpiValue(k, r.segs.get(s) || {}); return sv === null || sv === undefined ? '' : `<div class="bl-tt-row${seg && seg.dataset.seg === s ? ' hl' : ''}"><span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(s)}</span><b>${esc(fmt(sv))}${r.v ? ' · ' + fmtPct(sv / r.v) : ''}</b></div>`; }).join('') + '</div>';
    const ex = [...(r.extras || new Map()).entries()].filter(([, v]) => v !== '');
    if (ex.length) html += '<div class="bl-tt-sub">' + ex.map(([kk, v]) => `<div class="bl-tt-row"><span>${esc(cleanName(kk))}</span><b>${esc(v)}</b></div>`).join('') + '</div>';
    if (r.others) html += '<div class="bl-tt-sub">Everything outside the Top ' + (+cfg.topN) + '</div>';
    const tt = $('tooltip'); tt.innerHTML = html; tt.hidden = false;
    const b = tt.getBoundingClientRect();
    let x = e.clientX + 14; let y = e.clientY + 14;
    if (x + b.width > innerWidth - 4) x = e.clientX - b.width - 14;
    if (y + b.height > innerHeight - 4) y = Math.max(4, e.clientY - b.height - 14);
    tt.style.left = Math.max(4, x) + 'px'; tt.style.top = y + 'px';
  }
  // click a bar to select it in Tableau (dashboard filter / highlight actions); Cmd / Ctrl + click adds;
  // the same bar again (or an empty spot) clears
  let selected = null; // Set of category names
  let lastRows = [];
  function select (r, e) {
    const add = e.ctrlKey || e.metaKey;
    let next;
    if (add && selected) { next = new Set(selected); if (next.has(r.name)) next.delete(r.name); else next.add(r.name); } else if (selected && selected.size === 1 && selected.has(r.name)) next = new Set(); else next = new Set([r.name]);
    if (!next.size) { clearSelection(); return; }
    selected = next;
    const ids = [].concat(...lastRows.filter((x) => selected.has(x.name)).map((x) => x.tuples));
    worksheet.selectTuplesAsync(ids, tableau.SelectOptions.Simple, { tooltipAnchorPoint: { x: e.pageX, y: e.pageY } }).catch((er) => console.warn('Could not select', er));
    markSelection();
  }
  function clearSelection () {
    if (!selected) return;
    selected = null;
    worksheet.selectTuplesAsync([], tableau.SelectOptions.Simple, { tooltipAnchorPoint: { x: 0, y: 0 } }).catch(() => {});
    markSelection();
  }
  function markSelection () {
    document.querySelectorAll('.bl-row').forEach((x) => x.classList.toggle('dim', !!selected && !selected.has(x.dataset.name)));
  }

  // ================================================================ formatting
  function fmtPct (p) { if (!Number.isFinite(p)) return ''; const a = p * 100; return (Math.abs(a) >= 10 ? a.toFixed(1) : a.toFixed(2)) + '%'; }
  function fmtValue (v, c, unit) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    const neg = v < 0; const n = Math.abs(v);
    const dec = c.decimals === 'auto' || c.decimals === '' || c.decimals === undefined ? null : +c.decimals;
    const fx = (x, d) => d3.format(`,.${d}f`)(x);
    let body; let pre = c.prefix || ''; const suf = c.suffix || '';
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
      default:
        if (unit && unit.pct) body = fx(n * 100, dec ?? 1) + '%';
        else if (unit && unit.scale > 1) { const q = n / unit.scale; body = fx(q, dec ?? Math.max(unit.decimals || 0, q < 10 ? 1 : 0)) + unit.suffix; } else body = n >= 1e7 ? compact(dec) : fx(n, dec ?? (n >= 100 || (unit && !unit.calc && !unit.decimals) ? 0 : 2)) + (unit && !unit.calc ? unit.suffix : '');
        if (!c.prefix && unit) pre = unit.prefix;
    }
    return (neg ? '−' : '') + pre + body + suf;
  }

  // ================================================================ chrome + settings
  function applyStyle () {
    const bg = cfg.background === 'white' ? '#ffffff' : cfg.background === 'custom' ? (cfg.bgColor || '#ffffff') : 'transparent';
    const r = document.documentElement.style;
    r.setProperty('--surface', bg);
    r.setProperty('--label-size', (+cfg.labelSize || 11) + 'px'); r.setProperty('--value-size', (+cfg.valueSize || 11) + 'px'); r.setProperty('--title-size', (+cfg.titleSize || 14) + 'px');
    r.setProperty('--label-color', cfg.labelColor || '#0b0b0b'); r.setProperty('--value-color', cfg.valueColor || '#0b0b0b'); r.setProperty('--value-weight', cfg.valueWeight || '400');
  }
  function hideTooltip () { const t = $('tooltip'); if (t) t.hidden = true; }
  function showEmpty (html) { const el = $('empty'); el.innerHTML = `<div>${html}</div>`; el.hidden = false; }
  function loadSettings () {
    let saved = {};
    try { const raw = tableau.extensions.settings.get('config'); if (raw) saved = JSON.parse(raw); } catch (e) { /* none */ }
    cfg = { ...DEFAULTS, ...saved }; cfg.measures = cfg.measures || {}; cfg.calcs = cfg.calcs || [];
  }
  async function openFormatDialog () {
    const url = new URL('format.html' + window.location.search, window.location.href).href;
    const ctx = model && model.measures ? { measures: model.measures.map((m) => ({ key: m.key, name: m.name })), hasBreakdown: model.hasBreakdown, hasTarget: model.hasTarget } : { measures: [] };
    try { await tableau.extensions.ui.displayDialogAsync(url, JSON.stringify({ ctx, defaults: DEFAULTS, kpi: KPI }), { width: 560, height: 760 }); } catch (e) { if (!(tableau.ErrorCodes && e.errorCode === tableau.ErrorCodes.DialogClosedByUser)) console.error(e); }
    loadSettings(); rebuild(); render();
  }

  // ================================================================ helpers
  const ctx = document.createElement('canvas').getContext('2d');
  function toNumber (dv) { if (!dv) return null; const v = typeof dv.nativeValue === 'number' ? dv.nativeValue : (dv.nativeValue === null ? NaN : Number(dv.value)); return Number.isFinite(v) ? v : null; }
  const formatted = (dv) => (dv ? String(dv.formattedValue ?? dv.value ?? '') : '');
  function resolve (name, names) {
    if (names.includes(name)) return name;
    const lc = String(name).toLowerCase(); const cn = cleanName(name).toLowerCase();
    return names.find((n) => n.toLowerCase() === lc) || names.find((n) => cleanName(n).toLowerCase() === cn) || names.find((n) => n.toLowerCase().includes(cn)) || null;
  }
  const cleanName = (n) => String(n || '').replace(/^(SUM|AVG|MIN|MAX|CNT|CNTD|COUNT|COUNTD|MEDIAN|ATTR|AGG)\((.*)\)$/i, '$2');
  function detectUnit (sample, value) {
    if (!sample) return { prefix: '', suffix: '', pct: false, scale: 1, decimals: 0 };
    const s = String(sample).trim();
    const prefix = (s.match(/^[^\d\-−(.]*/) || [''])[0]; const suffix = (s.match(/[^\d.,)]*$/) || [''])[0];
    const pct = /%\s*$/.test(s);
    const num = (s.match(/\d[\d,]*(\.\d+)?/) || [''])[0]; const shown = parseFloat(num.replace(/,/g, ''));
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
