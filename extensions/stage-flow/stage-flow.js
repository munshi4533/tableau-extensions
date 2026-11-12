/* Stage Flow – Tableau Viz Extension
 * Where applications go. Data: one row per application in the data source, on the sheet:
 *   Stage (furthest stage reached) × Outcome (Disbursed / Rejected / Cancelled / …) [× Reason, Sub reason], Count = COUNTD(id).
 * Draws a flow through the ordered stages: the band = applications that reached the stage; what ends at a stage
 * peels off (a "leak"), split by outcome, with the reasons on hover. After the last stage: the success outcome
 * (e.g. Disbursed, kept) vs the rest (e.g. Cancelled after disbursement).
 * Layouts: left to right (default) | top to bottom. Click a stage or a leak to filter the dashboard.
 */
/* global tableau, ExtMenu */
'use strict';

(function () {
  const PALETTE = ['#6250d6', '#e87ba4', '#008300', '#5aa0e8', '#c0500f', '#8a6d3b'];
  const MAIN = '#2a78d6';
  const DEFAULTS = {
    title: '',
    layout: 'horizontal', // horizontal (left to right) | vertical (top to bottom)
    sizes: 'true', // true (band thickness = count) | readable (small stages stay visible)
    values: 'auto', // auto | full | short
    showOverall: true, showKept: true, showBiggest: true, showLegend: true,
    showStepPct: true, // % of previous stage on the band
    success: '', // the outcome that means "made it" ('' = automatic: Disbursed / Success / Completed …)
    mainColor: MAIN,
    labelSize: 11, valueSize: 12, titleSize: 14,
    background: 'transparent', bgColor: '#ffffff',
    order: [], // stage names in order (Format); otherwise a rank on Detail, numbers, or Tableau's order
    stages: {}, // name -> { label, hidden }
    outcomes: {} // name -> { label, color }
  };

  let cfg = { ...DEFAULTS };
  let worksheet = null;
  let model = null; let lastData = null; let lastEnc = null;
  const $ = (id) => document.getElementById(id);

  // ================================================================ init + data (same loading as the other extensions)
  async function init () {
    try { await tableau.extensions.initializeAsync({ configure: openFormatDialog }); } catch (e) { showEmpty('<b>Could not start the extension.</b><br>' + esc(e.message || e)); return; }
    worksheet = tableau.extensions.worksheetContent.worksheet;
    loadSettings();
    document.body.classList.add('is-first-load');
    worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, refresh);
    try { worksheet.addEventListener(tableau.TableauEventType.FilterChanged, refresh); } catch (e) { /* n/a */ }
    try { (await worksheet.getParametersAsync()).forEach((p) => p.addEventListener(tableau.TableauEventType.ParameterChanged, refresh)); } catch (e) { /* none */ }
    try { tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, () => { loadSettings(); render(); }); } catch (e) { /* n/a */ }
    const ro = new ResizeObserver(debounce(() => { const c = $('chart'); if (model && (c.clientWidth !== drawn.w || c.clientHeight !== drawn.h)) render(); }, 60));
    ro.observe(document.body);
    document.addEventListener('click', (e) => { if (selected && !e.target.closest('[data-pick]')) { selected = null; sendSelection(); paintSelection(); } });
    ExtMenu.attach(() => { hideTooltip(); return [ExtMenu.authoring() && { label: 'Format Extension…', icon: 'format', action: openFormatDialog }]; });
    load();
  }
  let loading = false; let loadAgain = false; let eventTimer = 0;
  function refresh () { clearTimeout(eventTimer); eventTimer = setTimeout(load, 40); }
  let lastSig = ''; let emptyTries = 0; let updTimer = 0; let selfSelectAt = 0;
  const EMPTY_WAITS = [400, 800, 1500, 3000, 4500];
  function setUpdating (on) {
    clearTimeout(updTimer);
    let badge = $('updating');
    if (on && !badge) { badge = document.createElement('div'); badge.id = 'updating'; badge.className = 'ext-updating'; badge.innerHTML = '<i></i>Updating…'; document.body.appendChild(badge); }
    document.body.classList.toggle('is-updating', !!on);
  }
  async function load () {
    if (loading) { loadAgain = true; return; }
    loading = true; loadAgain = false;
    let changed = false; let waiting = false;
    await selecting; // never read while Tableau is still applying our click
    if (lastData) updTimer = setTimeout(() => { if (Date.now() - selfSelectAt > 4000) setUpdating(true); }, 450);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [data, enc] = await Promise.all([getRows(), getEncodings()]);
        if (!data.rows.length && lastData && lastData.rows.length && emptyTries < EMPTY_WAITS.length) {
          if (Date.now() - selfSelectAt > 4000) setUpdating(true);
          setTimeout(refresh, EMPTY_WAITS[emptyTries++]); waiting = true; break;
        }
        emptyTries = 0;
        const sig = signature(data, enc);
        if (sig !== lastSig || !model || model.error) {
          lastSig = sig;
          const m2 = buildModel(data, enc);
          // one dashboard action that also targets this sheet: our own click filtered our own data;
          // keep showing the whole flow (remember the filtered data for its mark ids)
          if (isSelfFilter(m2)) liveModel = m2; else { liveModel = null; lastData = data; lastEnc = enc; model = m2; changed = true; }
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
    if (awaitingFull && (!liveModel || Date.now() - awaitingFull > 15000)) awaitingFull = 0;
    if (selPending && !awaitingFull) { const ev = selPending; selPending = null; sendSelection(ev); }
  }
  function signature ({ rows, columns }, enc) {
    let h = 2166136261;
    const add = (str) => { for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } };
    add(JSON.stringify(Object.keys(enc).map((k) => [k, (enc[k] || []).map((f) => f.name)])));
    add(columns.map((c) => c.fieldName).join('|'));
    for (const r of rows) for (const c of columns) { const dv = r[c.fieldName]; add(dv ? String(dv.value) + '\u0001' + (dv.formattedValue ?? '') : ''); }
    return rows.length + ':' + (h >>> 0);
  }
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
  // cells: one per stage × outcome, with the count, the Tableau marks (for clicks) and the reasons
  function buildModel ({ rows, columns }, enc) {
    const sF = enc.stage && enc.stage[0]; const oF = enc.outcome && enc.outcome[0]; const cF = enc.count && enc.count[0];
    if (!sF || !oF || !cF) return { empty: true, need: [!sF && 'a <b>Stage</b>', !oF && 'an <b>Outcome</b>', !cF && 'a <b>Count</b> (e.g. COUNTD(id))'].filter(Boolean) };
    if (!rows.length) return { empty: true, noData: true };
    const names = columns.map((c) => c.fieldName);
    const taken = new Set();
    const key = (f) => { if (!f) return null; const k = resolve(f.name, names.filter((n) => !taken.has(n))) || resolve(f.name, names); if (k) taken.add(k); return k; };
    const sK = key(sF); const oK = key(oF); const cK = key(cF);
    const rK = (enc.reason || []).map(key).filter(Boolean);
    // a number on Detail (e.g. MIN(furthest_rank)) sets the stage order
    const rankK = names.find((n) => !taken.has(n) && columns.find((c) => c.fieldName === n && /int|float|real|number/i.test(c.dataType || '')) && rows.some((r) => toNumber(r[n]) !== null));
    const stages = new Map(); const outcomes = new Map(); const cells = new Map();
    let sample = null;
    rows.forEach((r) => {
      const s = formatted(r[sK]); const o = formatted(r[oK]) || 'Unknown';
      const dv = r[cK]; const v = toNumber(dv); if (v === null) return;
      if (dv.formattedValue && (!sample || Math.abs(v) > Math.abs(sample.y))) sample = { text: dv.formattedValue, y: v };
      if (!stages.has(s)) stages.set(s, { name: s, seen: stages.size, rank: null });
      const st = stages.get(s);
      if (rankK) { const rk = toNumber(r[rankK]); if (rk !== null) st.rank = st.rank === null ? rk : Math.min(st.rank, rk); }
      if (!outcomes.has(o)) outcomes.set(o, { name: o, seen: outcomes.size, total: 0 });
      outcomes.get(o).total += v;
      const ck = s + '\u001f' + o;
      if (!cells.has(ck)) cells.set(ck, { key: ck, stage: s, outcome: o, v: 0, tuples: [], reasons: new Map() });
      const c = cells.get(ck); c.v += v; c.tuples.push(r.__tupleId);
      if (rK.length) {
        const r1 = formatted(r[rK[0]]); const r2 = rK[1] ? formatted(r[rK[1]]) : '';
        if (r1 || r2) {
          const g = c.reasons.get(r1 || 'Not specified') || { v: 0, subs: new Map() };
          g.v += v; if (r2) g.subs.set(r2, (g.subs.get(r2) || 0) + v);
          c.reasons.set(r1 || 'Not specified', g);
        }
      }
    });
    return { stages: [...stages.values()], outcomes: [...outcomes.values()], cells: [...cells.values()], unit: detectUnit(sample && sample.text, sample && sample.y), hasRank: !!rankK, hasReasons: rK.length > 0, reasonNames: rK.map(cleanName) };
  }
  // stage order: Format → rank on Detail → numbers / leading numbers in the names → Tableau's order
  function orderedStages (m) {
    const list = m.stages.slice();
    const num = (s) => { const x = parseFloat(String(s.name).match(/^\s*(\d+(\.\d+)?)/)?.[1]); return Number.isFinite(x) ? x : null; };
    const allNum = list.every((s) => num(s) !== null);
    const base = (a, b) => (m.hasRank ? (a.rank ?? 1e9) - (b.rank ?? 1e9) : allNum ? num(a) - num(b) : a.seen - b.seen);
    const pos = (s) => { const i = (cfg.order || []).indexOf(s.name); return i < 0 ? null : i; };
    return list.sort((a, b) => { const pa = pos(a); const pb = pos(b); if (pa !== null && pb !== null) return pa - pb; if (pa !== null) return -1; if (pb !== null) return 1; return base(a, b); });
  }
  const SUCCESS_RE = /disburs|success|complet|kept|won|booked|funded|active|converted/i;
  function successOutcome (m, lastStage) {
    if (cfg.success && m.outcomes.some((o) => o.name === cfg.success)) return cfg.success;
    const atLast = m.cells.filter((c) => c.stage === lastStage).sort((a, b) => b.v - a.v);
    const named = atLast.find((c) => SUCCESS_RE.test(c.outcome) && !/cancel|reject|declin|fail|lost/i.test(c.outcome));
    return named ? named.outcome : (atLast[0] ? atLast[0].outcome : null);
  }
  function outcomeColor (name, success) {
    const oc = cfg.outcomes[name] || {};
    if (oc.color) return oc.color;
    if (name === success) return '#1baf7a';
    if (/after/i.test(name) && /cancel/i.test(name)) return '#eb6834';
    if (/reject|declin|fail/i.test(name)) return '#e34948';
    if (/cancel|withdr|abandon|drop|lost/i.test(name)) return '#eda100';
    if (/progress|pending|open|ongoing|wait/i.test(name)) return '#a5a49e';
    const i = model.outcomes.findIndex((o) => o.name === name);
    return PALETTE[i % PALETTE.length];
  }
  const outLabel = (name) => ((cfg.outcomes[name] || {}).label || name);
  // the flow: visible stages, how many reached each, what left at each (by outcome), and after the last stage
  function flow (m) {
    const all = orderedStages(m);
    const vis = all.filter((s) => !(cfg.stages[s.name] || {}).hidden);
    if (!vis.length) return null;
    // a hidden stage's applications count at the stage shown before it (they passed it and stopped before the next)
    const toVis = new Map(); let cur = -1;
    all.forEach((s) => { const vi = vis.indexOf(s); if (vi >= 0) cur = vi; toVis.set(s.name, Math.max(0, cur)); });
    const n = vis.length; const last = vis[n - 1].name;
    const success = successOutcome(m, last);
    const at = vis.map(() => new Map()); // outcome -> { v, cells }
    m.cells.forEach((c) => {
      const vi = toVis.get(c.stage);
      const g = at[vi].get(c.outcome) || { outcome: c.outcome, v: 0, cells: [] };
      g.v += c.v; g.cells.push(c); at[vi].set(c.outcome, g);
    });
    const reached = vis.map((s, i) => { let t = 0; for (let j = i; j < n; j++) at[j].forEach((g) => { t += g.v; }); return t; });
    const stages = vis.map((s, i) => ({ i, name: s.name, label: (cfg.stages[s.name] || {}).label || s.name, reached: reached[i], cells: [].concat(...at.slice(i).map((mp) => [].concat(...[...mp.values()].map((g) => g.cells)))) }));
    const leakOf = (i, onlyOthers) => {
      const parts = [...at[i].values()].filter((g) => !onlyOthers || g.outcome !== success).sort((a, b) => order(a.outcome) - order(b.outcome));
      return { i, total: parts.reduce((a, g) => a + g.v, 0), parts };
    };
    const order = (o) => { const x = m.outcomes.findIndex((q) => q.name === o); const pri = /reject|declin|fail/i.test(o) ? 0 : /cancel|withdr|abandon/i.test(o) ? 1 : /progress|pending|open/i.test(o) ? 2 : 3; return pri * 1000 + x; };
    const leaks = vis.slice(0, -1).map((s, i) => leakOf(i, false));
    const lastAt = at[n - 1];
    const kept = lastAt.get(success) || { outcome: success, v: 0, cells: [] };
    const after = leakOf(n - 1, true);
    return { stages, leaks, kept, after, success, n };
  }

  // ================================================================ render
  let drawn = { w: 0, h: 0 }; let F = null; let lastUnit = null;
  function render () {
    hideTooltip(); applyStyle();
    const box = $('chart'); box.innerHTML = '';
    $('empty').hidden = true;
    if (!model) return;
    try { renderInner(box); } catch (e) { console.error(e); box.innerHTML = ''; showEmpty('<b>Could not draw the flow.</b><br>' + esc(e.message || String(e))); }
    drawn = { w: box.clientWidth, h: box.clientHeight };
    paintSelection();
  }
  function renderInner (box) {
    if (model.error) { hideChrome(); return showEmpty('<b>Something went wrong.</b><br>' + esc(model.error)); }
    if (model.empty) {
      hideChrome();
      return showEmpty(model.noData ? '<b>No data</b> for the current filters.' : `Drag ${model.need.join(', ')} onto the Marks card.<br><span style="color:var(--ink-3)">One row per application in your data: furthest stage, outcome, COUNTD(id); optional reason / sub reason.</span>`);
    }
    F = flow(model); lastUnit = model.unit;
    if (!F) { hideChrome(); return showEmpty('All stages are hidden.<br><span style="color:var(--ink-3)">Show them again in Format Extension → Stages.</span>'); }
    renderHeader(); renderLegend();
    const W = box.clientWidth; const H = box.clientHeight;
    if (W < 60 || H < 60) return;
    if (cfg.layout === 'vertical') drawVertical(box, W, H); else drawHorizontal(box, W, H);
  }
  function hideChrome () { $('header').hidden = true; $('legend').hidden = true; }
  function renderHeader () {
    const s = F.stages; const first = s[0].reached; const last = s[s.length - 1];
    let html = '';
    if (cfg.showOverall && s.length > 1) html += `<div><span>${esc(s[0].label)} → ${esc(last.label)}</span><b>${fmtPct(first ? last.reached / first : null)}</b></div>`;
    const keptName = outLabel(F.success || '').toLowerCase() === last.label.toLowerCase() ? `${last.label} and kept` : `${last.label} → ${outLabel(F.success)}`;
    if (cfg.showKept && F.after.total > 0 && F.success) html += `<div><span>${esc(keptName)}</span><b>${fmtPct(first ? F.kept.v / first : null)}</b></div>`;
    if (cfg.showBiggest && F.leaks.length) {
      let big = 0; F.leaks.forEach((l, i) => { if (l.total / (s[i].reached || 1) > F.leaks[big].total / (s[big].reached || 1)) big = i; });
      html += `<div><span>Biggest drop</span><b class="bad">−${fmtPct(F.leaks[big].total / (s[big].reached || 1))}</b><small>${esc(s[big].label)} → ${esc(s[big + 1].label)}</small></div>`;
    }
    $('summary').innerHTML = html;
    $('title').textContent = cfg.title || ''; $('title').hidden = !cfg.title;
    $('header').hidden = !html && !cfg.title;
  }
  function renderLegend () {
    const lg = $('legend');
    if (!cfg.showLegend) { lg.hidden = true; return; }
    const outs = model.outcomes.slice().sort((a, b) => (a.name === F.success) - (b.name === F.success) || a.seen - b.seen);
    lg.innerHTML = `<span><i style="background:${cfg.mainColor || MAIN}"></i>Reached the stage</span>` + outs.map((o) => `<span><i style="background:${outcomeColor(o.name, F.success)}"></i>${esc(outLabel(o.name))}</span>`).join('');
    lg.hidden = false;
  }

  const NS = 'http://www.w3.org/2000/svg';
  const el = (tag, a, p, t) => { const e = document.createElementNS(NS, tag); for (const k in a) if (a[k] !== undefined && a[k] !== null) e.setAttribute(k, a[k]); if (t !== undefined) e.textContent = t; if (p) p.appendChild(e); return e; };
  const ctx = document.createElement('canvas').getContext('2d');
  const tw = (t, size, weight) => { ctx.font = `${weight || 400} ${size}px -apple-system, "Segoe UI", Roboto, Arial, sans-serif`; return ctx.measureText(t).width; };
  // up to 2 lines that fit the width (the second ends with … if needed)
  function wrap2 (text, size, w, weight) {
    if (tw(text, size, weight) <= w) return [text];
    const words = String(text).split(/\s+/); let a = '';
    let i = 0;
    for (; i < words.length; i++) { const t = a ? a + ' ' + words[i] : words[i]; if (tw(t, size, weight) > w && a) break; a = t; }
    let b = words.slice(i).join(' ');
    if (!b) return [a];
    while (b.length > 1 && tw(b + '…', size, weight) > w) b = b.slice(0, -1);
    return [a, b + (words.slice(i).join(' ') === b ? '' : '…')];
  }
  const fmtN = (v, short) => (short ? fmtShort(v, lastUnit) : fmtFull(v, lastUnit));
  // what a mark selects: its cells (stage × outcome) → their keys
  const keysOf = (cells) => cells.map((c) => c.key).join('\u001e');
  function pickable (node, cells, kind) { node.setAttribute('data-pick', keysOf(cells)); node.setAttribute('data-kind', kind); node.addEventListener('click', (e) => { e.stopPropagation(); select(cells, e); }); return node; }
  const domMain = () => cfg.mainColor || MAIN;

  // ---------------------------------------------------------------- left to right
  function drawHorizontal (box, W, H) {
    const s = F.stages; const n = s.length; const first = s[0].reached || 1;
    const lab = +cfg.labelSize || 11; const val = +cfg.valueSize || 12;
    const endW = Math.max(70, tw(outLabel(F.success || '') + ' ', lab, 700) + 30);
    const nodeW = Math.max(8, Math.min(16, W / n / 9));
    const step = (W - endW - nodeW - 6) / Math.max(1, n - 1);
    const short = cfg.values === 'short' || (cfg.values === 'auto' && step < 110);
    const labelLines = s.map((st) => wrap2(st.label, lab, Math.max(40, step - 8), 600));
    const top = (Math.max(...labelLines.map((l) => l.length)) * (lab + 3)) + 6;
    const leakTextH = val + lab + 10;
    const avail = H - top - 4;
    const flowH = Math.max(24, avail * 0.46);
    const curve = Math.max(16, avail * 0.12);
    const leakH = Math.max(14, avail - flowH - curve - leakTextH);
    const leakY = top + flowH + curve;
    const scale = (v) => (cfg.sizes === 'readable' ? 0.15 + 0.85 * Math.sqrt(v / first) : v / first);
    const th = (v) => Math.max(3, flowH * scale(v));
    const xs = s.map((st, i) => 2 + i * step);
    const maxLeak = Math.max(1, ...F.leaks.map((l) => l.total));
    const leakW = Math.max(6, Math.min(36, step * 0.32));
    const svg = el('svg', { width: W, height: H, class: 'sf-svg' }, box);
    s.forEach((st, i) => {
      const x = xs[i]; const t = th(st.reached);
      labelLines[i].forEach((ln, k) => el('text', { x, y: top - 6 - (labelLines[i].length - 1 - k) * (lab + 3), 'font-size': lab, 'font-weight': 600, class: 'sf-lab' }, svg, ln));
      if (i < n - 1) {
        const a = x + nodeW; const b = xs[i + 1]; const tn = th(s[i + 1].reached);
        el('path', { d: `M${a},${top} L${b},${top} L${b},${top + tn} L${a},${top + tn} Z`, fill: domMain(), opacity: 0.18, class: 'sf-band' }, svg);
        const pctW = tw('00.0%', Math.max(9, lab - 1), 700); const valW = tw(fmtN(st.reached, short), val, 700) + nodeW + 8;
        const xp = Math.max((a + b) / 2, x + valW + pctW / 2); const inBand = tn >= val * 2 + 14 && xp + pctW / 2 < b - 2;
        if (cfg.showStepPct && step > pctW + 14) el('text', { x: inBand ? xp : (a + b) / 2, y: inBand ? top + tn / 2 + 4 : top + tn + lab + 2, 'text-anchor': 'middle', 'font-size': Math.max(9, lab - 1), 'font-weight': 700, class: 'sf-step' }, svg, fmtPct(st.reached ? s[i + 1].reached / st.reached : null));
        // the leak: curves down from the bottom of this stage into a bar split by outcome
        const L = F.leaks[i];
        if (L.total > 0) {
          const g = pickable(el('g', { class: 'sf-leak' }, svg), [].concat(...L.parts.map((p) => p.cells)), 'leak');
          const lw = Math.max(3, leakW * Math.sqrt(L.total / maxLeak)); const lx = a + 4;
          el('path', { d: `M${a},${top + tn} L${a},${top + t} C${a},${leakY - curve * 0.3} ${lx},${leakY - curve * 0.6} ${lx},${leakY} L${lx + lw},${leakY} C${lx + lw},${leakY - curve} ${a + 4},${top + tn + curve * 0.5} ${a},${top + tn} Z`, fill: '#e34948', opacity: 0.12 }, g);
          let cy = leakY;
          L.parts.forEach((p) => {
            const ph = leakH * p.v / L.total;
            if (ph > 0) { const r = el('rect', { x: lx, y: cy, width: lw, height: Math.max(0.5, ph), fill: outcomeColor(p.outcome, F.success) }, g); pickable(r, p.cells, 'part'); r.addEventListener('mousemove', (e) => showTip(e, leakTip(i, L, p.outcome))); }
            cy += ph;
          });
          const lossT = '−' + fmtN(L.total, short);
          if (tw(lossT, val, 700) < step - 6) el('text', { x: lx, y: leakY + leakH + val + 2, 'font-size': val, 'font-weight': 700, class: 'sf-loss' }, g, lossT);
          const dom = L.parts.slice().sort((p, q) => q.v - p.v)[0];
          if (dom && tw(`${Math.round(dom.v / L.total * 100)}% ${outLabel(dom.outcome).toLowerCase()}`, lab) < step - 6) el('text', { x: lx, y: leakY + leakH + val + lab + 5, 'font-size': lab, class: 'sf-sub' }, g, `${Math.round(dom.v / L.total * 100)}% ${outLabel(dom.outcome).toLowerCase()}`);
          g.addEventListener('mousemove', (e) => { if (!e.target.closest('rect')) showTip(e, leakTip(i, L)); });
          g.addEventListener('mouseleave', hideTooltip);
        }
      }
      const node = pickable(el('rect', { x, y: top, width: nodeW, height: t, rx: 2, fill: domMain(), class: 'sf-node' }, svg), st.cells, 'node');
      node.addEventListener('mousemove', (e) => showTip(e, stageTip(i))); node.addEventListener('mouseleave', hideTooltip);
      el('text', { x: x + nodeW + 4, y: top + val, 'font-size': val, 'font-weight': 700, class: 'sf-val' }, svg, i === n - 1 ? '' : fmtN(st.reached, short));
    });
    // after the last stage: the success outcome (kept) and the rest (e.g. cancelled after disbursement)
    const x = xs[n - 1]; const t = th(s[n - 1].reached); const ex = x + nodeW + 16;
    el('text', { x, y: top + t + val + 4, 'font-size': val, 'font-weight': 700, class: 'sf-val' }, svg, fmtN(s[n - 1].reached, short));
    if (F.after.total > 0 || F.kept.v > 0) {
      el('path', { d: `M${x + nodeW},${top} L${ex},${top} L${ex},${top + t} L${x + nodeW},${top + t} Z`, fill: domMain(), opacity: 0.18 }, svg);
      const tot = F.kept.v + F.after.total || 1; let cy = top;
      const keptH = t * F.kept.v / tot;
      const kr = pickable(el('rect', { x: ex, y: cy, width: 9, height: Math.max(0.5, keptH), fill: outcomeColor(F.success, F.success) }, svg), F.kept.cells, 'kept');
      kr.addEventListener('mousemove', (e) => showTip(e, endTip())); kr.addEventListener('mouseleave', hideTooltip);
      cy += keptH;
      F.after.parts.forEach((p) => { const ph = t * p.v / tot; const r = pickable(el('rect', { x: ex, y: cy, width: 9, height: Math.max(1.5, ph), fill: outcomeColor(p.outcome, F.success) }, svg), p.cells, 'part'); r.addEventListener('mousemove', (e) => showTip(e, endTip(p.outcome))); r.addEventListener('mouseleave', hideTooltip); cy += ph; });
      el('text', { x: ex + 14, y: top + lab, 'font-size': lab, 'font-weight': 700, fill: outcomeColor(F.success, F.success) }, svg, outLabel(F.success || ''));
      el('text', { x: ex + 14, y: top + lab * 2 + 3, 'font-size': lab, class: 'sf-sub' }, svg, fmtN(F.kept.v, true));
      if (F.after.total > 0) {
        const ay = top + Math.max(t + val + 8, lab * 2 + 10) + 6;
        el('text', { x: ex + 14, y: ay + lab, 'font-size': lab, 'font-weight': 700, class: 'sf-loss' }, svg, '−' + fmtN(F.after.total, true));
        wrap2(F.after.parts.map((p) => outLabel(p.outcome)).join(', ').toLowerCase(), Math.max(9, lab - 1), endW - 18).forEach((ln, k) => el('text', { x: ex + 14, y: ay + lab * 2 + 3 + k * (lab + 1), 'font-size': Math.max(9, lab - 1), class: 'sf-sub' }, svg, ln));
      }
    }
  }

  // ---------------------------------------------------------------- top to bottom
  function drawVertical (box, W, H) {
    const s = F.stages; const n = s.length; const first = s[0].reached || 1;
    const lab = +cfg.labelSize || 11; const val = +cfg.valueSize || 12;
    const extra = (F.after.total > 0 || F.kept.v > 0) ? 26 : 4;
    const slot = (H - extra) / n; const rowH = Math.max(10, Math.min(36, slot * 0.46)); const gap = slot - rowH;
    const labelW = Math.min(W * 0.26, Math.max(60, ...s.map((st) => tw(st.label, lab, 600))) + 8);
    const x0 = labelW + 8;
    const maxW = Math.max(40, (W - x0) * 0.42);
    const short = cfg.values === 'short' || (cfg.values === 'auto' && W < 700);
    const scale = (v) => (cfg.sizes === 'readable' ? 0.15 + 0.85 * Math.sqrt(v / first) : v / first);
    const w = (v) => Math.max(2, maxW * scale(v));
    const leakX = x0 + maxW + 60; const leakMax = Math.max(20, (W - leakX) * 0.32);
    const maxLeak = Math.max(1, ...F.leaks.map((l) => l.total));
    const svg = el('svg', { width: W, height: H, class: 'sf-svg' }, box);
    s.forEach((st, i) => {
      const y = i * slot + gap * 0.15;
      el('text', { x: labelW, y: y + rowH / 2 + lab / 3, 'text-anchor': 'end', 'font-size': lab, 'font-weight': 600, class: 'sf-lab' }, svg, wrap2(st.label, lab, labelW - 4, 600)[0]);
      const node = pickable(el('rect', { x: x0, y, width: w(st.reached), height: rowH, rx: 3, fill: domMain(), class: 'sf-node' }, svg), st.cells, 'node');
      node.addEventListener('mousemove', (e) => showTip(e, stageTip(i))); node.addEventListener('mouseleave', hideTooltip);
      el('text', { x: x0 + w(st.reached) + 6, y: y + rowH / 2 + val / 3, 'font-size': val, 'font-weight': 700, class: 'sf-val' }, svg, fmtN(st.reached, short) + (cfg.showStepPct && i ? `  ` : ''));
      if (cfg.showStepPct && i) el('text', { x: x0 + w(st.reached) + 16 + tw(fmtN(st.reached, short), val, 700) * 1.08, y: y + rowH / 2 + val / 3, 'font-size': Math.max(9, lab - 1), class: 'sf-sub' }, svg, `${fmtPct(st.reached / s[i - 1].reached)} of previous`);
      if (i < n - 1) {
        const yb = y + rowH; const yn = (i + 1) * slot + gap * 0.15; const wn = w(s[i + 1].reached); const wc = w(st.reached);
        el('path', { d: `M${x0},${yb} L${x0 + wn},${yb} L${x0 + wn},${yn} L${x0},${yn} Z`, fill: domMain(), opacity: 0.16, class: 'sf-band' }, svg);
        const L = F.leaks[i];
        if (L.total > 0) {
          const g = pickable(el('g', { class: 'sf-leak' }, svg), [].concat(...L.parts.map((p) => p.cells)), 'leak');
          const bh = Math.max(6, Math.min(16, gap * 0.4)); const ly = yb + (yn - yb) / 2 - bh / 2; const lw = Math.max(3, leakMax * Math.sqrt(L.total / maxLeak));
          el('path', { d: `M${x0 + wn},${yb} L${x0 + wc},${yb} C${x0 + wc + 30},${yb} ${leakX - 40},${ly} ${leakX},${ly} L${leakX},${ly + bh} C${leakX - 50},${ly + bh} ${x0 + wn + 20},${yb + Math.min(10, gap / 2)} ${x0 + wn},${yb + Math.min(10, gap / 2)} Z`, fill: '#e34948', opacity: 0.12 }, g);
          let cx = leakX;
          L.parts.forEach((p) => { const pw = lw * p.v / L.total; if (pw > 0) { const r = el('rect', { x: cx, y: ly, width: pw, height: bh, fill: outcomeColor(p.outcome, F.success) }, g); pickable(r, p.cells, 'part'); r.addEventListener('mousemove', (e) => showTip(e, leakTip(i, L, p.outcome))); } cx += pw; });
          el('text', { x: leakX + lw + 6, y: ly + bh / 2 + val / 3, 'font-size': val, 'font-weight': 700, class: 'sf-loss' }, g, '−' + fmtN(L.total, short));
          const txt = L.parts.filter((p) => p.v / L.total >= 0.08).map((p) => `${outLabel(p.outcome)} ${Math.round(p.v / L.total * 100)}%`).join(' · ');
          el('text', { x: leakX + lw + 18 + tw('−' + fmtN(L.total, short), val, 700) * 1.08, y: ly + bh / 2 + lab / 3, 'font-size': lab, class: 'sf-sub' }, g, txt);
          g.addEventListener('mousemove', (e) => { if (!e.target.closest('rect')) showTip(e, leakTip(i, L)); });
          g.addEventListener('mouseleave', hideTooltip);
        }
      }
    });
    if (F.after.total > 0 || F.kept.v > 0) {
      const y = (n - 1) * slot + gap * 0.15 + rowH + 8; const wd = w(s[n - 1].reached); const tot = F.kept.v + F.after.total || 1;
      const kw = wd * F.kept.v / tot;
      const kr = pickable(el('rect', { x: x0, y, width: Math.max(1, kw), height: 12, fill: outcomeColor(F.success, F.success) }, svg), F.kept.cells, 'kept');
      kr.addEventListener('mousemove', (e) => showTip(e, endTip())); kr.addEventListener('mouseleave', hideTooltip);
      let cx = x0 + kw;
      F.after.parts.forEach((p) => { const pw = Math.max(1.5, wd * p.v / tot); pickable(el('rect', { x: cx, y, width: pw, height: 12, fill: outcomeColor(p.outcome, F.success) }, svg), p.cells, 'part').addEventListener('mousemove', (e) => showTip(e, endTip(p.outcome))); cx += pw; });
      el('text', { x: x0 + wd + 6, y: y + 10, 'font-size': lab, class: 'sf-sub' }, svg, `${outLabel(F.success || '')} ${fmtN(F.kept.v, short)}` + F.after.parts.map((p) => ` · ${outLabel(p.outcome)} ${fmtN(p.v, short)}`).join(''));
    }
  }

  // ---------------------------------------------------------------- tooltips
  function stageTip (i) {
    const s = F.stages; const st = s[i];
    return `<div class="sf-tt-head">${esc(st.label)}</div>` + row('Reached', fmtFull(st.reached, lastUnit)) + row('Of ' + s[0].label, fmtPct(s[0].reached ? st.reached / s[0].reached : null)) + (i ? row('Of previous stage', fmtPct(s[i - 1].reached ? st.reached / s[i - 1].reached : null)) : '');
  }
  function leakTip (i, L, focus) {
    const st = F.stages[i];
    let html = `<div class="sf-tt-head">Ended at ${esc(st.label)}</div>` + row('Total', `${fmtFull(L.total, lastUnit)} · ${fmtPct(st.reached ? L.total / st.reached : null)} of the stage`);
    html += L.parts.map((p) => row(`<i style="background:${outcomeColor(p.outcome, F.success)}"></i>${esc(outLabel(p.outcome))}`, `${fmtFull(p.v, lastUnit)} · ${fmtPct(p.v / L.total)}`, p.outcome === focus, true)).join('');
    html += reasonsHtml(L.parts.filter((p) => !focus || p.outcome === focus));
    return html;
  }
  function endTip (focus) {
    const last = F.stages[F.n - 1];
    const parts = [{ outcome: F.success, v: F.kept.v, cells: F.kept.cells }, ...F.after.parts];
    let html = `<div class="sf-tt-head">After ${esc(last.label)}</div>` + parts.map((p) => row(`<i style="background:${outcomeColor(p.outcome, F.success)}"></i>${esc(outLabel(p.outcome))}`, `${fmtFull(p.v, lastUnit)} · ${fmtPct(last.reached ? p.v / last.reached : null)}`, p.outcome === focus, true)).join('');
    if (focus) html += reasonsHtml(F.after.parts.filter((p) => p.outcome === focus));
    return html;
  }
  // reasons of the cells: reason → top sub reasons (largest first)
  function reasonsHtml (parts) {
    const agg = new Map();
    parts.forEach((p) => p.cells.forEach((c) => c.reasons.forEach((g, r) => {
      const a = agg.get(r) || { v: 0, subs: new Map() }; a.v += g.v; g.subs.forEach((v, s) => a.subs.set(s, (a.subs.get(s) || 0) + v)); agg.set(r, a);
    })));
    if (!agg.size) return '';
    const top = [...agg.entries()].sort((a, b) => b[1].v - a[1].v);
    const rn = String(model.reasonNames[0] || 'Reasons').replace(/_/g, ' ');
    let html = `<div class="sf-tt-sec">${esc(rn.charAt(0).toUpperCase() + rn.slice(1).toLowerCase())}</div>`;
    top.slice(0, 6).forEach(([r, a]) => {
      html += row(esc(r), fmtFull(a.v, lastUnit), false, true);
      [...a.subs.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).forEach(([s, v]) => { if (s !== r) html += `<div class="sf-tt-row sub"><span>${esc(s)}</span><b>${esc(fmtFull(v, lastUnit))}</b></div>`; });
    });
    if (top.length > 6) html += `<div class="sf-tt-row sub"><span>+ ${top.length - 6} more</span></div>`;
    return html;
  }
  const row = (a, b, hl, rawA) => `<div class="sf-tt-row${hl ? ' hl' : ''}"><span>${rawA ? a : esc(a)}</span><b>${esc(b)}</b></div>`;
  function showTip (e, html) {
    const tt = $('tooltip'); tt.innerHTML = html; tt.hidden = false;
    const b = tt.getBoundingClientRect();
    let x = e.clientX + 14; let y = e.clientY + 14;
    if (x + b.width > innerWidth - 4) x = e.clientX - b.width - 14;
    if (y + b.height > innerHeight - 4) y = Math.max(4, e.clientY - b.height - 14);
    tt.style.left = Math.max(4, x) + 'px'; tt.style.top = y + 'px';
  }

  // ================================================================ click to filter the dashboard
  // A mark = a set of cells (stage × outcome). Works with one dashboard-wide filter action (this sheet included):
  // when our own click filters our data, the whole flow stays (like Bar List / KPI Card).
  let selected = null; // Set of cell keys
  let liveModel = null; let sentKeys = new Set(); let selecting = Promise.resolve(); let selPending = null; let awaitingFull = 0;
  function select (cells, e) {
    const keys = new Set(cells.map((c) => c.key));
    const add = e.ctrlKey || e.metaKey;
    const same = selected && selected.size === keys.size && [...keys].every((k) => selected.has(k));
    if (add && selected) { const next = new Set(selected); const allIn = [...keys].every((k) => next.has(k)); keys.forEach((k) => (allIn ? next.delete(k) : next.add(k))); selected = next.size ? next : null; } else selected = same ? null : keys;
    hideTooltip(); paintSelection();
    sendSelection({ pageX: e.pageX, pageY: e.pageY });
  }
  function paintSelection () {
    const box = $('chart');
    box.classList.toggle('has-sel', !!selected);
    box.querySelectorAll('[data-pick]').forEach((n) => {
      const ks = n.getAttribute('data-pick').split('\u001e');
      n.classList.toggle('picked', !!selected && ks.length > 0 && ks.every((k) => selected.has(k)));
    });
  }
  const keysIn = (m) => new Set((m && m.cells ? m.cells : []).map((c) => c.key));
  function isSelfFilter (m2) {
    if (!selected || !model || !model.cells || !m2 || !m2.cells) return false;
    const now = [...keysIn(m2)]; const all = keysIn(model);
    if (!now.length) return false;
    const sumNow = m2.cells.reduce((a, c) => a + c.v, 0); const sumAll = model.cells.reduce((a, c) => a + c.v, 0);
    if (now.length >= all.size && sumNow >= sumAll) return false;
    return now.every((k) => selected.has(k) || sentKeys.has(k));
  }
  function doSelect (ids, ev) {
    if (ids.length && selected) sentKeys = liveModel ? new Set([...sentKeys, ...selected]) : new Set(selected);
    const p = worksheet.selectTuplesAsync(ids, tableau.SelectOptions.Simple, { tooltipAnchorPoint: { x: ev ? ev.pageX : 0, y: ev ? ev.pageY : 0 } }).catch((er) => console.warn('Could not select', er));
    selecting = Promise.race([p, new Promise((res) => setTimeout(res, 8000))]);
  }
  function sendSelection (ev) {
    selfSelectAt = Date.now();
    if (loading) { selPending = ev || {}; return; }
    if (!selected) { doSelect([], ev); return; }
    const src = liveModel || model;
    const byKey = new Map(src.cells.map((c) => [c.key, c]));
    if (liveModel && ![...selected].every((k) => byKey.has(k))) {
      // a mark outside our own filter: clear first (all data comes back), then select it
      selPending = ev || {}; awaitingFull = Date.now(); doSelect([], null);
      setTimeout(refresh, 3000); setTimeout(refresh, 8000);
      return;
    }
    doSelect([].concat(...[...selected].map((k) => (byKey.get(k) || { tuples: [] }).tuples)), ev);
  }

  // ================================================================ numbers
  function fmtPct (p) { if (p === null || p === undefined || !Number.isFinite(p)) return '–'; const a = p * 100; return (Math.abs(a) >= 10 || a === 0 ? a.toFixed(1) : a.toFixed(2)) + '%'; }
  const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  function fmtFull (v, u) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    const neg = v < 0; const n = Math.abs(v); u = u || {};
    let body;
    if (u.scale > 1) { const q = n / u.scale; body = nf(Math.max(u.decimals || 0, q < 10 ? 1 : 0)).format(q) + u.suffix; } else body = nf(n % 1 ? Math.min(2, u.decimals || 1) : 0).format(n) + (u.suffix || '');
    return (neg ? '−' : '') + (u.prefix || '') + body;
  }
  function fmtShort (v, u) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    u = u || {};
    if (u.scale > 1) return fmtFull(v, u);
    const neg = v < 0; const n = Math.abs(v);
    const sc = (div, s) => { const q = n / div; return nf(q < 10 ? 2 : q < 100 ? 1 : 0).format(q) + s; };
    const body = n >= 1e9 ? sc(1e9, 'B') : n >= 1e6 ? sc(1e6, 'M') : n >= 1e4 ? sc(1e3, 'K') : nf(n % 1 ? 1 : 0).format(n);
    return (neg ? '−' : '') + (u.prefix || '') + body;
  }

  // ================================================================ chrome + settings
  function applyStyle () {
    const r = document.documentElement.style;
    r.setProperty('--surface', cfg.background === 'white' ? '#ffffff' : cfg.background === 'custom' ? (cfg.bgColor || '#ffffff') : 'transparent');
    r.setProperty('--title-size', (+cfg.titleSize || 14) + 'px');
  }
  function hideTooltip () { const t = $('tooltip'); if (t) t.hidden = true; }
  function showEmpty (html) { const el2 = $('empty'); el2.innerHTML = `<div>${html}</div>`; el2.hidden = false; }
  function loadSettings () {
    let saved = {};
    try { const raw = tableau.extensions.settings.get('config'); if (raw) saved = JSON.parse(raw); } catch (e) { /* none */ }
    cfg = { ...DEFAULTS, ...saved }; cfg.stages = cfg.stages || {}; cfg.outcomes = cfg.outcomes || {}; cfg.order = Array.isArray(cfg.order) ? cfg.order : [];
  }
  async function openFormatDialog () {
    const url = new URL('format.html' + window.location.search, window.location.href).href;
    const m = model && model.stages ? model : null;
    const ctx2 = m ? { stages: orderedStages(m).map((s) => s.name), outcomes: m.outcomes.map((o) => o.name), success: F ? F.success : '', colors: Object.fromEntries(m.outcomes.map((o) => [o.name, outcomeColor(o.name, F ? F.success : '')])) } : { stages: [], outcomes: [] };
    try { await tableau.extensions.ui.displayDialogAsync(url, JSON.stringify({ ctx: ctx2, defaults: DEFAULTS }), { width: 540, height: 720 }); } catch (e) { if (!(tableau.ErrorCodes && e.errorCode === tableau.ErrorCodes.DialogClosedByUser)) console.error(e); }
    loadSettings(); render();
  }

  // ================================================================ helpers
  function toNumber (dv) { if (!dv) return null; const v = typeof dv.nativeValue === 'number' ? dv.nativeValue : (dv.nativeValue === null ? NaN : Number(dv.value)); return Number.isFinite(v) ? v : null; }
  const formatted = (dv) => { if (!dv || dv.nativeValue === null || dv.value === '%null%') return ''; return String(dv.formattedValue ?? dv.value ?? ''); };
  function resolve (name, names) {
    if (names.includes(name)) return name;
    const lc = String(name).toLowerCase(); const cn = cleanName(name).toLowerCase();
    return names.find((n) => n.toLowerCase() === lc) || names.find((n) => cleanName(n).toLowerCase() === cn) || names.find((n) => n.toLowerCase().includes(cn)) || null;
  }
  const cleanName = (n) => String(n || '').replace(/^(SUM|AVG|MIN|MAX|CNT|CNTD|COUNT|COUNTD|MEDIAN|ATTR|AGG)\((.*)\)$/i, '$2');
  function detectUnit (sample, value) {
    if (!sample) return { prefix: '', suffix: '', scale: 1, decimals: 0 };
    const s = String(sample).trim();
    const prefix = (s.match(/^[^\d\-−(.]*/) || [''])[0]; const suffix = (s.match(/[^\d.,)]*$/) || [''])[0];
    const num = (s.match(/\d[\d,]*(\.\d+)?/) || [''])[0]; const shown = parseFloat(num.replace(/,/g, ''));
    let scale = 1;
    if (Number.isFinite(value) && value !== 0 && shown > 0) {
      const r = Math.log10(Math.abs(value) / shown);
      const best = [0, 3, 6, 9, 12].reduce((a, e) => (Math.abs(r - e) < Math.abs(r - a) ? e : a), 0);
      if (Math.abs(r - best) < 0.3) scale = Math.pow(10, best);
    }
    const dm = num.match(/\.(\d+)$/);
    return { prefix, suffix, scale, decimals: dm ? dm[1].length : 0 };
  }
  function esc (s) { return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
  function debounce (fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  { const v = document.querySelector('meta[name="ext-version"]'); console.log('[' + document.title + '] version', v ? v.content : '?'); }
  init();
})();
