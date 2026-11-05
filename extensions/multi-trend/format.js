/* Format Extension dialog for Multi Measure Trend (live preview; Cancel restores). */
/* global tableau */
'use strict';

(function () {
  let DEFAULTS = {};
  let ctx = { measures: [] };
  let cfg = {};
  let original = null;
  const form = document.getElementById('form');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const opts = (list, v) => list.map(([k, t]) => `<option value="${esc(k)}" ${String(k) === String(v) ? 'selected' : ''}>${esc(t)}</option>`).join('');

  const verMeta = document.querySelector('meta[name="ext-version"]');
  if (verMeta) { const h = document.querySelector('.fx-top p'); if (h) h.textContent += ` · v${verMeta.content}`; }

  async function init () {
    const payload = await tableau.extensions.initializeDialogAsync();
    try { ({ ctx = { measures: [] }, defaults: DEFAULTS = {} } = JSON.parse(payload || '{}')); } catch (e) { /* empty */ }
    original = tableau.extensions.settings.get('config') || null;
    let saved = {};
    try { saved = original ? JSON.parse(original) : {}; } catch (e) { saved = {}; }
    cfg = { ...DEFAULTS, ...saved };
    cfg.measures = JSON.parse(JSON.stringify(cfg.measures || {}));

    fillSimple(); drawMeasures(); refresh();

    form.addEventListener('input', (e) => {
      const el = e.target;
      if (el.name && el.name in DEFAULTS) {
        cfg[el.name] = el.type === 'checkbox' ? el.checked : (/Size$/.test(el.name) ? +el.value : el.value);
        refresh(); scheduleSave();
      }
    });
    $('measures').addEventListener('input', (e) => {
      const el = e.target; const card = el.closest('[data-k]');
      if (!card || !el.dataset.f) return;
      const k = card.dataset.k;
      const m = cfg.measures[k] = { ...(cfg.measures[k] || {}) };
      m[el.dataset.f] = el.type === 'checkbox' ? el.checked : (el.dataset.f === 'width' ? +el.value : el.value);
      if (['type', 'hidden'].includes(el.dataset.f)) drawMeasures();
      scheduleSave();
    });
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('.fx-tab').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    });
    $('ok').addEventListener('click', async () => { await save(); tableau.extensions.ui.closeDialog('ok'); });
    $('cancel').addEventListener('click', async () => {
      if (original === null) tableau.extensions.settings.erase('config'); else tableau.extensions.settings.set('config', original);
      try { await tableau.extensions.settings.saveAsync(); } catch (e) { /* ignore */ }
      tableau.extensions.ui.closeDialog('cancel');
    });
    $('reset').addEventListener('click', () => { cfg = { ...DEFAULTS, measures: {} }; fillSimple(); drawMeasures(); refresh(); scheduleSave(); });
  }

  function fillSimple () {
    for (const el of form.elements) {
      if (!el.name || !(el.name in cfg)) continue;
      if (el.type === 'checkbox') el.checked = !!cfg[el.name]; else el.value = cfg[el.name];
    }
  }
  function refresh () { $('bgColorField').hidden = cfg.background !== 'custom'; }

  function drawMeasures () {
    const box = $('measures');
    if (!ctx.measures.length) { box.innerHTML = '<p class="fx-hint">Drag one or more measures onto the <b>Measures</b> shelf first.</p>'; return; }
    box.innerHTML = ctx.measures.map((mm) => {
      const c = { ...mm.def, ...(cfg.measures[mm.key] || {}) };
      const isBar = c.type === 'bar';
      return `<div class="mcard${c.hidden ? ' off' : ''}" data-k="${esc(mm.key)}">
        <div class="mcard-head">
          <input type="color" data-f="color" value="${esc(c.color)}" title="Color">
          <span class="nm" title="${esc(mm.key)}">${esc(c.label || mm.name)}</span>
          <label class="fx-check"><input type="checkbox" data-f="hidden" ${c.hidden ? 'checked' : ''}> Hide</label>
        </div>
        <div class="row">
          <label class="fx-field">Name<input type="text" data-f="label" value="${esc(c.label)}" placeholder="${esc(mm.name)}"></label>
          <label class="fx-field">Show as<select data-f="type">${opts([['line', 'Line'], ['area', 'Area'], ['bar', 'Bars']], c.type)}</select></label>
          <label class="fx-field">Axis<select data-f="axis">${opts([['left', 'Left axis'], ['right', 'Right axis']], c.axis)}</select></label>
        </div>
        ${isBar ? '' : `<div class="row">
          <label class="fx-field">Line style<select data-f="style">${opts([['solid', 'Solid ———'], ['dashed', 'Dashed – – –'], ['dotted', 'Dotted · · ·']], c.style)}</select></label>
          <label class="fx-field">Width<select data-f="width">${opts([['1', '1'], ['1.5', '1.5'], ['2', '2'], ['2.5', '2.5'], ['3', '3'], ['4', '4']], c.width)}</select></label>
          <label class="fx-field">Curve<select data-f="curve">${opts([['straight', 'Straight'], ['smooth', 'Smooth'], ['step', 'Step']], c.curve)}</select></label>
        </div>`}
        <div class="row">
          <label class="fx-field">Value labels<select data-f="labels">${opts([['none', 'None'], ['last', 'Latest'], ['minmax', 'High & low'], ['all', 'All values']], c.labels)}</select></label>
          ${isBar ? '' : `<label class="fx-check"><input type="checkbox" data-f="points" ${c.points ? 'checked' : ''}> Points</label>`}
        </div>
      </div>`;
    }).join('');
  }

  let timer = null;
  function scheduleSave () { clearTimeout(timer); timer = setTimeout(save, 350); }
  async function save () {
    clearTimeout(timer);
    try { tableau.extensions.settings.set('config', JSON.stringify(cfg)); await tableau.extensions.settings.saveAsync(); } catch (e) { console.warn('Could not save settings', e); }
  }

  init().catch((e) => { document.body.innerHTML = '<p style="padding:20px">Could not open the format dialog: ' + esc(e.message || e) + '</p>'; });
})();
