/* Funnel – Tableau Viz Extension
 * Conversion strip: one box per measure on the Stages shelf (in shelf order, or the order set in Format),
 * each with its value and two progresses: % of start (vs the first stage) and % of previous (vs the stage
 * before). Arrows between the boxes show the drop or the step %. Header: overall conversion and the weakest step.
 * Progress styles: side by side | stacked | rings. Layout: a row, or a column in tall narrow zones.
 */
/* global tableau, ExtMenu */
'use strict';

(function () {
  const PALETTE = ['#2a78d6', '#3d8ce0', '#1baf7a', '#eb6834', '#6250d6', '#eda100', '#e87ba4', '#008300', '#e34948', '#5aa0e8'];
  const DEFAULTS = {
    title: '', // shown above the boxes ('' = none)
    showOverall: true, // header: overall conversion (first → last stage)
    showWeakest: true, // header: the weakest step
    autoSize: true, // boxes, numbers and rings grow when the zone is bigger
    progress: 'side', // side (two bars side by side) | stack (one under the other) | ring (two small rings) | text (drop as text)
    arrows: 'drop', // drop (−386.5K) | step (18.6%) | none
    values: 'auto', // auto (short when the box is narrow) | full (474,765) | short (474.8K)
    layout: 'auto', // auto (row; a column in a tall narrow zone) | row | column
    colorMode: 'palette', // progress bars / rings: palette (a color per stage) | single
    color: '#2a78d6',
    topBar: 'stage', // colored line at the top of each box: stage (its progress color) | single | none
    topColor: '#2a78d6',
    prevColors: true, // % of previous in red / amber / green
    warnAt: 30, goodAt: 70, // % of previous: red below warnAt, amber below goodAt, green from goodAt
    startLabel: 'of start', prevLabel: 'of previous',
    // progress = text: "Drop from:" then the drop from the previous step and from the first stage, count | %
    dropTitle: 'Drop from:', dropPrevLabel: 'Previous step', dropStartLabel: 'Total started',
    dropPct: 'lost', // % shown in the text: lost (share that dropped) | kept (share that converted)
    nameSize: 12, valueSize: 22, titleSize: 14,
    nameColor: '#52514e', valueColor: '#0b0b0b',
    boxFill: 'white', // white | transparent | custom
    boxColor: '#ffffff',
    boxBorder: true,
    background: 'transparent', bgColor: '#ffffff', // transparent | white | custom
    order: [], // stage keys in the order chosen in Format (new measures go at the end)
    stages: {} // key -> { label, color, hidden }
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
    try { (await worksheet.getParametersAsync()).forEach((p) => p.addEventListener(tableau.TableauEventType.ParameterChanged, refresh)); } catch (e) { /* no parameters */ }
    try { tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, () => { loadSettings(); render(); }); } catch (e) { /* n/a */ }
    const ro = new ResizeObserver(debounce(() => { const c = $('strip'); if (model && (c.clientWidth !== drawn.w || c.clientHeight !== drawn.h)) render(); }, 60));
    ro.observe(document.body);
    ExtMenu.attach(() => { hideTooltip(); return [ExtMenu.authoring() && { label: 'Format Extension…', icon: 'format', action: openFormatDialog }]; });
    load();
  }
  let loading = false; let loadAgain = false; let eventTimer = 0;
  function refresh () { clearTimeout(eventTimer); eventTimer = setTimeout(load, 40); }
  let lastSig = ''; let emptyTries = 0; let updTimer = 0;
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
    if (lastData) updTimer = setTimeout(() => setUpdating(true), 450); // a slow answer (Server): "Updating…" instead of looking frozen
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const [data, enc] = await Promise.all([getRows(), getEncodings()]);
        // Tableau Server can answer "no rows" for a few seconds while it applies a filter: keep the boxes, ask again
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
    try { if (changed) render(); } catch (e) { console.error(e); }
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
  async function getRows () {
    const reader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true, applyWorksheetFormatting: true });
    const rows = []; let columns = [];
    try {
      for (let p = 0; p < reader.pageCount; p++) {
        const page = await reader.getPageAsync(p);
        columns = page.columns;
        page.data.forEach((d) => { const row = {}; for (const c of columns) row[c.fieldName] = d[c.index]; rows.push(row); });
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

  // ================================================================ model: one stage per measure, summed over the rows
  // (a dimension on Detail gives several rows: the stage is their total)
  function buildModel ({ rows, columns }, enc) {
    const fields = enc.stages || [];
    if (!fields.length) return { empty: true, needStages: true };
    if (!rows.length) return { empty: true, noData: true }; // a dashboard filter left no rows (Tableau then sends no columns)
    const names = columns.map((c) => c.fieldName);
    const taken = new Set();
    const key = (f) => { const k = resolve(f.name, names.filter((n) => !taken.has(n))) || resolve(f.name, names); if (k) taken.add(k); return k; };
    const stages = fields.map(key).filter(Boolean).map((k, i) => ({ key: k, name: cleanName(k), shelf: i, v: null, sample: null }));
    rows.forEach((r) => {
      for (const s of stages) {
        const dv = r[s.key]; const y = toNumber(dv);
        if (y === null) continue;
        s.v = (s.v || 0) + y;
        if (dv.formattedValue && (!s.sample || Math.abs(y) > Math.abs(s.sample.y))) s.sample = { text: dv.formattedValue, y };
      }
    });
    stages.forEach((s) => { s.unit = s.sample ? detectUnit(s.sample.text, s.sample.y) : detectUnit(null); });
    return { stages };
  }
  // the stages to draw: Format order first (renamed, recolored, hidden ones left out), then any new measures
  function visibleStages () {
    const list = model.stages.slice();
    const pos = (k) => { const i = (cfg.order || []).indexOf(k); return i < 0 ? 1000 + list.findIndex((s) => s.key === k) : i; };
    list.sort((a, b) => pos(a.key) - pos(b.key));
    return list.filter((s) => !(cfg.stages[s.key] || {}).hidden).map((s, i) => {
      const sc = cfg.stages[s.key] || {};
      return { ...s, label: sc.label || s.name, color: cfg.colorMode === 'single' ? (cfg.color || PALETTE[0]) : (sc.color || PALETTE[i % PALETTE.length]) };
    });
  }

  // ================================================================ render
  let drawn = { w: 0, h: 0 };
  function render () {
    hideTooltip(); applyStyle();
    const strip = $('strip'); strip.innerHTML = ''; strip.className = 'fn-strip';
    $('empty').hidden = true;
    if (!model) return;
    try { renderInner(strip); } catch (e) { console.error(e); strip.innerHTML = ''; showEmpty('<b>Could not draw the funnel.</b><br>' + esc(e.message || String(e))); }
    drawn = { w: strip.clientWidth, h: strip.clientHeight };
  }
  function renderInner (strip) {
    if (model.error) { $('header').hidden = true; return showEmpty('<b>Something went wrong.</b><br>' + esc(model.error)); }
    if (model.empty) {
      $('header').hidden = true;
      return showEmpty(model.noData ? '<b>No data</b> for the current filters.' : 'Drag one measure per stage onto <b>Stages</b> on the Marks card, in funnel order.<br><span style="color:var(--ink-3)">e.g. COUNTD(Started), COUNTD(Submitted), COUNTD(Approved), COUNTD(Disbursed)</span>');
    }
    const S = visibleStages();
    if (!S.length) { $('header').hidden = true; return showEmpty('All stages are hidden.<br><span style="color:var(--ink-3)">Show them again in Format Extension → Stages.</span>'); }
    const first = S[0].v;
    S.forEach((s, i) => {
      s.ofStart = first ? (s.v ?? 0) / first : null;
      s.ofPrev = i === 0 ? null : (S[i - 1].v ? (s.v ?? 0) / S[i - 1].v : null);
      s.drop = i === 0 ? null : (S[i - 1].v ?? 0) - (s.v ?? 0);
      s.dropStart = i === 0 ? null : (first ?? 0) - (s.v ?? 0);
    });
    renderHeader(S);

    // layout: a row of boxes; in a tall narrow zone a column; when even that does not fit, boxes wrap
    const W = strip.clientWidth; const H = strip.clientHeight; const n = S.length;
    const arrowW = cfg.arrows === 'none' ? 10 : 46;
    const rowFits = W >= n * 104 + (n - 1) * arrowW;
    let mode = cfg.layout === 'row' ? (rowFits ? 'row' : 'wrap') : cfg.layout === 'column' ? 'column' : (rowFits ? 'row' : (H >= n * 96 + (n - 1) * 22 ? 'column' : 'wrap'));
    if (mode === 'row' && cfg.layout === 'auto' && H > W * 1.3 && H >= n * 96) mode = 'column';
    strip.classList.add('m-' + mode);
    const boxW = mode === 'row' ? (W - (n - 1) * arrowW) / n : mode === 'column' ? W : Math.max(118, (W - 10) / Math.max(1, Math.floor(W / 128)));
    const short = cfg.values === 'short' || (cfg.values === 'auto' && boxW < 150);

    S.forEach((s, i) => {
      if (i && mode !== 'wrap' && cfg.arrows !== 'none') strip.appendChild(arrowEl(s, mode));
      else if (i && mode !== 'wrap') { const sp = document.createElement('div'); sp.className = 'fn-gap'; strip.appendChild(sp); }
      strip.appendChild(boxEl(s, i, short));
    });
    fitSize(strip, mode, boxW, H);
  }
  // grow the boxes (text, numbers, rings, bars) to use a bigger zone; never smaller than the normal size
  function fitSize (strip, mode, boxW, H) {
    strip.style.setProperty('--k', 1); strip.classList.remove('narrow');
    if (!cfg.autoSize || mode === 'wrap') return;
    const boxes = [...strip.querySelectorAll('.fn-box')];
    if (!boxes.length) return;
    const tallest = () => Math.max(...boxes.map((b) => b.offsetHeight));
    const used = () => [...strip.children].reduce((a, c) => a + c.offsetHeight, 0);
    const room = () => (mode === 'row' ? (H * 0.92) / tallest() : (H * 0.96) / used());
    // how far the content can grow before it no longer fits the box width (rings and stacked bars need less width)
    // measured at normal size: the longest stage name and number must still fit at the bigger size
    const need = Math.max(cfg.progress === 'ring' ? 104 : 118, ...boxes.map((b) => Math.max(textW(b.querySelector('.fn-name')), textW(b.querySelector('.fn-val')), ...[...b.querySelectorAll('.fn-tl')].map((x) => [...x.children].reduce((a, c) => a + textW(c) + 6, 0)))));
    const widthK = (boxW - 4) / (need + 26);
    let k = Math.max(1, Math.min(2.4, room(), widthK));
    const apply = () => {
      strip.style.setProperty('--k', k.toFixed(3));
      strip.classList.toggle('narrow', cfg.progress === 'side' && boxW / k < 190); // side-by-side bars no longer fit next to each other
    };
    apply();
    // the bigger content may wrap (rings, bars under each other): check the height once more
    const r = room();
    if (r < 1) { k = Math.max(1, k * r); apply(); }
    // a row in a tall zone: the boxes also get taller (content spread out), so they fill the zone
    if (mode === 'row') { const t = tallest(); const h = Math.min(H * 0.92, t * 1.7); if (h > t + 8) boxes.forEach((b) => { b.style.height = h + 'px'; b.classList.add('tall'); }); }
  }
  // width of the text itself (not of the block holding it)
  function textW (el) { const r = document.createRange(); r.selectNodeContents(el); return Math.ceil(r.getBoundingClientRect().width); }
  function renderHeader (S) {
    const hdr = $('header'); const title = cfg.title || '';
    $('title').textContent = title; $('title').hidden = !title;
    let html = '';
    if (S.length > 1) {
      const last = S[S.length - 1];
      let weak = 1; for (let i = 2; i < S.length; i++) if ((S[i].ofPrev ?? 1) < (S[weak].ofPrev ?? 1)) weak = i;
      if (cfg.showOverall) html += `<div><span>${esc(S[0].label)} → ${esc(last.label)}</span><b>${fmtPct(last.ofStart)}</b></div>`;
      if (cfg.showWeakest) html += `<div><span>Weakest step</span><b class="bad">${fmtPct(S[weak].ofPrev)}</b><small>${esc(S[weak - 1].label)} → ${esc(S[weak].label)}</small></div>`;
    }
    $('summary').innerHTML = html;
    hdr.hidden = !title && !html;
  }
  function arrowEl (s, mode) {
    const el = document.createElement('div');
    el.className = 'fn-arrow';
    const txt = cfg.arrows === 'step' ? fmtPct(s.ofPrev) : (s.drop === null ? '' : (s.drop > 0 ? '−' : s.drop < 0 ? '+' : '') + fmtShort(Math.abs(s.drop), s.unit));
    const path = mode === 'column' ? 'M7 1v15M2 11l5 5 5-5' : 'M1 7h17M13 2l6 5-6 5';
    el.innerHTML = `<svg width="${mode === 'column' ? 14 : 22}" height="${mode === 'column' ? 18 : 14}" viewBox="0 0 ${mode === 'column' ? '14 18' : '22 14'}"><path d="${path}" fill="none" stroke="#c3c2b7" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span>${esc(txt)}</span>`;
    el.title = cfg.arrows === 'step' ? 'Converted from the previous stage' : 'Lost since the previous stage';
    return el;
  }
  function prevColor (p, fallback) {
    if (!cfg.prevColors || p === null) return fallback;
    const x = p * 100;
    return x < (+cfg.warnAt || 30) ? '#e34948' : x < (+cfg.goodAt || 70) ? '#eda100' : '#1baf7a';
  }
  function boxEl (s, i, short) {
    const el = document.createElement('div');
    el.className = 'fn-box' + (cfg.topBar === 'none' ? ' no-top' : '');
    el.style.setProperty('--c', s.color);
    el.style.setProperty('--top', cfg.topBar === 'single' ? (cfg.topColor || '#2a78d6') : s.color);
    const pc = prevColor(s.ofPrev, s.color);
    let prog = '';
    const bar = (cls, label, p, c) => `<div class="fn-pb ${cls}${p === null ? ' na' : ''}"><div class="fn-pl"><span>${esc(label)}</span><b>${p === null ? '–' : fmtPct(p)}</b></div><div class="fn-track"><i style="width:${p === null ? 0 : Math.max(1.5, Math.min(100, p * 100))}%;background:${c}"></i></div></div>`;
    if (cfg.progress === 'text') prog = dropText(s, i, short, pc);
    else if (cfg.progress === 'ring') prog = `<div class="fn-rings">${ring(s.ofStart, s.color, cfg.startLabel)}${ring(s.ofPrev, pc, cfg.prevLabel)}</div>`;
    else prog = `<div class="fn-pair ${cfg.progress === 'stack' ? 'stack' : 'side'}">${bar('start', cfg.startLabel, s.ofStart, s.color)}${bar('prev', cfg.prevLabel, s.ofPrev, pc)}</div>`;
    el.innerHTML = `<div class="fn-name" title="${esc(s.label)}">${esc(s.label)}</div><div class="fn-val">${esc(short ? fmtShort(s.v, s.unit) : fmtFull(s.v, s.unit))}</div>${prog}`;
    el.addEventListener('mousemove', (e) => showTip(e, s, i));
    el.addEventListener('mouseleave', hideTooltip);
    return el;
  }
  // Drop from:  Previous step: −30,234 | 20.2%   Total started: −472K | 79.8%   (previous first, then total)
  function dropText (s, i, short, pc) {
    const f = (x) => (x === null ? '–' : (x > 0 ? '−' : x < 0 ? '+' : '') + (short ? fmtShort(Math.abs(x), s.unit) : fmtFull(Math.abs(x), s.unit)));
    const kept = cfg.dropPct === 'kept';
    const line = (label, d, p, color) => (d === null
      ? `<div class="fn-tl"><span class="l">${esc(label)}</span><span class="v na">–</span></div>` // the first stage: nothing dropped yet
      : `<div class="fn-tl"><span class="l">${esc(label)}</span><span class="v">${esc(f(d))}</span><span class="sep">|</span><b${color ? ` style="color:${color}"` : ''}>${p === null ? '–' : fmtPct(kept ? p : 1 - p)}</b></div>`);
    const first = i === 0;
    return `<div class="fn-text">${cfg.dropTitle ? `<div class="fn-tt">${esc(cfg.dropTitle)}</div>` : ''}` +
      line(cfg.dropPrevLabel, first ? null : s.drop, first ? null : s.ofPrev, first || !cfg.prevColors ? null : pc) +
      line(cfg.dropStartLabel, first ? null : s.dropStart, first ? null : s.ofStart, null) + '</div>';
  }
  function ring (p, c, label) {
    const r = 13; const C = 2 * Math.PI * r; const off = p === null ? C : C * (1 - Math.max(0, Math.min(1, p)));
    return `<div class="fn-ring"><svg viewBox="0 0 34 34"><circle cx="17" cy="17" r="${r}" fill="none" stroke="var(--track)" stroke-width="5"/>` +
      `<circle cx="17" cy="17" r="${r}" fill="none" stroke="${c}" stroke-width="5" stroke-dasharray="${C}" stroke-dashoffset="${off}" transform="rotate(-90 17 17)" stroke-linecap="round"${p === null ? ' opacity="0"' : ''}/></svg>` +
      `<div><b>${p === null ? '–' : fmtPct(p)}</b>${esc(label)}</div></div>`;
  }
  function showTip (e, s, i) {
    const rows = [['Value', fmtFull(s.v, s.unit)], [cap(cfg.startLabel), s.ofStart === null ? '–' : fmtPct(s.ofStart)]];
    if (i) { rows.push([cap(cfg.prevLabel), fmtPct(s.ofPrev)]); rows.push(['Lost since previous', fmtFull(s.drop, s.unit)]); }
    const tt = $('tooltip');
    tt.innerHTML = `<div class="fn-tt-head">${esc(s.label)}</div>` + rows.map(([a, b]) => `<div class="fn-tt-row"><span>${esc(a)}</span><b>${esc(b)}</b></div>`).join('') + `<div class="fn-tt-sub">${esc(s.key)}</div>`;
    tt.hidden = false;
    const b = tt.getBoundingClientRect();
    let x = e.clientX + 14; let y = e.clientY + 14;
    if (x + b.width > innerWidth - 4) x = e.clientX - b.width - 14;
    if (y + b.height > innerHeight - 4) y = Math.max(4, e.clientY - b.height - 14);
    tt.style.left = Math.max(4, x) + 'px'; tt.style.top = y + 'px';
  }
  const cap = (t) => { t = String(t || ''); return t.charAt(0).toUpperCase() + t.slice(1); };

  // ================================================================ numbers
  function fmtPct (p) { if (p === null || p === undefined || !Number.isFinite(p)) return '–'; const a = p * 100; return (Math.abs(a) >= 10 || a === 0 ? a.toFixed(1) : a.toFixed(2)) + '%'; }
  const nf = (d) => new Intl.NumberFormat('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  // as Tableau shows it (its display unit, e.g. "892 Mn"), else the full number
  function fmtFull (v, u) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    const neg = v < 0; const n = Math.abs(v); u = u || {};
    let body;
    if (u.pct) body = nf(1).format(n * 100) + '%';
    else if (u.scale > 1) { const q = n / u.scale; body = nf(Math.max(u.decimals || 0, q < 10 ? 1 : 0)).format(q) + u.suffix; } else body = nf(u.decimals || (n < 100 && n % 1 ? 2 : 0)).format(n) + (u.suffix || '');
    return (neg ? '−' : '') + (u.prefix || '') + body;
  }
  function fmtShort (v, u) {
    if (v === null || v === undefined || !Number.isFinite(v)) return '–';
    u = u || {};
    if (u.pct || u.scale > 1) return fmtFull(v, u);
    const neg = v < 0; const n = Math.abs(v);
    const sc = (div, s) => { const q = n / div; return nf(q < 10 ? 2 : q < 100 ? 1 : 0).format(q) + s; };
    const body = n >= 1e9 ? sc(1e9, 'B') : n >= 1e6 ? sc(1e6, 'M') : n >= 1e4 ? sc(1e3, 'K') : nf(n % 1 ? 1 : 0).format(n);
    return (neg ? '−' : '') + (u.prefix || '') + body;
  }

  // ================================================================ chrome + settings
  function applyStyle () {
    const r = document.documentElement.style;
    r.setProperty('--surface', cfg.background === 'white' ? '#ffffff' : cfg.background === 'custom' ? (cfg.bgColor || '#ffffff') : 'transparent');
    r.setProperty('--box', cfg.boxFill === 'transparent' ? 'transparent' : cfg.boxFill === 'custom' ? (cfg.boxColor || '#ffffff') : '#ffffff');
    r.setProperty('--box-border', cfg.boxBorder ? 'var(--line)' : 'transparent');
    r.setProperty('--name-size', (+cfg.nameSize || 12) + 'px'); r.setProperty('--value-size', (+cfg.valueSize || 22) + 'px'); r.setProperty('--title-size', (+cfg.titleSize || 14) + 'px');
    r.setProperty('--name-color', cfg.nameColor || '#52514e'); r.setProperty('--value-color', cfg.valueColor || '#0b0b0b');
  }
  function hideTooltip () { const t = $('tooltip'); if (t) t.hidden = true; }
  function showEmpty (html) { const el = $('empty'); el.innerHTML = `<div>${html}</div>`; el.hidden = false; }
  function loadSettings () {
    let saved = {};
    try { const raw = tableau.extensions.settings.get('config'); if (raw) saved = JSON.parse(raw); } catch (e) { /* none */ }
    if (saved.header === false && saved.showOverall === undefined) { saved.showOverall = false; saved.showWeakest = false; } // 1.0.0 had one switch
    cfg = { ...DEFAULTS, ...saved }; cfg.stages = cfg.stages || {}; cfg.order = Array.isArray(cfg.order) ? cfg.order : [];
  }
  async function openFormatDialog () {
    const url = new URL('format.html' + window.location.search, window.location.href).href;
    const stages = model && model.stages ? model.stages.map((s) => ({ key: s.key, name: s.name })) : [];
    try { await tableau.extensions.ui.displayDialogAsync(url, JSON.stringify({ ctx: { stages }, defaults: DEFAULTS, palette: PALETTE }), { width: 520, height: 720 }); } catch (e) { if (!(tableau.ErrorCodes && e.errorCode === tableau.ErrorCodes.DialogClosedByUser)) console.error(e); }
    loadSettings(); render();
  }

  // ================================================================ helpers
  function toNumber (dv) { if (!dv) return null; const v = typeof dv.nativeValue === 'number' ? dv.nativeValue : (dv.nativeValue === null ? NaN : Number(dv.value)); return Number.isFinite(v) ? v : null; }
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
