/* Smart Table – Tableau Viz Extension
 * A light, fast flat table for large data:
 *  - columnar data + virtual scrolling (only the visible rows exist in the page)
 *  - sort and filter any column, search across columns, totals row
 *  - conditional formatting (rules.js), frozen columns, resizable columns
 *  - row selection is sent to Tableau (drives dashboard filter/highlight actions);
 *    filters from other sheets reload the table (SummaryDataChanged)
 * No chart libraries needed.
 */
/* global tableau, SmartRules, ExtMenu */
'use strict';

(function () {
  const DEFAULTS = {
    title: '',
    showToolbar: true,
    showSearch: true,
    titleSize: 16,
    fitWidth: true, // stretch columns to fill the sheet width
    headerLines: '3', // header text wraps up to this many lines: '1' | '2' | '3' | 'all'
    headerHeight: 0, // minimum header height in px (0 = fit the text); drag the header's bottom edge to change
    showDownload: true,
    initialRows: '500', // rows loaded first: '100' | '500' | '1000' | '5000' | 'all'
    density: 'normal', // compact | normal | comfortable
    fontSize: 12, // text (dimension) cells
    valueSize: 12, // number (measure) cells and totals
    headerSize: 12, // column headers
    zebra: true,
    gridlines: 'rows', // none | rows | all
    headerBg: '#f4f4f1',
    headerInk: '#0b0b0b',
    background: 'white', // white | transparent | custom
    bgColor: '#ffffff',
    freeze: 0, // number of columns frozen on the left
    rowNumbers: false,
    totals: 'none', // none | sum | avg
    selectToTableau: true,
    accent: '#2a78d6',
    columns: {}, // key -> { label, hidden, align, width }
    rules: [] // see rules.js
  };
  const ROW_H = { compact: 24, normal: 28, comfortable: 34 };
  const OVERSCAN = 6;
  const PAGE_ROWS = 10000;

  let cfg = { ...DEFAULTS };
  let worksheet = null;

  // data (columnar)
  let N = 0;
  let cols = []; // displayed + extra columns
  let shown = []; // columns visible in the table, in order
  let tupleIds = null; // Uint32Array
  let signature = '';

  // view
  let view = new Uint32Array(0); // row indexes in display order
  const filters = new Map(); // key -> filter
  let search = '';
  let searchIndex = null;
  let sort = null; // { key, dir: 1 | -1 }
  let styleFor = null; // compiled conditional formatting
  const selected = new Set(); // row indexes
  let anchorPos = -1;

  // layout
  let rowH = 28;
  let pool = [];
  let widths = [];
  let lefts = [];
  let totalW = 0;
  let rafPending = false;
  let loadingToken = 0;
  let totalRows = 0; // rows Tableau has for this sheet
  let loadedAll = true; // false while only the first rows are loaded

  const $ = (id) => document.getElementById(id);
  const scroller = $('scroller');
  const bodyEl = $('body');
  const headEl = $('head');
  const footEl = $('foot');

  // ================================================================ init
  async function init () {
    try {
      await tableau.extensions.initializeAsync({ configure: openFormatDialog });
    } catch (e) {
      status(`<b>Could not start the extension.</b><br>${esc(e.message || e)}`);
      return;
    }
    worksheet = tableau.extensions.worksheetContent.worksheet;
    loadSettings();

    // Filters and actions from other sheets change our summary data -> reload
    worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, debounce(() => load(false), 150));
    try {
      tableau.extensions.settings.addEventListener(tableau.TableauEventType.SettingsChanged, onSettingsChanged);
    } catch (e) { /* not available */ }

    scroller.addEventListener('scroll', scheduleRows, { passive: true });
    new ResizeObserver(debounce(() => { if (cfg.fitWidth && N) { layout(); afterView(true); } else { buildPool(); renderRows(true); } }, 60)).observe(scroller);
    bodyEl.addEventListener('click', onRowClick);
    bodyEl.addEventListener('mousedown', (e) => { if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault(); }); // no text highlight on multi-select
    headEl.addEventListener('click', onHeadClick);
    headEl.addEventListener('mousedown', onResizeStart);
    headEl.addEventListener('mousedown', onHeadHeightStart);
    headEl.addEventListener('dblclick', (e) => {
      if (!e.target.classList.contains('t-head-rz')) return;
      cfg.headerHeight = 0; document.documentElement.style.setProperty('--head-min', '0px'); saveSettingsQuiet(); renderRows(true);
    });
    $('search').addEventListener('input', debounce((e) => { search = e.target.value.trim().toLowerCase(); recompute(); }, 150));
    $('loadAll').addEventListener('click', () => load(true));
    $('dl').addEventListener('click', (e) => { e.stopPropagation(); toggleDownloadMenu(); });
    $('clearFilters').addEventListener('click', () => { filters.clear(); search = ''; $('search').value = ''; recompute(); });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { if (!$('popover').hidden) closePopover(); else if (selected.size) { selected.clear(); syncSelection(); renderRows(true); } }
    });
    document.addEventListener('mousedown', (e) => { if (!$('dlMenu').hidden && !e.target.closest('#dlMenu') && !e.target.closest('#dl')) $('dlMenu').hidden = true; });
    document.addEventListener('mousedown', (e) => { if (!$('popover').hidden && !$('popover').contains(e.target) && !e.target.closest('.flt')) closePopover(); });

    // right-click menu: Format Extension (authors), header sort/filter, load all, clear filters, download, copy
    ExtMenu.attach((e) => {
      const items = [];
      const head = e.target.closest && e.target.closest('#head [data-key]');
      if (head) {
        const key = head.dataset.key;
        items.push({ label: 'Sort ascending', icon: 'up', action: () => { sort = { key, dir: 1 }; recompute(true); } });
        items.push({ label: 'Sort descending', icon: 'down', action: () => { sort = { key, dir: -1 }; recompute(true); } });
        items.push({ label: 'Filter this column…', icon: 'filter', action: () => openPopover(key, head.querySelector('.flt') || head) });
        items.push('separator');
      }
      if (ExtMenu.authoring()) items.push({ label: 'Format Extension…', icon: 'format', action: openFormatDialog }, 'separator');
      if (N && !loadedAll) items.push({ label: `Load all ${totalRows.toLocaleString()} rows`, icon: 'load', action: () => load(true) });
      if (filters.size || search) items.push({ label: 'Clear filters', icon: 'clear', action: () => $('clearFilters').click() });
      if (N) {
        items.push({ label: 'Download CSV', icon: 'download', hint: `${view.length.toLocaleString()} rows`, action: downloadCsv });
        items.push({ label: 'Copy to clipboard', icon: 'copy', action: copyRows });
      }
      return items;
    });

    load(false);
  }

  // ================================================================ data
  async function getEncodings () {
    const spec = await worksheet.getVisualSpecificationAsync();
    const map = {};
    if (spec.activeMarksSpecificationIndex < 0) return map;
    for (const enc of spec.marksSpecifications[spec.activeMarksSpecificationIndex].encodings) {
      (map[enc.id] = map[enc.id] || []).push(enc.field);
    }
    return map;
  }

  // Loads only the first rows (cfg.initialRows) unless all === true. Reading fewer rows from Tableau
  // is what makes big sheets open fast; "Load all" fetches the rest.
  async function load (all) {
    all = all === true;
    const limit = all || cfg.initialRows === 'all' ? Infinity : (+cfg.initialRows || 500);
    const token = ++loadingToken;
    const t0 = performance.now();
    try {
      const enc = await getEncodings();
      const fields = enc.fields || [];
      if (!fields.length) { N = 0; cols = []; shown = []; layout(); status('Drag fields onto the <b>Fields</b> shelf to build the table.<br><span style="color:var(--ink-3)">Dimensions and measures, in the order you want the columns.</span>'); return; }

      if (all) status('Loading all rows…');
      const reader = await worksheet.getSummaryDataReaderAsync(Math.min(limit, PAGE_ROWS), { ignoreSelection: true });
      const total = reader.totalRowCount || 0;
      const tRead = performance.now();
      let built = null;
      let offset = 0;
      let tWait = 0;
      for (let p = 0; p < reader.pageCount && offset < limit; p++) {
        if (token !== loadingToken) { await reader.releaseAsync(); return; }
        const tw = performance.now();
        const page = await reader.getPageAsync(p);
        tWait += performance.now() - tw;
        if (!built) built = allocate(page.columns, Math.max(Math.min(total, limit), page.data.length));
        fill(built, page, offset);
        offset += page.data.length;
        if (reader.pageCount > 1 && limit > PAGE_ROWS) status(`Loading rows… ${offset.toLocaleString()} of ${total.toLocaleString()}`);
      }
      await reader.releaseAsync();
      if (token !== loadingToken) return;
      if (!built) built = allocate([], 0);
      const tFin = performance.now();
      totalRows = Math.max(total, offset);
      loadedAll = offset >= totalRows;
      finish(built, offset, fields);
      console.log(`[Smart Table] ${N.toLocaleString()} rows × ${cols.length} columns in ${Math.round(performance.now() - t0)} ms ` +
        `(Tableau: ${Math.round(tRead - t0 + tWait)} ms, reading: ${Math.round(tFin - tRead - tWait)} ms, layout+render: ${Math.round(performance.now() - tFin)} ms)`);
    } catch (e) {
      console.error(e);
      status(`<b>Something went wrong.</b><br>${esc(e.message || e)}`);
    }
  }

  function allocate (columns, n) {
    return {
      n,
      tuple: new Uint32Array(n),
      cols: columns.map((c) => {
        const dt = String(c.dataType || '').toLowerCase();
        const type = dt === 'float' || dt === 'int' ? 'number' : dt === 'date' || dt === 'date-time' || dt === 'datetime' ? 'date' : dt === 'bool' ? 'bool' : dt ? 'string' : 'auto';
        return { key: c.fieldName, index: c.index, type, num: type === 'number' || type === 'date' || type === 'auto' ? new Float64Array(n).fill(NaN) : null, txt: new Array(n) };
      })
    };
  }

  function fill (b, page, offset) {
    const rows = page.data;
    for (let r = 0; r < rows.length; r++) {
      const i = offset + r;
      if (i >= b.n) grow(b, Math.max(b.n * 2, i + 1));
      b.tuple[i] = i + 1;
      const row = rows[r];
      for (const c of b.cols) {
        const dv = row[c.index];
        const nv = dv.nativeValue;
        c.txt[i] = nv === null || nv === undefined ? '' : String(dv.formattedValue ?? dv.value ?? '');
        if (c.num) {
          if (typeof nv === 'number') c.num[i] = nv;
          else if (nv instanceof Date) c.num[i] = +nv;
          else if (c.type === 'auto' && nv !== null && nv !== undefined) c.num[i] = NaN, c.sawText = true;
        }
      }
    }
  }

  function grow (b, n) {
    const t = new Uint32Array(n); t.set(b.tuple); b.tuple = t;
    for (const c of b.cols) { if (c.num) { const a = new Float64Array(n).fill(NaN); a.set(c.num); c.num = a; } c.txt.length = n; }
    b.n = n;
  }

  function finish (b, n, fields) {
    N = n;
    tupleIds = b.tuple.subarray(0, n);
    for (const c of b.cols) {
      if (c.num && c.num.length !== n) c.num = c.num.subarray(0, n);
      c.txt.length = n;
      if (c.type === 'auto') c.type = c.sawText ? 'string' : 'number';
      if (c.type === 'string' || c.type === 'bool') c.num = null;
      c.name = cleanName(c.key);
      c.unit = detectUnit(c.txt.find((t) => t) || '');
    }
    cols = b.cols;
    const names = cols.map((c) => c.key);
    const order = fields.map((f) => resolve(f.name, names)).filter(Boolean);
    shown = order.map((k) => cols.find((c) => c.key === k)).filter(Boolean);

    // Skip resetting state when Tableau re-sends the same data (e.g. after our own selection)
    const sig = n + '|' + names.join(',') + '|' + cols.map((c) => [0, n >> 1, n - 1].map((i) => c.txt[i]).join('~')).join('|');
    const same = sig === signature;
    signature = sig;
    if (!same) { selected.clear(); anchorPos = -1; searchIndex = null; distinctCache.clear(); rankCache.clear(); }
    for (const k of [...filters.keys()]) if (!cols.some((c) => c.key === k)) filters.delete(k);
    if (sort && !cols.some((c) => c.key === sort.key)) sort = null;

    status(null);
    applySettings(true);
  }

  // ================================================================ settings / layout
  function loadSettings () {
    let saved = {};
    try { const raw = tableau.extensions.settings.get('config'); if (raw) saved = JSON.parse(raw); } catch (e) { /* none */ }
    if (saved.fontSize && saved.valueSize === undefined) { saved.valueSize = saved.fontSize; saved.headerSize = saved.fontSize; } // v1.2 had one size
    cfg = { ...DEFAULTS, ...saved };
    cfg.columns = cfg.columns || {};
    cfg.rules = Array.isArray(cfg.rules) ? cfg.rules : [];
  }

  function applySettings (dataChanged) {
    const root = document.documentElement.style;
    // rows grow with the larger of the two cell text sizes
    rowH = Math.max(ROW_H[cfg.density] || 28, Math.ceil(Math.max(+cfg.fontSize || 12, +cfg.valueSize || 12) * 1.45 + 8));
    root.setProperty('--row-h', rowH + 'px');
    root.setProperty('--font', (+cfg.fontSize || 12) + 'px');
    root.setProperty('--val-size', (+cfg.valueSize || +cfg.fontSize || 12) + 'px');
    root.setProperty('--head-size', (+cfg.headerSize || +cfg.fontSize || 12) + 'px');
    root.setProperty('--head-bg', cfg.headerBg);
    root.setProperty('--head-ink', cfg.headerInk);
    root.setProperty('--title-size', (+cfg.titleSize || 16) + 'px');
    root.setProperty('--head-lines', cfg.headerLines === 'all' ? 99 : (+cfg.headerLines || 3));
    root.setProperty('--head-min', (+cfg.headerHeight || 0) + 'px');
    root.setProperty('--accent', cfg.accent);
    const base = cfg.background === 'transparent' ? 'transparent' : cfg.background === 'custom' ? cfg.bgColor : '#ffffff';
    root.setProperty('--bg', base);
    root.setProperty('--base', base);
    root.setProperty('--solid', base === 'transparent' ? '#ffffff' : base);
    document.body.className = [cfg.zebra ? 'zebra' : '', 'grid-' + cfg.gridlines, String(cfg.headerLines) === '1' ? 'head-1' : ''].join(' ');

    $('toolbar').hidden = !cfg.showToolbar;
    $('dl').hidden = !cfg.showDownload;
    $('title').textContent = cfg.title || '';
    $('search').parentElement.hidden = !cfg.showSearch;

    const getCol = (k) => cols.find((c) => c.key === k);
    styleFor = N ? SmartRules.compile(cfg.rules, getCol) : null;
    layout();
    recompute(!dataChanged);
  }

  function layout () {
    const visible = shown.filter((c) => !(cfg.columns[c.key] || {}).hidden);
    const fam = getComputedStyle(document.body).fontFamily; // measure with the real font
    const font = `${+cfg.fontSize || 12}px ${fam}`;
    const valFont = `${+cfg.valueSize || +cfg.fontSize || 12}px ${fam}`;
    const headFont = `${+cfg.headerSize || +cfg.fontSize || 12}px ${fam}`;
    const ctx = document.createElement('canvas').getContext('2d');
    widths = []; lefts = [];
    let x = 0;
    const layoutCols = [];
    if (cfg.rowNumbers) layoutCols.push({ rn: true, key: '#', label: '#', w: Math.max(36, String(N).length * 8 + 16) });
    for (const c of visible) {
      const cc = cfg.columns[c.key] || {};
      c.label = cc.label || c.name;
      c.align = cc.align && cc.align !== 'auto' ? cc.align : (c.num && c.type === 'number' ? 'right' : 'left');
      let w = +cc.width;
      if (!w) {
        ctx.font = '600 ' + headFont;
        const labelW = ctx.measureText(c.label).width;
        if (String(cfg.headerLines) === '1') w = labelW + 44; // label + sort/filter icons on one line
        else { // long headers wrap: only the longest word must fit, the rest goes to the next lines
          const word = Math.max(...c.label.split(/\s+/).map((t) => ctx.measureText(t).width));
          w = Math.max(word + 44, Math.min(labelW + 44, 150));
        }
        ctx.font = c.type === 'number' ? valFont : font;
        const step = Math.max(1, Math.floor(N / 400));
        const k = c.num ? 1.13 : 1.02; // the table uses tabular (wider) digits; canvas measures proportional ones
        for (let i = 0; i < N; i += step) { const tw = ctx.measureText(c.txt[i] || '').width * k + 20; if (tw > w) w = tw; }
        if (cfg.totals !== 'none' && c.type === 'number' && c.num) { // leave room for the total
          let t = 0; for (let i = 0; i < N; i++) { const v = c.num[i]; if (v === v) t += Math.abs(v); }
          ctx.font = '600 ' + valFont;
          w = Math.max(w, ctx.measureText(fmtNum(c.unit.pct ? 1 : t, c.unit)).width * k + 24);
        }
        w = Math.min(Math.max(Math.ceil(w), 64), 360);
      }
      layoutCols.push({ col: c, key: c.key, label: c.label, w });
    }
    // spread spare width over the columns (manually resized ones keep their width)
    const avail = (scroller.clientWidth || 0) - 1;
    const sum = layoutCols.reduce((a, lc) => a + lc.w, 0);
    if (cfg.fitWidth && avail > sum) {
      const flex = layoutCols.filter((lc) => !lc.rn && !(cfg.columns[lc.key] || {}).width);
      const base = flex.reduce((a, lc) => a + lc.w, 0);
      if (base) flex.forEach((lc) => { lc.w = Math.floor(lc.w + (avail - sum) * lc.w / base); });
    }
    for (const lc of layoutCols) { lc.x = x; x += lc.w; }
    totalW = x;
    layoutCols.forEach((lc) => { widths.push(lc.w); lefts.push(lc.x); });
    layout.cols = layoutCols;
    const frozenN = Math.min(+cfg.freeze || 0, visible.length) + (cfg.rowNumbers && +cfg.freeze > 0 ? 1 : 0);
    layout.frozen = frozenN;
    $('sizer').style.width = Math.max(totalW, 1) + 'px';
    renderHead();
    buildPool();
  }

  // ================================================================ filter + sort
  const distinctCache = new Map();
  const rankCache = new Map();
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

  function recompute (keepScroll) {
    if (!N) { view = new Uint32Array(0); afterView(keepScroll); return; }
    const tests = [];
    for (const f of filters.values()) {
      const c = cols.find((x) => x.key === f.key);
      if (!c) continue;
      if (f.type === 'values') { const set = f.set; const t = c.txt; tests.push((i) => set.has(t[i])); }
      if (f.type === 'range') {
        const a = c.num; const lo = f.min ?? -Infinity; const hi = f.max ?? Infinity;
        tests.push((i) => { const v = a[i]; return v >= lo && v <= hi; });
      }
      if (f.type === 'contains') { const q = f.q.toLowerCase(); const t = c.txt; tests.push((i) => (t[i] || '').toLowerCase().includes(q)); }
    }
    if (search) {
      if (!searchIndex) buildSearchIndex();
      const q = search; const s = searchIndex;
      tests.push((i) => s[i].includes(q));
    }
    let out;
    if (!tests.length) { out = new Uint32Array(N); for (let i = 0; i < N; i++) out[i] = i; } else {
      const tmp = new Uint32Array(N); let k = 0;
      outer: for (let i = 0; i < N; i++) { for (const t of tests) if (!t(i)) continue outer; tmp[k++] = i; }
      out = tmp.slice(0, k);
    }
    if (sort) {
      const c = cols.find((x) => x.key === sort.key);
      const d = sort.dir;
      if (c && c.num) {
        const a = c.num;
        out.sort((x, y) => { const p = a[x]; const q = a[y]; if (p !== p) return q !== q ? 0 : 1; if (q !== q) return -1; return (p - q) * d; });
      } else if (c) {
        const rank = getRank(c);
        out.sort((x, y) => (rank[x] - rank[y]) * d || x - y);
      }
    }
    view = out;
    afterView(keepScroll);
  }

  function getRank (c) {
    if (rankCache.has(c.key)) return rankCache.get(c.key);
    const uniq = [...new Set(c.txt)].sort(collator.compare);
    const m = new Map(uniq.map((v, i) => [v, i]));
    const rank = new Int32Array(N);
    for (let i = 0; i < N; i++) rank[i] = c.txt[i] === '' ? 1e9 : m.get(c.txt[i]);
    rankCache.set(c.key, rank);
    return rank;
  }

  function buildSearchIndex () {
    searchIndex = new Array(N);
    const txts = shown.map((c) => c.txt);
    for (let i = 0; i < N; i++) { let s = ''; for (const t of txts) s += (t[i] || '') + '\u0001'; searchIndex[i] = s.toLowerCase(); }
  }

  function afterView (keepScroll) {
    $('sizer').style.height = '';
    bodyEl.style.height = view.length * rowH + 'px';
    if (!keepScroll) scroller.scrollTop = 0;
    const nf = filters.size + (search ? 1 : 0);
    $('clearFilters').hidden = !nf;
    $('clearFilters').textContent = `Clear ${nf} filter${nf > 1 ? 's' : ''} ✕`;
    updateCount();
    renderHead();
    renderFoot();
    renderRows(true);
    if (N && !view.length) status('No rows match the filters.'); else if (N) status(null);
  }

  function updateCount () {
    const f = (n) => n.toLocaleString();
    let t = '';
    if (N) {
      if (loadedAll) t = view.length === N ? `${f(N)} rows` : `${f(view.length)} of ${f(N)} rows`;
      else t = view.length === N ? `First ${f(N)} of ${f(totalRows)} rows` : `${f(view.length)} of first ${f(N)} (${f(totalRows)} total)`;
    }
    if (selected.size) t += ` · ${f(selected.size)} selected`;
    $('count').textContent = t;
    $('loadAll').hidden = loadedAll || !N;
    $('loadAll').textContent = `Load all ${f(totalRows)}`;
    $('toolbar').hidden = !(cfg.showToolbar || (!loadedAll && N));
  }

  // ================================================================ download / copy
  function toggleDownloadMenu () {
    const m = $('dlMenu');
    if (!m.hidden) { m.hidden = true; return; }
    const f = (n) => n.toLocaleString();
    const items = [];
    if (loadedAll) items.push(['csv', `Download CSV <small>${f(view.length)} rows</small>`]);
    else {
      items.push(['csv', `Download CSV – loaded rows <small>${f(view.length)}</small>`]);
      items.push(['csvAll', `Download CSV – all rows <small>${f(totalRows)}, loads them first</small>`]);
    }
    items.push(['copy', `Copy to clipboard <small>paste into Excel</small>`]);
    m.innerHTML = items.map(([k, t]) => `<button data-dl="${k}">${t}</button>`).join('') +
      (selected.size ? '<div class="t-dl-note">Selected rows are not exported separately; filters and sort are.</div>' : '');
    m.hidden = false;
    m.onclick = async (e) => {
      const b = e.target.closest('[data-dl]');
      if (!b) return;
      m.hidden = true;
      if (b.dataset.dl === 'csvAll') { await load(true); downloadCsv(); } else if (b.dataset.dl === 'csv') downloadCsv(); else copyRows();
    };
  }

  function exportCols () { return (layout.cols || []).filter((lc) => !lc.rn); }

  function cellOut (c, r) {
    if (c.type === 'number') { const v = c.num[r]; return v === v ? String(v) : ''; }
    if (c.type === 'date') {
      const v = c.num[r];
      if (v !== v) return '';
      const iso = new Date(v).toISOString();
      return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 19).replace('T', ' ');
    }
    return c.txt[r] || '';
  }

  function build (sep) {
    const lcs = exportCols();
    const q = (v) => (/[",\n\r\t]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
    const lines = [lcs.map((lc) => q(lc.label)).join(sep)];
    for (let k = 0; k < view.length; k++) {
      const r = view[k];
      let line = '';
      for (let j = 0; j < lcs.length; j++) line += (j ? sep : '') + q(cellOut(lcs[j].col, r));
      lines.push(line);
    }
    return lines.join('\r\n');
  }

  function downloadCsv () {
    const name = (cfg.title || 'table').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '-') + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    const blob = new Blob(['\ufeff' + build(',')], { type: 'text/csv;charset=utf-8' }); // BOM: Excel reads Arabic text correctly
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    toast(`Downloading ${view.length.toLocaleString()} rows (${name})`);
  }

  function copyRows () {
    const text = build('\t');
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px;top:0';
    document.body.appendChild(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    if (!ok && navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast(`Copied ${view.length.toLocaleString()} rows – paste into Excel`), () => toast('Copy was blocked here – use Download CSV'));
    else toast(ok ? `Copied ${view.length.toLocaleString()} rows – paste into Excel` : 'Copy was blocked here – use Download CSV');
  }

  let toastTimer = null;
  function toast (msg) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
  }

  // ================================================================ rendering
  function cellClass (lc, i) {
    let cls = 't-cell';
    if (lc.rn) cls += ' rn';
    else cls += ' ' + lc.col.align + (lc.col.type === 'number' ? ' num' : '');
    if (i < layout.frozen) cls += ' frozen' + (i === layout.frozen - 1 ? ' frozen-last' : '');
    return cls;
  }

  function renderHead () {
    const lcs = layout.cols || [];
    headEl.style.width = totalW + 'px';
    headEl.innerHTML = lcs.map((lc, i) => {
      const style = `width:${lc.w}px;${i < layout.frozen ? `left:${lc.x}px;` : ''}`;
      if (lc.rn) return `<div class="${cellClass(lc, i)}" style="${style}">#</div>`;
      const s = sort && sort.key === lc.key ? (sort.dir > 0 ? '▲' : '▼') : '';
      const on = filters.has(lc.key) ? ' on' : '';
      const just = lc.col.align === 'right' ? 'flex-direction:row-reverse;' : '';
      return `<div class="${cellClass(lc, i)}" style="${style}${just}" data-key="${esc(lc.key)}" title="${esc(lc.label)}">` +
        `<span class="lbl"${lc.col.align === 'right' ? ' style="text-align:right"' : lc.col.align === 'center' ? ' style="text-align:center"' : ''}>${esc(lc.label)}</span><span class="sort">${s}</span>` +
        `<button class="flt${on}" title="Sort &amp; filter" data-flt="${esc(lc.key)}"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M3 5h18l-7 8v6l-4-2v-4z"/></svg></button>` +
        `<span class="rz" data-rz="${i}"></span></div>`;
    }).join('') + '<div class="t-head-rz" title="Drag to make the header taller (double-click to reset)"></div>';
  }

  // drag the header's bottom edge to make it taller
  function onHeadHeightStart (e) {
    if (!e.target.classList.contains('t-head-rz')) return;
    e.preventDefault(); e.stopPropagation();
    const y0 = e.clientY; const h0 = headEl.offsetHeight;
    const move = (ev) => { document.documentElement.style.setProperty('--head-min', Math.max(rowH, Math.min(240, h0 + ev.clientY - y0)) + 'px'); };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      cfg.headerHeight = Math.round(headEl.offsetHeight);
      saveSettingsQuiet();
      renderRows(true);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  function renderFoot () {
    const lcs = layout.cols || [];
    if (cfg.totals === 'none' || !N || !lcs.some((lc) => lc.col && lc.col.type === 'number')) { footEl.hidden = true; return; }
    footEl.hidden = false;
    footEl.style.width = totalW + 'px';
    let labelled = false;
    footEl.innerHTML = lcs.map((lc, i) => {
      const style = `width:${lc.w}px;${i < layout.frozen ? `left:${lc.x}px;` : ''}`;
      let txt = '';
      if (lc.col && lc.col.type === 'number') {
        const a = lc.col.num; let s = 0; let n = 0;
        for (let k = 0; k < view.length; k++) { const v = a[view[k]]; if (v === v) { s += v; n++; } }
        const avg = cfg.totals === 'avg' || lc.col.unit.pct; // % values are averaged, never summed
        txt = n ? fmtNum(avg ? s / n : s, lc.col.unit) : '';
      } else if (!labelled && !lc.rn) { txt = cfg.totals === 'avg' ? 'Average' : 'Total'; labelled = true; }
      return `<div class="${cellClass(lc, i)}" style="${style}" title="${esc(txt)}"><span>${esc(txt)}</span></div>`;
    }).join('');
  }

  function buildPool () {
    const lcs = layout.cols || [];
    const need = Math.ceil((scroller.clientHeight || 400) / rowH) + OVERSCAN * 2;
    bodyEl.innerHTML = '';
    pool = [];
    bodyEl.style.width = totalW + 'px';
    for (let p = 0; p < need; p++) {
      const row = document.createElement('div');
      row.className = 't-row';
      row.style.width = totalW + 'px';
      const cells = lcs.map((lc, i) => {
        const cell = document.createElement('div');
        cell.className = cellClass(lc, i);
        cell.style.width = lc.w + 'px';
        if (i < layout.frozen) cell.style.left = lc.x + 'px';
        const span = document.createElement('span');
        cell.appendChild(span);
        row.appendChild(cell);
        return { el: cell, span, lc, styled: false };
      });
      row.hidden = true;
      bodyEl.appendChild(row);
      pool.push({ el: row, cells, pos: -1 });
    }
  }

  function scheduleRows () {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => { rafPending = false; renderRows(false); });
  }

  function renderRows (force) {
    if (!pool.length) return;
    const first = Math.max(0, Math.floor(scroller.scrollTop / rowH) - OVERSCAN);
    for (let p = 0; p < pool.length; p++) {
      const slot = pool[p];
      const pos = first + p;
      if (pos >= view.length) { if (!slot.el.hidden) slot.el.hidden = true; slot.pos = -1; continue; }
      if (!force && slot.pos === pos) continue;
      slot.pos = pos;
      const r = view[pos];
      const el = slot.el;
      el.hidden = false;
      el.style.transform = `translateY(${pos * rowH}px)`;
      el.dataset.pos = pos;
      el.className = 't-row' + (pos & 1 ? ' odd' : '') + (selected.has(r) ? ' sel' : '');
      const st = styleFor ? styleFor(r) : null;
      const rowSt = st && st.row;
      for (const c of slot.cells) {
        const lc = c.lc;
        if (lc.rn) { c.span.textContent = pos + 1; continue; }
        const txt = lc.col.txt[r] || '';
        c.span.textContent = txt;
        c.el.title = txt.length > 18 ? txt : '';
        const cs = st && st.cells[lc.key];
        if (cs || rowSt || c.styled) paint(c, cs, rowSt);
      }
    }
  }

  function paint (c, cs, rowSt) {
    const s = c.el.style;
    const bg = (cs && cs.bg) || (rowSt && rowSt.bg) || '';
    const fg = (cs && cs.fg) || (rowSt && rowSt.fg) || '';
    const bold = (cs && cs.bold) || (rowSt && rowSt.bold);
    s.backgroundColor = bg;
    s.color = fg;
    s.fontWeight = bold ? '700' : '';
    s.backgroundImage = cs && cs.bar !== undefined
      ? `linear-gradient(to right, ${cs.barColor} ${Math.round(cs.bar * 100)}%, transparent ${Math.round(cs.bar * 100)}%)` : '';
    if (cs && cs.arrow) { c.el.dataset.arrow = cs.arrow; s.setProperty('--arrow', cs.arrowColor); } else if (c.el.dataset.arrow) delete c.el.dataset.arrow;
    c.styled = !!(cs || rowSt);
  }

  // ================================================================ selection -> Tableau actions
  function onRowClick (e) {
    const rowEl = e.target.closest('.t-row');
    if (!rowEl || rowEl.dataset.pos === undefined) return;
    const pos = +rowEl.dataset.pos;
    const r = view[pos];
    if (e.shiftKey && anchorPos >= 0) {
      if (!(e.ctrlKey || e.metaKey)) selected.clear();
      const [a, b] = anchorPos < pos ? [anchorPos, pos] : [pos, anchorPos];
      for (let k = a; k <= b; k++) selected.add(view[k]);
    } else if (e.ctrlKey || e.metaKey) {
      if (selected.has(r)) selected.delete(r); else selected.add(r);
      anchorPos = pos;
    } else {
      const only = selected.size === 1 && selected.has(r);
      selected.clear();
      if (!only) selected.add(r);
      anchorPos = pos;
    }
    syncSelection(e);
    afterSelection();
  }

  function afterSelection () {
    renderRows(true);
    updateCount();
  }

  function syncSelection (e) {
    if (!cfg.selectToTableau) return;
    const ids = [...selected].map((r) => tupleIds[r]);
    const anchor = e ? { tooltipAnchorPoint: { x: e.pageX, y: e.pageY } } : undefined;
    worksheet.selectTuplesAsync(ids, tableau.SelectOptions.Simple, anchor).catch((err) => console.warn('selectTuplesAsync', err));
  }

  // ================================================================ header: sort, filter, resize
  function onHeadClick (e) {
    const fb = e.target.closest('[data-flt]');
    if (fb) { e.stopPropagation(); openPopover(fb.dataset.flt, fb); return; }
    if (e.target.closest('.rz')) return;
    const cell = e.target.closest('[data-key]');
    if (!cell) return;
    const key = cell.dataset.key;
    if (!sort || sort.key !== key) sort = { key, dir: 1 };
    else if (sort.dir === 1) sort.dir = -1;
    else sort = null;
    recompute(true);
  }

  function onResizeStart (e) {
    const h = e.target.closest('[data-rz]');
    if (!h) return;
    e.preventDefault(); e.stopPropagation();
    const i = +h.dataset.rz;
    const lc = layout.cols[i];
    const x0 = e.clientX; const w0 = lc.w;
    const move = (ev) => {
      lc.w = Math.max(40, w0 + ev.clientX - x0);
      headEl.children[i].style.width = lc.w + 'px';
    };
    const up = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', up);
      cfg.columns[lc.key] = { ...(cfg.columns[lc.key] || {}), width: Math.round(lc.w) };
      saveSettingsQuiet();
      layout(); afterView(true);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  }

  const saveSettingsQuiet = debounce(async () => {
    try { tableau.extensions.settings.set('config', JSON.stringify(cfg)); await tableau.extensions.settings.saveAsync(); } catch (e) { /* viewing mode: keep for this session */ }
  }, 400);

  function distinct (c) {
    if (distinctCache.has(c.key)) return distinctCache.get(c.key);
    const m = new Map();
    for (let i = 0; i < N; i++) { const v = c.txt[i]; m.set(v, (m.get(v) || 0) + 1); }
    const list = [...m.entries()].sort((a, b) => collator.compare(a[0], b[0]));
    distinctCache.set(c.key, list);
    return list;
  }

  function openPopover (key, btn) {
    const c = cols.find((x) => x.key === key);
    if (!c) return;
    const pop = $('popover');
    const f = filters.get(key);
    const sortBtns = `<div class="sorts"><button data-s="1" class="${sort && sort.key === key && sort.dir === 1 ? 'on' : ''}">Sort ▲</button><button data-s="-1" class="${sort && sort.key === key && sort.dir === -1 ? 'on' : ''}">Sort ▼</button></div>`;
    let body = '';
    let useList = !c.num;
    if (c.num) {
      const dist = distinct(c);
      if (c.type === 'number' && dist.length <= 12) useList = true; // few distinct numbers: tick them
      if (!useList) {
        let lo = Infinity; let hi = -Infinity;
        for (let i = 0; i < N; i++) { const v = c.num[i]; if (v === v) { if (v < lo) lo = v; if (v > hi) hi = v; } }
        const isDate = c.type === 'date';
        const toIn = (v) => (v === undefined || v === null || !isFinite(v) ? '' : isDate ? new Date(v).toISOString().slice(0, 10) : (c.unit.pct ? +(v * 100).toFixed(4) : v));
        const type = isDate ? 'date' : 'number';
        body = `<div class="hint">${isDate ? 'Dates' : 'Values'} from ${esc(isDate ? toIn(lo) : fmtNum(lo, c.unit))} to ${esc(isDate ? toIn(hi) : fmtNum(hi, c.unit))}${c.unit.pct ? ' (enter % values, e.g. 12.5)' : ''}</div>
          <div class="two"><div><label>From</label><input type="${type}" step="any" id="fMin" value="${f && f.type === 'range' ? toIn(f.min) : ''}" placeholder="${esc(toIn(lo))}"></div>
          <div><label>To</label><input type="${type}" step="any" id="fMax" value="${f && f.type === 'range' ? toIn(f.max) : ''}" placeholder="${esc(toIn(hi))}"></div></div>`;
      }
    }
    if (useList) {
      body = `<input type="text" id="fq" placeholder="Search values…" autocomplete="off"><div style="display:flex;gap:10px;margin-bottom:5px"><button class="linkbtn" id="fAll">Select all</button><button class="linkbtn" id="fNone">Clear</button></div><div class="list" id="flist"></div><div class="more" id="fmore"></div>`;
    }
    pop.innerHTML = `<header><span>${esc(c.label || c.name)}</span></header>${sortBtns}<div class="body">${body}</div>
      <div class="acts"><button id="fReset">Reset filter</button><button id="fClose">Close</button></div>`;
    pop.hidden = false;
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(4, Math.min(r.left - 120, window.innerWidth - 268)) + 'px';
    pop.style.top = Math.min(r.bottom + 4, window.innerHeight - 120) + 'px';

    pop.querySelectorAll('[data-s]').forEach((b) => b.addEventListener('click', () => { sort = { key, dir: +b.dataset.s }; recompute(true); closePopover(); }));
    $('fClose').onclick = closePopover;
    $('fReset').onclick = () => { filters.delete(key); recompute(); closePopover(); };

    if (useList) {
      const all = distinct(c);
      // ticked = null means "everything ticked" (no filter)
      let ticked = f && f.type === 'values' ? new Set(f.set) : null;
      const LIMIT = 500;
      let items = all;
      const draw = () => {
        const q = $('fq').value.trim().toLowerCase();
        items = q ? all.filter(([v]) => v.toLowerCase().includes(q)) : all;
        $('flist').innerHTML = items.slice(0, LIMIT).map(([v, n], k) =>
          `<label><input type="checkbox" data-k="${k}" ${!ticked || ticked.has(v) ? 'checked' : ''}><span class="v">${esc(v === '' ? '(empty)' : v)}</span><span class="c">${n.toLocaleString()}</span></label>`).join('');
        $('fmore').textContent = items.length > LIMIT ? `Showing ${LIMIT} of ${items.length.toLocaleString()} values – type to search` : '';
      };
      const ensure = () => { if (!ticked) ticked = new Set(all.map(([v]) => v)); return ticked; };
      const commit = () => {
        if (!ticked || ticked.size === all.length) { ticked = null; filters.delete(key); } else filters.set(key, { key, type: 'values', set: new Set(ticked) });
        recompute(true);
      };
      $('flist').addEventListener('change', (e) => {
        const it = items[+e.target.dataset.k];
        if (!it) return;
        const t = ensure();
        if (e.target.checked) t.add(it[0]); else t.delete(it[0]);
        commit();
      });
      $('fAll').onclick = () => { const t = ensure(); items.forEach(([v]) => t.add(v)); commit(); draw(); };
      $('fNone').onclick = () => { const t = ensure(); items.forEach(([v]) => t.delete(v)); commit(); draw(); };
      $('fq').addEventListener('input', debounce(draw, 120));
      draw();
      $('fq').focus();
    } else {
      const isDate = c.type === 'date';
      const parse = (s) => {
        if (s === '' || s === null) return undefined;
        if (isDate) { const t = Date.parse(s + 'T00:00:00Z'); return isNaN(t) ? undefined : t; }
        const v = parseFloat(s);
        return isNaN(v) ? undefined : (c.unit.pct ? v / 100 : v);
      };
      const apply = debounce(() => {
        const min = parse($('fMin').value); let max = parse($('fMax').value);
        if (isDate && max !== undefined) max += 864e5 - 1; // include the whole "to" day
        if (min === undefined && max === undefined) filters.delete(key); else filters.set(key, { key, type: 'range', min, max });
        recompute(true);
      }, 250);
      $('fMin').addEventListener('input', apply);
      $('fMax').addEventListener('input', apply);
      $('fMin').focus();
    }
  }

  function closePopover () { $('popover').hidden = true; $('popover').innerHTML = ''; }

  // ================================================================ Format dialog
  async function openFormatDialog () {
    const url = new URL('format.html' + window.location.search, window.location.href).href; // keep ?v= so the dialog isn't served from cache
    const ctx = {
      columns: cols.map((c) => ({ key: c.key, name: c.name, type: c.type, shown: shown.includes(c) }))
    };
    try {
      await tableau.extensions.ui.displayDialogAsync(url, JSON.stringify({ ctx, defaults: DEFAULTS }), { width: 520, height: 700 });
    } catch (e) {
      if (!(tableau.ErrorCodes && e.errorCode === tableau.ErrorCodes.DialogClosedByUser)) console.error(e);
    }
    onSettingsChanged();
  }

  function onSettingsChanged () {
    const prevRows = cfg.initialRows;
    loadSettings();
    if (prevRows !== cfg.initialRows && !(loadedAll && cfg.initialRows === 'all')) load(false); else applySettings();
  }

  // ================================================================ helpers
  function status (html) {
    const el = $('status');
    if (!html) { el.hidden = true; return; }
    el.innerHTML = `<div>${html}</div>`;
    el.hidden = false;
  }
  function resolve (name, names) {
    if (names.includes(name)) return name;
    return names.find((n) => n.toLowerCase() === String(name).toLowerCase()) || names.find((n) => n.includes(cleanName(name))) || null;
  }
  function cleanName (n) {
    return String(n || '').replace(/^(SUM|AVG|MIN|MAX|CNT|CNTD|COUNT|COUNTD|MEDIAN|ATTR|AGG|STDEV|VAR|YEAR|QUARTER|MONTH|WEEK|DAY|MY|MDY|QR|TMN|TQR|TYR|TWK|TDY|USER)\((.*)\)$/i, '$2');
  }
  function detectUnit (sample) {
    const s = String(sample || '').trim();
    const prefix = (s.match(/^[^\d\-−(.]*/) || [''])[0];
    const suffix = (s.match(/[^\d.,)]*$/) || [''])[0];
    const dec = (s.match(/\.(\d+)/) || ['', ''])[1].length;
    return { prefix, suffix, pct: /%/.test(suffix), dec };
  }
  function fmtNum (v, u) {
    if (!isFinite(v)) return '';
    let n = u.pct ? v * 100 : v;
    const neg = n < 0; n = Math.abs(n);
    const body = n.toLocaleString('en-US', { minimumFractionDigits: u.dec, maximumFractionDigits: Math.max(u.dec, u.pct ? 1 : 0) });
    return (neg ? '-' : '') + u.prefix + body + u.suffix;
  }
  function esc (s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s);
  function debounce (fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }

  { const v = document.querySelector('meta[name="ext-version"]'); console.log('[' + document.title + '] version', v ? v.content : '?'); }
  init();
})();
