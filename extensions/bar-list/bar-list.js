/* Bar List – Tableau Viz Extension
 * Ranked horizontal bars for one dimension: value and % of total, Top N + Others, several KPIs
 * (switch buttons; calculated KPIs from a formula), optional Breakdown (segments) and Target.
 * Encodings: category (up to 4: drill-down Category → Sub-Category …), measures (up to 10), breakdown (1), target (1).
 * Tooltip / Detail tiles add tooltip rows.
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
    expandLevel: 0, // drill-down (several dimensions on Category): levels open at the start, 0 = only the first level
    childTopN: 0, // Top N inside an opened bar (0 = all)
    childPct: 'parent', // sub-bars show % of: parent | total
    expandButtons: true, // Expand all / Collapse all buttons in the header
    subShade: true, // sub-bars a lighter shade of their parent's color
    labelContent: 'both', // both (value | %) | value | pct | none
    labelPos: 'auto', // auto (right of the bar, under it when it does not fit) | end | below | inside
    thickness: 'thin', // thin | normal | thick | custom
    barSize: 10, // bar height in px when thickness = custom
    corners: 'pill', // square | slight | rounded | pill
    track: 'none', // none | full (light bar to the longest) | total (track = total of all bars, bars = their share) | target
    colorMode: 'single', // single | top | scale | category | gradient
    barColor: '#2a78d6',
    barColor2: '#1baf7a', // second color of the gradient
    gradientSpan: 'width', // width (the color shows how far a bar reaches) | bar (each bar runs color 1 → color 2)
    labelAlign: 'left', // category labels: left | right
    longNames: 'wrap', // long category names: wrap (up to 3 lines, the row grows) | cut (one line with …)
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
    if (!model) document.body.classList.add('is-first-load');
    worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, refresh);
    try { worksheet.addEventListener(tableau.TableauEventType.FilterChanged, refresh); } catch (e) { /* n/a */ }
    watchParameters();
    // the selection lives in Tableau: follow it when it changes elsewhere (or after Tableau reloads this extension)
    try { worksheet.addEventListener(tableau.TableauEventType.MarkSelectionChanged, () => { if (Date.now() - selfSelectAt > 2500) { needSync = true; if (!loading) { needSync = false; syncFromTableau(); } } }); } catch (e) { /* n/a */ }
    // click an empty spot to clear the selection
    document.addEventListener('click', (e) => { if (selected && !e.target.closest('.bl-row, .bl-switch, .bl-tree')) clearSelection(); });
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
    await selecting; // never read while Tableau is still applying our click (its tuple ids would change under it)
    // a slow answer (Tableau Server): show "Updating…" after a moment instead of looking frozen
    // (not for the reload Tableau sends after our own click: that would fade the bar you just highlighted)
    if (lastData) updTimer = setTimeout(() => { if (Date.now() - selfSelectAt > 4000) setUpdating(true); }, 450); // checked when it fires: the click may come a moment later
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [data, enc] = await Promise.all([getRows(), getEncodings()]);
        // Tableau Server can answer "no rows" for several seconds on a cold filter query: keep the chart
        // (faded, "Updating…") and ask again with growing gaps, ~10 s in total, before showing "No data"
        if (!data.rows.length && lastData && lastData.rows.length && emptyTries < EMPTY_WAITS.length) {
          if (Date.now() - selfSelectAt > 4000) setUpdating(true); // not right after our own click: keep the highlight visible setTimeout(refresh, EMPTY_WAITS[emptyTries++]); waiting = true; break;
        }
        emptyTries = 0;
        const sig = signature(data, enc);
        if (sig !== lastSig || !model || model.error) {
          lastSig = sig;
          const m2 = buildModel(data, enc);
          // one dashboard action that also targets this sheet: our own click filtered our own bars down to
          // the selected ones. Keep showing all bars (selected in color); remember the filtered data for its tuple ids.
          if (isSelfFilter(m2)) { liveModel = m2; } else { liveModel = null; lastData = data; lastEnc = enc; model = m2; changed = true; if (!selected && !needSync) saveBase(data); } // (not before we know Tableau's selection)
        }
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
    try { if (changed) render(); } catch (e) { console.error(e); }
    if (loadAgain) { load(); return; }
    // a click made while we were reading: send it now, with the tuple ids of the data just read
    if (awaitingFull && (!liveModel || Date.now() - awaitingFull > 15000)) awaitingFull = 0; // the clear went through: all bars are back
    if (selPending && !awaitingFull) { const a = selPending; selPending = null; sendSelection(a); } else if (needSync && model && model.cats) { needSync = false; syncFromTableau(); }
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
  const SEP = '\u001f'; // joins the names on a drill-down path (Category › Sub-Category …)
  function buildModel ({ rows, columns }, enc) {
    const catFs = enc.category || [];
    const mF = enc.measures || [];
    if (!catFs.length || !mF.length) return { empty: true, needCat: !catFs.length, needMeasures: !mF.length };
    // a dashboard filter can leave no rows: Tableau then sends no columns either (not an error)
    if (!rows.length) return { empty: true, noData: true };
    const names = columns.map((c) => c.fieldName);
    const taken = new Set();
    const key = (f) => { if (!f) return null; const k = resolve(f.name, names.filter((n) => !taken.has(n))) || resolve(f.name, names); if (k) taken.add(k); return k; };
    const catKs = catFs.map(key).filter(Boolean);
    const brF = enc.breakdown && enc.breakdown[0]; const brK = key(brF);
    const tgF = enc.target && enc.target[0]; const tgK = key(tgF);
    const measures = mF.map(key).filter(Boolean).map((k, i) => ({ key: k, name: cleanName(k), index: i, sample: null }));
    const used = new Set([...catKs, brK, tgK, ...measures.map((m) => m.key)]);
    const extraKeys = names.filter((n) => !used.has(n));

    // a tree: Category → Sub-Category → … ; every node sums the rows underneath it
    // node = { name, path, depth, order, vals: {key: sum}, target, segs: Map, tuples: [], extras, children: Map }
    const root = new Map();
    const segNames = [];
    const node = (map, name, path, depth) => {
      let c = map.get(name);
      if (!c) { c = { name, path, depth, order: map.size, vals: {}, target: null, segs: new Map(), tuples: [], extras: new Map(), children: new Map() }; map.set(name, c); }
      return c;
    };
    rows.forEach((r) => {
      const nums = measures.map((m) => toNumber(r[m.key]));
      measures.forEach((m, i) => { const dv = r[m.key]; const y = nums[i]; if (y !== null && dv.formattedValue && (!m.sample || Math.abs(y) > Math.abs(m.sample.y))) m.sample = { text: dv.formattedValue, y }; });
      const t = tgK ? toNumber(r[tgK]) : null;
      const s = brK ? formatted(r[brK]) : null;
      if (brK && !segNames.includes(s)) segNames.push(s);
      let map = root; let path = '';
      catKs.forEach((ck, depth) => {
        const name = formatted(r[ck]);
        path = depth ? path + SEP + name : name;
        const c = node(map, name, path, depth);
        c.tuples.push(r.__tupleId);
        measures.forEach((m, i) => { if (nums[i] !== null) c.vals[m.key] = (c.vals[m.key] || 0) + nums[i]; });
        if (t !== null) c.target = (c.target || 0) + t;
        if (brK) { const seg = c.segs.get(s) || {}; measures.forEach((m, i) => { if (nums[i] !== null) seg[m.key] = (seg[m.key] || 0) + nums[i]; }); c.segs.set(s, seg); }
        if (depth === catKs.length - 1) for (const k of extraKeys) { const dv = r[k]; if (dv && !c.extras.has(k)) c.extras.set(k, formatted(dv)); }
        map = c.children;
      });
    });
    const finish = (map) => [...map.values()].map((c) => { c.kids = finish(c.children); delete c.children; return c; });
    measures.forEach((m) => { m.unit = m.sample ? detectUnit(m.sample.text, m.sample.y) : detectUnit(null); });
    return {
      catName: cleanName(catFs[0].name), catKs, levelNames: catKs.map(cleanName), levels: catKs.length,
      measures, cats: finish(root), segNames, hasBreakdown: !!brK, hasTarget: !!tgK, extraKeys
    };
  }
  function eachNode (list, fn) { list.forEach((c) => { fn(c); if (c.kids) eachNode(c.kids, fn); }); }

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
  const sumField = (list, field) => { const o = {}; list.forEach((c) => { for (const key in c[field]) o[key] = (o[key] || 0) + c[field][key]; }); return o; };
  // one level: value, Top N (+ Others), sort, Null last
  function rankLevel (nodes, k, n, parent) {
    let list = nodes.map((c) => ({ ...c, v: kpiValue(k, c.vals), isNull: isNull(c.name), parent }));
    const byVal = (a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity);
    // Top N by value (Null / Not Available never takes a Top N place when it goes last)
    let rest = [];
    if (n > 0 && list.length > n + (cfg.others ? 1 : 0)) { // "Others (1)" would just be that one bar
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
      const vals = sumField(rest, 'vals');
      const segs = new Map();
      rest.forEach((c) => c.segs.forEach((sv, s) => { const o = segs.get(s) || {}; for (const key in sv) o[key] = (o[key] || 0) + sv[key]; segs.set(s, o); }));
      const tg = rest.some((c) => c.target !== null) ? d3.sum(rest, (c) => c.target || 0) : null;
      const name = `Others (${rest.length})`;
      const depth = parent ? parent.depth + 1 : 0;
      list.push({ name, path: parent ? parent.path + SEP + '\u0000others' : '\u0000others', depth, others: true, vals, segs, target: tg, v: kpiValue(k, vals), tuples: [].concat(...rest.map((c) => c.tuples)), members: rest.map((c) => c.path), extras: new Map(), kids: [], parent, hidden: rest.length });
    }
    if (cfg.nullLast) list = [...list.filter((c) => !c.isNull), ...list.filter((c) => c.isNull)];
    return list;
  }
  // the rows on screen: the first level, plus the children of every opened bar right under it
  function rowsFor (k) {
    const total = kpiValue(k, sumField(model.cats, 'vals'));
    const out = [];
    const walk = (nodes, parent) => {
      rankLevel(nodes, k, parent ? (+cfg.childTopN || 0) : (+cfg.topN || 0), parent).forEach((r) => {
        // a bar opens when it has sub-bars (not just itself again, like Not Available › Not Available)
        r.hasKids = !r.others && r.kids && r.kids.length > 0 && !(r.kids.length === 1 && r.kids[0].name === r.name && !r.kids[0].kids.length);
        out.push(r);
        if (r.hasKids && expanded.has(r.path)) walk(r.kids, r);
      });
    };
    walk(model.cats, null);
    return { list: out, total };
  }

  // drill-down: which bars are open (kept while the data refreshes; reset when the fields or the start level change)
  const expanded = new Set();
  let expandKey = '';
  function syncExpanded () {
    if (!model || !model.cats) return;
    const key = model.levelNames.join('|') + '#' + (+cfg.expandLevel || 0);
    if (key === expandKey) return;
    expandKey = key; expanded.clear();
    const lvl = +cfg.expandLevel || 0;
    if (lvl > 0) eachNode(model.cats, (c) => { if (c.depth < lvl && c.kids.length) expanded.add(c.path); });
  }
  function toggleNode (r) {
    if (!r.hasKids) return;
    if (expanded.has(r.path)) { for (const p of [...expanded]) if (p === r.path || p.startsWith(r.path + SEP)) expanded.delete(p); } else expanded.add(r.path);
    render();
  }
  function expandAll (open) {
    expanded.clear();
    if (open) eachNode(model.cats, (c) => { if (c.kids.length) expanded.add(c.path); });
    render();
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
    if (model.noData) { $('header').hidden = true; $('legend').hidden = true; return showEmpty('<b>No data</b> for the current filters.'); }
    if (model.empty) { $('header').hidden = true; return showEmpty(`Drag ${[model.needCat && 'a <b>Category</b> (dimension)', model.needMeasures && 'one or more <b>Measures</b>'].filter(Boolean).join(' and ')} onto the Marks card.`); }
    const k = currentKpi();
    if (!k) { $('header').hidden = true; return showEmpty('<b>No data</b> for the current filters.'); }
    if (k.kind === 'calc' && formulaProblem(k.c.formula)) return showEmpty('<b>' + esc(kpiName(k)) + '</b>: ' + esc(formulaProblem(k.c.formula)));
    $('empty').hidden = true;
    syncExpanded();
    renderHeader(k);
    renderLegend();

    const { list, total } = rowsFor(k);
    const tree = model.levels > 1;
    const INDENT = 14; const TOG = tree ? 16 : 0;
    if (!list.length) return showEmpty('<b>No data.</b>');
    const c = kcfg(k); const unit = kpiUnit(k);
    const fmt = (x) => fmtValue(x, c, unit);
    const share = showsShare(k) && total;
    // sub-bars: % of their parent bar (or of the total)
    const pctOf = (r) => (r.parent && cfg.childPct !== 'total' ? r.parent.v : total);
    const pctText = (r) => { const d = pctOf(r); return share && r.v !== null && d ? fmtPct(r.v / d) : ''; };
    const label = (r) => {
      const val = fmt(r.v); const p = pctText(r);
      if (cfg.labelContent === 'none') return '';
      if (cfg.labelContent === 'value') return val;
      if (cfg.labelContent === 'pct') return p || val;
      return p ? `${val} | ${p}` : val;
    };

    // scale: bars relative to the longest bar (or its target), so the biggest fills the row
    // "total" track: the track is the total of all bars and every bar fills its share (only for counts / sums)
    const useTotal = cfg.track === 'total' && share && total > 0;
    const trackMode = cfg.track === 'total' && !useTotal ? 'full' : cfg.track;
    const maxV = useTotal ? total : (d3.max(list, (r) => Math.max(r.v || 0, trackMode === 'target' ? (r.target || 0) : 0)) || 1);
    const W = box.clientWidth; const H = box.clientHeight;
    const font = (size, w) => `${w} ${size}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`;
    const tw = (t, f) => { ctx.font = f; return ctx.measureText(t).width; };
    const labF = font(+cfg.labelSize || 11, 400); const valF = font(+cfg.valueSize || 11, cfg.valueWeight || 400);
    // name column: wide enough for every level (measured over the whole tree, so opening a bar does not shift the bars)
    let nameW = d3.max(list, (r) => tw(r.name, labF) + r.depth * INDENT);
    if (tree) eachNode(model.cats, (c) => { if (c.depth <= Math.max(1, +cfg.expandLevel || 0)) nameW = Math.max(nameW, tw(c.name, labF) + c.depth * INDENT); });
    const labW = Math.min(W * 0.38, Math.max(40, nameW + TOG + 10));
    const areaW = Math.max(40, W - labW - 8);
    const valW = d3.max(list, (r) => tw(label(r), valF)) + 8;
    // long names: wrap onto up to 3 lines inside the name column (the row grows for them)
    const wrap = cfg.longNames !== 'cut';
    const lineH = Math.round((+cfg.labelSize || 11) * 1.25);
    const linesOf = (r) => {
      const room = labW - TOG - r.depth * INDENT - 4;
      if (!wrap || tw(r.name, labF) <= room) return 1;
      let n = 1; let line = '';
      for (const word of r.name.split(/\s+/)) {
        const tryLine = line ? line + ' ' + word : word;
        if (line && tw(tryLine, labF) > room) { n++; line = word; } else line = tryLine;
        while (tw(line, labF) > room && line.length > 1) { n++; line = line.slice(Math.max(1, Math.floor(line.length * room / tw(line, labF)))); } // one very long word
      }
      return Math.min(3, n);
    };
    list.forEach((r) => { r.lines = linesOf(r); r.need = r.lines * lineH + 6; });
    // row height shares the zone; rows with wrapped names take what they need, the others share the rest
    let rowH = Math.max(18, Math.min(64, H / list.length));
    for (let it = 0; it < 3; it++) {
      const tall = list.filter((r) => r.need > rowH);
      if (!tall.length || tall.length === list.length) break;
      rowH = Math.max(18, Math.min(64, (H - d3.sum(tall, (r) => r.need)) / (list.length - tall.length)));
    }
    if (cfg.thickness === 'custom') rowH = Math.max(rowH, Math.min(80, +cfg.barSize || 10) + 8);
    const hOf = (r) => Math.max(rowH, r.lines > 1 ? r.need : 0);
    const th = cfg.thickness === 'custom' ? Math.max(2, Math.min(80, +cfg.barSize || 10)) : Math.max(2, Math.round({ thin: 5, normal: rowH * 0.42, thick: rowH * 0.66 }[cfg.thickness] || 5));
    const radius = { square: 0, slight: Math.min(3, th / 4), rounded: th * 0.3, pill: th / 2 }[cfg.corners] ?? th / 2;
    const pos = cfg.labelPos;
    const fullFor = pos === 'below' || pos === 'inside' ? areaW : areaW - valW; // bar room
    // with a track (or a target), labels need their own room at the right; without, long bars may put the label underneath
    const scaleW = pos === 'auto' && trackMode === 'none' ? areaW : (pos === 'auto' ? areaW - valW : fullFor);
    const reserveBelow = pos === 'below' || pos === 'auto';
    const canBelowAt = (h) => h >= th + (+cfg.valueSize || 11) + 6;

    box.style.justifyContent = d3.sum(list, hOf) > H + 1 ? 'flex-start' : ''; // many bars: scroll instead of squeezing
    list.forEach((r, i) => {
      const el = document.createElement('div');
      el.className = 'bl-row' + (r.lines > 1 ? ' is-wrapped' : '') + (wrap ? ' wraps' : '') + (r.isNull && cfg.nullLast ? ' is-null' : '') + (r.others ? ' is-others' : '') + (r.depth ? ' is-sub' : '') + (r.hasKids ? ' has-kids' : '') + (expanded.has(r.path) ? ' is-open' : '');
      el.dataset.path = r.path;
      const rh = hOf(r); const canBelow = canBelowAt(rh);
      el.style.height = rh + 'px';
      el.style.gridTemplateColumns = `${labW}px 1fr`;
      const color = r.color = barColor(r, i, list, maxV);
      let w = r.v === null ? 0 : Math.max(r.v > 0 ? Math.min(th, 3) : 0, (Math.max(0, r.v) / maxV) * scaleW);
      // auto: right of the bar when it fits, otherwise under the bar's end (like a long "Not Available" bar)
      let where = pos;
      if (pos === 'auto') { where = w + valW <= areaW ? 'end' : (canBelow ? 'below' : 'end'); if (where === 'end' && w + valW > areaW) w = areaW - valW; }
      const trackW = trackMode === 'full' || trackMode === 'total' ? scaleW : trackMode === 'target' && r.target ? (r.target / maxV) * scaleW : 0;
      // two-color gradient: across the full width (a bar's end color shows how far it reaches) or along each bar
      const grad = cfg.colorMode === 'gradient' && !(r.isNull && cfg.nullLast) && !r.others;
      const fill = model.hasBreakdown ? 'transparent' : grad ? `linear-gradient(90deg, ${cfg.barColor || PALETTE[0]}, ${cfg.barColor2 || '#1baf7a'})${cfg.gradientSpan === 'bar' ? '' : ` 0 0 / ${scaleW}px 100% no-repeat`}` : color;
      let bar = `<div class="bl-bar" style="width:${w}px;height:${th}px;border-radius:${radius}px;background:${fill}">`;
      if (model.hasBreakdown && r.v) {
        bar += model.segNames.map((s, si) => { const sv = kpiValue(k, (r.segs.get(s) || {})); return sv > 0 ? `<i style="width:${(sv / r.v) * 100}%;background:${PALETTE[si % PALETTE.length]}" data-seg="${esc(s)}"></i>` : ''; }).join('');
      }
      bar += '</div>';
      // labels start after the bar, its target or the full track, whichever ends later
      const reach = (trackMode === 'full' || trackMode === 'total') && (where === 'end' || pos === 'auto') ? scaleW : Math.max(w, r.target ? (r.target / maxV) * scaleW + 2 : 0);
      if (trackMode !== 'none' && where === 'below') where = 'end';
      const tick = r.target ? `<b class="bl-target" style="left:${(r.target / maxV) * scaleW}px;height:${th + 6}px"></b>` : '';
      const txt = label(r);
      const lab = txt ? `<span class="bl-val ${where}" style="${where === 'end' ? `left:${reach + 6}px` : where === 'below' ? `left:${Math.max(0, w - tw(txt, valF) - 4)}px;top:calc(50% + ${th / 2 + 2}px)` : 'left:6px'}">${esc(txt)}</span>` : '';
      const tog = tree ? `<span class="bl-tog" style="margin-left:${r.depth * INDENT}px">${r.hasKids ? (expanded.has(r.path) ? '−' : '+') : ''}</span>` : '';
      el.innerHTML = `<div class="bl-lab ${cfg.labelAlign === 'right' ? 'right' : ''}" title="${esc(r.name)}">${tog}<span class="bl-name">${esc(r.name)}</span></div>` +
        `<div class="bl-area">${trackW ? `<div class="bl-track" style="width:${trackW}px;height:${th}px;border-radius:${radius}px"></div>` : ''}${bar}${tick}${lab}</div>`;
      el.addEventListener('mousemove', (e) => showRowTip(e, r, k, total, fmt, share));
      el.addEventListener('mouseleave', hideTooltip);
      el.addEventListener('click', (e) => {
        if (e.target.closest('.bl-tog')) { e.stopPropagation(); cancelPending(); toggleNode(r); return; }
        onRowClick(r, e);
      });
      box.appendChild(el);
    });
    lastRows = list;
    if (selected) markSelection();
  }

  function barColor (r, i, list, maxV) {
    if (r.isNull && cfg.nullLast) return NULL_COLOR;
    if (r.others) return '#a5a49e';
    const base = cfg.barColor || PALETTE[0];
    // sub-bars: their parent's color, a shade lighter (Darker-for-higher keeps working on its own)
    if (r.parent && r.parent.color && cfg.colorMode !== 'scale') return cfg.subShade ? mix(r.parent.color, '#ffffff', 0.3) : r.parent.color;
    if (cfg.colorMode === 'category') return PALETTE[list.filter((x) => !x.depth).indexOf(r) % PALETTE.length];
    if (cfg.colorMode === 'top') { const top = list.filter((x) => !x.depth && !x.isNull && !x.others).reduce((a, b) => ((b.v ?? -Infinity) > (a.v ?? -Infinity) ? b : a), list[0]); return r === top ? base : mix(base, '#ffffff', 0.55); }
    if (cfg.colorMode === 'scale') return mix(base, '#ffffff', 0.7 * (1 - Math.max(0, r.v || 0) / maxV));
    if (cfg.colorMode === 'gradient') return base;
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
    // drill-down: Expand all / Collapse all
    const tb = $('treeBtns'); const showTree = model.levels > 1 && cfg.expandButtons;
    tb.hidden = !showTree;
    if (showTree) {
      const anyOpen = expanded.size > 0;
      tb.innerHTML = `<button type="button" data-t="1" title="Open every bar to its ${esc(model.levelNames.slice(1).join(' / '))}"><span>+</span>Expand all</button><button type="button" data-t="0" ${anyOpen ? '' : 'disabled'}><span>−</span>Collapse</button>`;
      tb.onclick = (e) => { const b = e.target.closest('[data-t]'); if (b) { e.stopPropagation(); expandAll(b.dataset.t === '1'); } };
    }
    $('header').classList.toggle('center', cfg.titleAlign === 'center' && !showSw && !showTree);
    $('header').hidden = !showSw && !cfg.showTitle && !showTree;
  }
  function renderLegend () {
    const lg = $('legend');
    lg.hidden = !model.hasBreakdown;
    if (model.hasBreakdown) lg.innerHTML = model.segNames.map((s, i) => `<span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(s)}</span>`).join('');
  }

  function showRowTip (e, r, k, total, fmt, share) {
    const rows = [[kpiName(k), fmt(r.v), true]];
    if (share && r.v !== null && r.parent && r.parent.v) rows.push([`% of ${r.parent.name}`, fmtPct(r.v / r.parent.v)]);
    if (share && r.v !== null) rows.push(['% of total', fmtPct(r.v / total)]);
    for (const x of kpiList()) if (x.id !== k.id) rows.push([kpiName(x), fmtValue(kpiValue(x, r.vals), kcfg(x), kpiUnit(x))]);
    if (r.target) rows.push(['Target', `${fmt(r.target)} · ${Math.round((r.v / r.target) * 100)}%`]);
    const trail = []; for (let p = r.parent; p; p = p.parent) trail.unshift(p.name);
    let html = `<div class="bl-tt-head">${trail.length ? `<small>${esc(trail.join(' › '))} ›</small> ` : ''}${esc(r.name)}</div>` + rows.map(([a, b, big]) => `<div class="bl-tt-row"><span>${esc(a)}</span><b class="${big ? 'big' : ''}">${esc(b)}</b></div>`).join('');
    const seg = e.target.closest && e.target.closest('[data-seg]');
    if (model.hasBreakdown) html += '<div class="bl-tt-sub">' + model.segNames.map((s, i) => { const sv = kpiValue(k, r.segs.get(s) || {}); return sv === null || sv === undefined ? '' : `<div class="bl-tt-row${seg && seg.dataset.seg === s ? ' hl' : ''}"><span><i style="background:${PALETTE[i % PALETTE.length]}"></i>${esc(s)}</span><b>${esc(fmt(sv))}${r.v ? ' · ' + fmtPct(sv / r.v) : ''}</b></div>`; }).join('') + '</div>';
    const ex = [...(r.extras || new Map()).entries()].filter(([, v]) => v !== '');
    if (ex.length) html += '<div class="bl-tt-sub">' + ex.map(([kk, v]) => `<div class="bl-tt-row"><span>${esc(cleanName(kk))}</span><b>${esc(v)}</b></div>`).join('') + '</div>';
    // a closed bar: what is inside it (its sub-categories, largest first)
    if (r.hasKids && !expanded.has(r.path)) {
      const kids = r.kids.map((c) => ({ name: c.name, v: kpiValue(k, c.vals) })).sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
      const MAXK = 8; const shown = kids.slice(0, MAXK);
      html += `<div class="bl-tt-sub"><div class="bl-tt-cap">${esc(model.levelNames[r.depth + 1] || 'Inside')}</div>` +
        shown.map((c) => `<div class="bl-tt-row"><span>${esc(c.name)}</span><b>${esc(fmt(c.v))}${share && r.v && c.v !== null ? ' · ' + fmtPct(c.v / r.v) : ''}</b></div>`).join('') +
        (kids.length > MAXK ? `<div class="bl-tt-row"><span>+ ${kids.length - MAXK} more</span></div>` : '') + '</div>';
    }
    if (r.others) html += '<div class="bl-tt-sub">Everything outside the Top ' + (r.parent ? +cfg.childTopN : +cfg.topN) + '</div>';
    if (r.hasKids) html += `<div class="bl-tt-sub">${expanded.has(r.path) ? 'Double-click or − to close' : `Double-click or + to open its ${esc(model.levelNames[r.depth + 1] || 'details')}`}</div>`;
    const tt = $('tooltip'); tt.innerHTML = html; tt.hidden = false;
    const b = tt.getBoundingClientRect();
    let x = e.clientX + 14; let y = e.clientY + 14;
    if (x + b.width > innerWidth - 4) x = e.clientX - b.width - 14;
    if (y + b.height > innerHeight - 4) y = Math.max(4, e.clientY - b.height - 14);
    tt.style.left = Math.max(4, x) + 'px'; tt.style.top = y + 'px';
  }
  // click a bar to select it in Tableau (dashboard filter / highlight actions); Cmd / Ctrl + click adds;
  // the same bar again (or an empty spot) clears. A sub-bar selects its category + sub-category, a parent its whole group.
  // Bars that open (drill-down): a double-click opens / closes them, so their single click waits a moment.
  let selected = null; // Set of paths
  let lastRows = [];
  let pending = null; // { r, timer } a click waiting to see if it becomes a double-click
  function cancelPending () { if (pending) { clearTimeout(pending.timer); pending = null; } }
  function onRowClick (r, e) {
    if (!r.hasKids) { cancelPending(); select(r, e); return; }
    if (pending && pending.r.path === r.path) { cancelPending(); toggleNode(r); return; }
    cancelPending();
    const ev = { ctrlKey: e.ctrlKey, metaKey: e.metaKey, pageX: e.pageX, pageY: e.pageY };
    pending = { r, timer: setTimeout(() => { pending = null; select(r, ev); }, 260) };
  }
  let selecting = Promise.resolve(); // the selectTuplesAsync in flight
  let selPending = null; // a click made while data was being read
  let needSync = true; // read Tableau's selection once the first data is in (the extension may have been reloaded)
  function select (r, e) {
    const add = e.ctrlKey || e.metaKey;
    let next;
    if (add && selected) { next = new Set(selected); if (next.has(r.path)) next.delete(r.path); else next.add(r.path); } else if (selected && selected.size === 1 && selected.has(r.path)) next = new Set(); else next = new Set([r.path]);
    if (!next.size) { clearSelection(); return; }
    selected = next;
    markSelection();
    sendSelection({ x: e.pageX, y: e.pageY });
  }
  function clearSelection () {
    if (!selected) return;
    selected = null;
    markSelection();
    sendSelection({ x: 0, y: 0 });
  }
  // ---- self-filtering (one filter action on every sheet, this one included) ----
  let liveModel = null; // the data as Tableau has it now, filtered by our own selection (null = not filtered by it)
  let sentLeaves = new Set(); // leaves of the last selection sent to Tableau
  let awaitingFull = 0; // time we cleared the selection to reach a bar outside the filter; the new pick waits for all bars
  const nodeByPath = (m, path) => { let hit = null; if (m && m.cats) eachNode(m.cats, (c) => { if (c.path === path) hit = c; }); return hit; };
  const leafPaths = (m) => { const out = []; if (m && m.cats) eachNode(m.cats, (c) => { if (!c.kids || !c.kids.length) out.push(c.path); }); return out; };
  // the leaf bars (deepest level) under the selected bars of the model shown
  function selectedLeaves (sel) {
    const out = new Set();
    for (const p of sel || []) {
      const row = lastRows.find((x) => x.path === p);
      const paths = row && row.others ? row.members : [p];
      for (const q of paths) { const n = nodeByPath(model, q); if (n) eachNode([n], (c) => { if (!c.kids || !c.kids.length) out.add(c.path); }); }
    }
    return out;
  }
  // new data = only (some of) the bars we selected, fewer than we show: Tableau filtered us by our own click
  function isSelfFilter (m2) {
    if (!selected || !model || !model.cats || !m2 || !m2.cats || Date.now() - selfSelectAt > 600000) return false;
    const now = leafPaths(m2); const all = leafPaths(model);
    if (!now.length || now.length >= all.length) return false;
    const want = selectedLeaves(selected);
    return now.every((l) => want.has(l) || sentLeaves.has(l)); // (or what we selected before: mid-way through a change)
  }
  // tuple ids of a bar (a sub-bar that is closed now still has its node in the model)
  function tuplesOf (path) {
    const row = lastRows.find((x) => x.path === path);
    if (row) return row.tuples;
    const hit = nodeByPath(model, path);
    return hit ? hit.tuples : [];
  }
  function doSelect (ids, anchor) {
    if (ids.length) { const w = selectedLeaves(selected); w.forEach((l) => sentLeaves.add(l)); if (!liveModel) sentLeaves = w; }
    const p = worksheet.selectTuplesAsync(ids, tableau.SelectOptions.Simple, { tooltipAnchorPoint: anchor }).catch((er) => console.warn('Could not select', er));
    selecting = Promise.race([p, new Promise((res) => setTimeout(res, 8000))]); // never wait forever
  }
  function sendSelection (anchor) {
    selfSelectAt = Date.now();
    if (loading) { selPending = anchor; return; } // sent when the read finishes, with fresh tuple ids
    if (liveModel) {
      // filtered by our own earlier click: Tableau only knows the marks still in the filter
      if (!selected) { doSelect([], anchor); return; } // clearing brings all bars back
      const want = selectedLeaves(selected);
      const live = new Map(); eachNode(liveModel.cats, (c) => { if (!c.kids || !c.kids.length) live.set(c.path, c.tuples); });
      if ([...want].every((l) => live.has(l))) { doSelect([...new Set([].concat(...[...want].map((l) => live.get(l))))], anchor); return; }
      // a bar outside the filter: clear first (all bars come back), then select it with the new tuple ids
      selPending = anchor; awaitingFull = Date.now();
      doSelect([], { x: 0, y: 0 });
      setTimeout(refresh, 3000); setTimeout(refresh, 8000); // in case Tableau sends no event
      return;
    }
    const ids = selected ? [...new Set([].concat(...[...selected].map(tuplesOf)))] : [];
    doSelect(ids, anchor);
  }
  // all bars, kept for this browser tab: if Tableau reloads the extension while our own click filters us,
  // we can still show every bar instead of only the selected ones
  const baseKey = () => 'barlist.base.' + (worksheet && worksheet.name) + '.' + location.pathname;
  function saveBase (data) {
    if (data.rows.length > 5000) return;
    try {
      const keys = data.columns.map((c) => c.fieldName);
      sessionStorage.setItem(baseKey(), JSON.stringify({ columns: data.columns.map((c) => ({ fieldName: c.fieldName, index: c.index })), rows: data.rows.map((r) => keys.map((k) => { const d = r[k]; return d ? [d.value, d.formattedValue, typeof d.nativeValue === 'number' || typeof d.nativeValue === 'string' || d.nativeValue === null ? d.nativeValue : String(d.value)] : null; })) }));
    } catch (e) { /* storage full or blocked */ }
  }
  let restoreTried = false;
  function restoreBase () {
    restoreTried = true;
    if (!selected || liveModel || !lastEnc) return;
    let saved = null; try { saved = JSON.parse(sessionStorage.getItem(baseKey()) || 'null'); } catch (e) { /* none */ }
    if (!saved || !saved.rows || !saved.rows.length) return;
    const keys = saved.columns.map((c) => c.fieldName);
    const data = { columns: saved.columns, rows: saved.rows.map((v, i) => { const r = { __tupleId: i + 1 }; keys.forEach((k, j) => { r[k] = v[j] ? { value: v[j][0], formattedValue: v[j][1], nativeValue: v[j][2] } : null; }); return r; }) };
    let base; try { base = buildModel(data, lastEnc); } catch (e) { return; }
    if (!base || !base.cats) return;
    const now = leafPaths(model); const all = new Set(leafPaths(base)); const want = selectedLeaves(selected);
    if (now.length >= all.size || !now.every((l) => all.has(l) && want.has(l))) return; // not filtered by our selection
    liveModel = model; model = base; lastData = data;
    const sel = selected; render(); selected = sel; markSelection();
  }
  // show what is selected in Tableau (after the extension reloads, or when the selection changes elsewhere)
  async function syncFromTableau () {
    if (!model || !model.cats || !worksheet.getSelectedMarksAsync) return;
    try {
      const marks = await worksheet.getSelectedMarksAsync();
      const t = marks && marks.data && marks.data[0];
      if (!t || !t.data.length) { if (selected) { selected = null; markSelection(); } if (lastData && !liveModel) saveBase(lastData); return; }
      const names = t.columns.map((c) => c.fieldName);
      const idx = model.catKs.map((k) => { const n = resolve(k, names); return n === null ? -1 : t.columns.find((c) => c.fieldName === n).index; });
      if (idx.some((i) => i < 0)) return;
      const leaves = new Set(t.data.map((row) => idx.map((i) => formatted(row[i])).join(SEP)));
      const allIn = (c) => (c.kids && c.kids.length ? c.kids.every(allIn) : leaves.has(c.path));
      const pick = new Set();
      const walk = (list) => list.forEach((c) => { if (allIn(c)) pick.add(c.path); else if (c.kids) walk(c.kids); });
      walk(model.cats);
      // show it on the bars that are on screen (a picked sub-bar of a closed bar: highlight the parent)
      const vis = new Set(lastRows.map((x) => x.path));
      const shown = new Set();
      pick.forEach((p) => { let q = p; while (q && !vis.has(q)) q = q.includes(SEP) ? q.slice(0, q.lastIndexOf(SEP)) : ''; if (q) shown.add(q); });
      selected = shown.size ? shown : null;
      markSelection();
      if (!restoreTried) restoreBase();
    } catch (e) { console.warn('Could not read the selection', e); }
  }
  // a selected parent keeps its open sub-bars in color too
  // (and a closed bar whose selected sub-bar is hidden inside it)
  const isPicked = (path) => [...selected].some((s) => path === s || path.startsWith(s + SEP) || (s.startsWith(path + SEP) && !expanded.has(path)));
  function markSelection () {
    if (selected) { // after a data change a selected bar may be gone: forget it instead of greying everything
      const vis = new Set(lastRows.map((x) => x.path));
      if (![...selected].some((p) => vis.has(p) || [...vis].some((v) => v.startsWith(p + SEP) || p.startsWith(v + SEP)))) selected = null;
    }
    document.querySelectorAll('.bl-row').forEach((x) => x.classList.toggle('dim', !!selected && !isPicked(x.dataset.path)));
    document.body.classList.toggle('has-selection', !!selected);
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
    let saved = {}; let raw = null;
    try { raw = tableau.extensions.settings.get('config'); if (raw) saved = JSON.parse(raw); } catch (e) { /* none */ }
    // a brand-new Bar List: start with this computer's default preset (Format → Presets), saved into the workbook
    if (!raw) {
      let def = null;
      try { def = JSON.parse(localStorage.getItem('barlist.defaultStyle.v1') || 'null'); } catch (e) { /* storage blocked */ }
      if (def && typeof def === 'object') {
        saved = def;
        try {
          if (tableau.extensions.environment.mode === 'authoring') { tableau.extensions.settings.set('config', JSON.stringify({ ...DEFAULTS, ...def })); tableau.extensions.settings.saveAsync().catch(() => {}); }
        } catch (e) { /* viewing: just show it */ }
      }
    }
    cfg = { ...DEFAULTS, ...saved }; cfg.measures = cfg.measures || {}; cfg.calcs = cfg.calcs || [];
  }
  async function openFormatDialog () {
    const url = new URL('format.html' + window.location.search, window.location.href).href;
    const ctx = model && model.measures ? { measures: model.measures.map((m) => ({ key: m.key, name: m.name })), hasBreakdown: model.hasBreakdown, hasTarget: model.hasTarget, levels: model.levels || 1 } : { measures: [] };
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
