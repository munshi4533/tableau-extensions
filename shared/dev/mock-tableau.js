/* Shared fake of the Tableau Extensions API, so any extension in this repo can be previewed in a
 * normal browser (no Tableau). Each extension registers its own sample data in dev/scenarios.js:
 *
 *   MockTableau.scenario('single', (M) => ({ columns: [...], data: [[M.dv(...), ...]], encodings: [{ id, field: M.field('...') }] }));
 *
 * URL options:  ?scenario=<name>   &cfg={"key":"value"}  (preset settings 'config')   &mode=viewing
 * A small toolbar (bottom-right) lets you switch scenario and open the Format Extension dialog.
 */
(function () {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode') || 'authoring';
  const scenarios = {};
  const order = [];

  // ---- helpers handed to scenario builders
  const M = {
    dv: (value, nativeValue, formattedValue) => ({ value, nativeValue, formattedValue }),
    field: (name) => ({ name }),
    iso: (d) => d.toISOString().slice(0, 10),
    months: (n, start = Date.UTC(2024, 0, 1)) => Array.from({ length: n }, (_, i) => {
      const d = new Date(start); d.setUTCMonth(d.getUTCMonth() + i); return d;
    }),
    fmtMonth: (d) => d.toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    fmtDay: (d) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }),
    fmtMoney: (v, cur = 'SAR') => cur + ' ' + Math.round(v).toLocaleString('en-US'),
    fmtInt: (v) => Math.round(v).toLocaleString('en-US')
  };

  let current = null;
  function data () {
    if (current) return current;
    const name = params.get('scenario') || order[0];
    const build = scenarios[name];
    current = build ? build(M) : { columns: [], data: [], encodings: [] };
    current.name = name;
    return current;
  }

  // ---- settings (kept per page in sessionStorage so extensions don't share settings)
  const storeKey = 'mock-settings:' + location.pathname;
  const settingsListeners = [];
  let store = {};
  try { store = JSON.parse(sessionStorage.getItem(storeKey) || '{}'); } catch (e) { /* ignore */ }
  if (params.get('cfg')) store = { config: params.get('cfg') };

  const settings = {
    get: (k) => store[k],
    set: (k, v) => { store[k] = v; },
    getAll: () => ({ ...store }),
    erase: (k) => { delete store[k]; },
    saveAsync: async () => {
      try { sessionStorage.setItem(storeKey, JSON.stringify(store)); } catch (e) { /* ignore */ }
      settingsListeners.forEach((fn) => fn({ newSettings: { ...store } }));
      return { ...store };
    },
    addEventListener: (type, fn) => { settingsListeners.push(fn); return () => {}; }
  };

  // Like Tableau: only ONE summary-data reader may be open at a time, calls take a moment,
  // and SummaryDataChanged can fire in bursts (filters, dashboard load). window.__mockFire(n) fires n events.
  const dataListeners = [];
  let readerOpen = false;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__mockFire = (n = 1) => { for (let i = 0; i < n; i++) dataListeners.forEach((fn) => fn({})); };
  const worksheet = {
    name: 'Mock Sheet',
    addEventListener: (type, fn) => { if (type === 'summary-data-changed') dataListeners.push(fn); return () => {}; },
    // Pages like Tableau does. Scenarios may add types: ['string','float','int','date',...] per column.
    getSummaryDataReaderAsync: async (pageRowCount) => {
      await wait(30);
      if (readerOpen) throw new Error('[mock] A summary data reader is already open. Release it before opening another.');
      readerOpen = true;
      const d = data();
      const size = pageRowCount || 10000;
      const pageCount = Math.max(1, Math.ceil(d.data.length / size));
      const columns = d.columns.map((c, i) => ({ fieldName: c, index: i, dataType: d.types ? d.types[i] : undefined }));
      return {
        pageCount,
        totalRowCount: d.data.length,
        getPageAsync: async (p) => { await wait(20); return { columns, data: d.data.slice(p * size, (p + 1) * size) }; },
        releaseAsync: async () => { readerOpen = false; }
      };
    },
    getVisualSpecificationAsync: async () => ({ activeMarksSpecificationIndex: 0, marksSpecifications: [{ encodings: data().encodings }] }),
    // scenarios may add params: [{ name, value, formatted }]
    getParametersAsync: async () => (data().params || []).map((p) => ({
      name: p.name,
      currentValue: { value: p.value, nativeValue: p.value, formattedValue: p.formatted || String(p.value) },
      addEventListener: () => () => {}
    })),
    hoverTupleAsync: async (id) => { window.__lastHover = id; },
    selectTuplesAsync: async (ids) => { window.__lastSelect = ids; console.log('[mock] select', ids); }
  };

  let configureCb = null;
  window.tableau = {
    TableauEventType: { SummaryDataChanged: 'summary-data-changed', SettingsChanged: 'settings-changed' },
    ErrorCodes: { DialogClosedByUser: 'dialog-closed-by-user' },
    SelectOptions: { Simple: 'select-options-simple', Toggle: 'select-options-toggle' },
    ClassNameKey: { Worksheet: 'tableau-worksheet' },
    extensions: {
      initializeAsync: async (cb) => { if (cb && cb.configure) configureCb = cb.configure; },
      environment: { mode },
      worksheetContent: { worksheet },
      settings,
      ui: {
        // Opens "<page>.html" as "dev/<page>-preview.html" in an overlay iframe
        displayDialogAsync: (url, payload, opts = {}) => new Promise((resolve) => {
          const wrap = document.createElement('div');
          wrap.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.25);display:grid;place-items:center;z-index:99';
          const frame = document.createElement('iframe');
          const page = url.split('?')[0].split('/').pop().replace(/\.html$/, '');
          frame.src = new URL(`${page}-preview.html`, location.href).href;
          frame.style.cssText = `width:${opts.width || 460}px;height:${Math.min(opts.height || 680, innerHeight - 20)}px;border:0;border-radius:8px;background:white;box-shadow:0 10px 40px rgba(0,0,0,.3)`;
          wrap.appendChild(frame);
          document.body.appendChild(wrap);
          window.__mockDialogTableau = {
            extensions: {
              initializeDialogAsync: async () => payload,
              settings,
              worksheetContent: { worksheet },
              ui: { closeDialog: (p) => { wrap.remove(); resolve(p); } }
            }
          };
        })
      }
    }
  };

  window.MockTableau = {
    scenario: (name, build) => { scenarios[name] = build; order.push(name); },
    openFormat: () => configureCb && configureCb()
  };

  // ---- dev toolbar
  window.addEventListener('load', () => {
    if (window.parent !== window) return;
    const bar = document.createElement('div');
    bar.style.cssText = 'position:fixed;right:6px;bottom:6px;z-index:50;display:flex;gap:6px;font:11px -apple-system,Segoe UI,sans-serif';
    const sel = document.createElement('select');
    sel.title = 'Sample data scenario';
    order.forEach((n) => { const o = document.createElement('option'); o.value = o.textContent = n; sel.appendChild(o); });
    sel.value = data().name;
    sel.onchange = () => { params.set('scenario', sel.value); location.search = params.toString(); };
    const btn = document.createElement('button');
    btn.textContent = 'Format Extension…';
    btn.onclick = () => window.MockTableau.openFormat();
    btn.hidden = !configureCb;
    [sel, btn].forEach((el) => { el.style.cssText = 'font:inherit;padding:4px 8px;border:1px solid #ccc;border-radius:6px;background:#fff;cursor:pointer'; });
    bar.append(sel, btn);
    document.body.appendChild(bar);
  });
})();
