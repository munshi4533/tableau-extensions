/* Format Extension dialog for Funnel (live preview; Cancel restores). */
/* global tableau */
'use strict';

(function () {
  let DEFAULTS = {}; let PALETTE = [];
  let ctx = { stages: [] };
  let cfg = {};
  let original = null;
  let timer = 0;
  const form = document.getElementById('form');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NUM = new Set(['warnAt', 'goodAt', 'nameSize', 'valueSize', 'titleSize']);

  const verMeta = document.querySelector('meta[name="ext-version"]');
  if (verMeta) { const h = document.querySelector('.fx-top p'); if (h) h.textContent += ` · v${verMeta.content}`; }

  async function init () {
    const payload = await tableau.extensions.initializeDialogAsync();
    try { ({ ctx = ctx, defaults: DEFAULTS = {}, palette: PALETTE = [] } = JSON.parse(payload || '{}')); } catch (e) { /* empty */ }
    original = tableau.extensions.settings.get('config') || null;
    let saved = {};
    try { saved = original ? JSON.parse(original) : {}; } catch (e) { saved = {}; }
    cfg = JSON.parse(JSON.stringify({ ...DEFAULTS, ...saved }));
    cfg.stages = cfg.stages || {}; cfg.order = Array.isArray(cfg.order) ? cfg.order : [];

    fillSimple(); drawStages(); refresh();
    form.addEventListener('input', (e) => {
      const el = e.target;
      if (el.closest('#stages')) return;
      if (el.name && el.name in DEFAULTS && !['stages', 'order'].includes(el.name)) {
        cfg[el.name] = el.type === 'checkbox' ? el.checked : (NUM.has(el.name) ? +el.value : el.value);
        refresh(); if (el.name === 'colorMode') drawStages(); scheduleSave();
      }
    });
    $('stages').addEventListener('input', onStageInput);
    $('stages').addEventListener('click', onStageClick);
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]'); if (!b) return;
      document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('.fx-tab').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    });
    $('ok').addEventListener('click', async () => { await save(); tableau.extensions.ui.closeDialog('ok'); });
    $('cancel').addEventListener('click', async () => {
      if (original === null) tableau.extensions.settings.erase('config'); else tableau.extensions.settings.set('config', original);
      try { await tableau.extensions.settings.saveAsync(); } catch (e) { /* ignore */ }
      tableau.extensions.ui.closeDialog('cancel');
    });
    $('reset').addEventListener('click', () => { cfg = JSON.parse(JSON.stringify(DEFAULTS)); fillSimple(); drawStages(); refresh(); scheduleSave(); });
  }

  function fillSimple () {
    for (const el of form.elements) {
      if (!el.name || !(el.name in cfg) || el.closest('#stages')) continue;
      if (el.type === 'checkbox') el.checked = !!cfg[el.name]; else el.value = cfg[el.name];
    }
  }
  function refresh () {
    $('bgColorField').hidden = cfg.background !== 'custom';
    $('colorField').hidden = cfg.colorMode !== 'single';
    $('thresholds').classList.toggle('fx-dep', true); $('thresholds').classList.toggle('off', !cfg.prevColors);
  }

  // ---- stages: in the order shown on the sheet (Format order, then new measures)
  function ordered () {
    const list = ctx.stages.slice();
    const pos = (k) => { const i = cfg.order.indexOf(k); return i < 0 ? 1000 + list.findIndex((s) => s.key === k) : i; };
    return list.sort((a, b) => pos(a.key) - pos(b.key));
  }
  function drawStages () {
    const box = $('stages');
    const list = ordered();
    if (!list.length) { box.innerHTML = '<p class="fx-hint">Drag one measure per stage onto <b>Stages</b> on the Marks card first.</p>'; return; }
    let shown = 0;
    box.innerHTML = list.map((s, i) => {
      const c = cfg.stages[s.key] || {};
      const color = c.color || PALETTE[(c.hidden ? i : shown) % PALETTE.length] || '#2a78d6';
      if (!c.hidden) shown++;
      return `<div class="kcard${c.hidden ? ' off' : ''}" data-key="${esc(s.key)}">
        <div class="kcard-head">
          <button type="button" class="mv" data-mv="-1" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
          <button type="button" class="mv" data-mv="1" ${i === list.length - 1 ? 'disabled' : ''} title="Move down">▼</button>
          <span class="nm" title="${esc(s.key)}">${esc(c.label || s.name)}</span>
          ${cfg.colorMode === 'single' ? '' : `<input type="color" data-f="color" value="${esc(color)}" title="Stage color">`}
          <span class="tag">${esc(s.key)}</span>
        </div>
        <div class="row">
          <label class="fx-field">Name<input type="text" data-f="label" value="${esc(c.label || '')}" placeholder="${esc(s.name)}"></label>
          <label class="fx-check"><input type="checkbox" data-f="hidden" ${c.hidden ? 'checked' : ''}> Hide</label>
        </div>
      </div>`;
    }).join('');
  }
  const store = (key) => (cfg.stages[key] = cfg.stages[key] || {});
  function onStageInput (e) {
    const el = e.target; const card = el.closest('[data-key]');
    if (!card || !el.dataset.f) return;
    const st = store(card.dataset.key);
    st[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.f === 'label') card.querySelector('.nm').textContent = el.value || ctx.stages.find((s) => s.key === card.dataset.key).name;
    if (el.dataset.f === 'hidden') drawStages();
    scheduleSave();
  }
  function onStageClick (e) {
    const b = e.target.closest('[data-mv]'); if (!b) return;
    const keys = ordered().map((s) => s.key);
    const i = keys.indexOf(b.closest('[data-key]').dataset.key); const j = i + (+b.dataset.mv);
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]];
    cfg.order = keys; drawStages(); scheduleSave();
  }

  function scheduleSave () { clearTimeout(timer); timer = setTimeout(save, 250); }
  async function save () {
    clearTimeout(timer);
    try { tableau.extensions.settings.set('config', JSON.stringify(cfg)); await tableau.extensions.settings.saveAsync(); } catch (e) { console.warn('Could not save settings', e); }
  }

  init().catch((e) => { document.body.innerHTML = '<p style="padding:20px">Could not open the format dialog: ' + esc(e.message || e) + '</p>'; });
})();
