/* Format Extension dialog for Stage Flow (live preview; Cancel restores). */
/* global tableau */
'use strict';

(function () {
  let DEFAULTS = {};
  let ctx = { stages: [], outcomes: [], colors: {} };
  let cfg = {}; let original = null; let timer = 0;
  const form = document.getElementById('form');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const NUM = new Set(['labelSize', 'valueSize', 'titleSize']);
  const verMeta = document.querySelector('meta[name="ext-version"]');
  if (verMeta) { const h = document.querySelector('.fx-top p'); if (h) h.textContent += ` · v${verMeta.content}`; }

  async function init () {
    const payload = await tableau.extensions.initializeDialogAsync();
    try { ({ ctx = ctx, defaults: DEFAULTS = {} } = JSON.parse(payload || '{}')); } catch (e) { /* empty */ }
    original = tableau.extensions.settings.get('config') || null;
    let saved = {}; try { saved = original ? JSON.parse(original) : {}; } catch (e) { saved = {}; }
    cfg = JSON.parse(JSON.stringify({ ...DEFAULTS, ...saved }));
    cfg.stages = cfg.stages || {}; cfg.outcomes = cfg.outcomes || {}; cfg.order = Array.isArray(cfg.order) ? cfg.order : [];
    $('successSelect').innerHTML = `<option value="">Automatic${ctx.success ? ` (${esc(ctx.success)})` : ''}</option>` + ctx.outcomes.map((o) => `<option value="${esc(o)}">${esc(o)}</option>`).join('');
    fillSimple(); drawStages(); drawOutcomes(); refresh();
    form.addEventListener('input', (e) => {
      const el = e.target;
      if (el.closest('#stages') || el.closest('#outcomes')) return;
      if (el.name && el.name in DEFAULTS && !['stages', 'outcomes', 'order'].includes(el.name)) {
        cfg[el.name] = el.type === 'checkbox' ? el.checked : (NUM.has(el.name) ? +el.value : el.value);
        refresh(); scheduleSave();
      }
    });
    $('stages').addEventListener('input', onStageInput); $('stages').addEventListener('click', onStageClick);
    $('outcomes').addEventListener('input', onOutcomeInput);
    $('resetOrder').addEventListener('click', () => { cfg.order = []; drawStages(); scheduleSave(); });
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
    $('reset').addEventListener('click', () => { cfg = JSON.parse(JSON.stringify(DEFAULTS)); fillSimple(); drawStages(); drawOutcomes(); refresh(); scheduleSave(); });
  }
  function fillSimple () {
    for (const el of form.elements) {
      if (!el.name || !(el.name in cfg) || el.closest('#stages') || el.closest('#outcomes')) continue;
      if (el.type === 'checkbox') el.checked = !!cfg[el.name]; else el.value = cfg[el.name];
    }
  }
  function refresh () { $('bgColorField').hidden = cfg.background !== 'custom'; }
  // stages in the order shown (Format order first, then the automatic order the sheet sent)
  function ordered () {
    const pos = (s) => { const i = cfg.order.indexOf(s); return i < 0 ? null : i; };
    return ctx.stages.slice().sort((a, b) => { const pa = pos(a); const pb = pos(b); if (pa !== null && pb !== null) return pa - pb; if (pa !== null) return -1; if (pb !== null) return 1; return ctx.stages.indexOf(a) - ctx.stages.indexOf(b); });
  }
  function drawStages () {
    const list = ordered();
    if (!list.length) { $('stages').innerHTML = '<p class="fx-hint">Drag a Stage, an Outcome and a Count onto the Marks card first.</p>'; return; }
    $('stages').innerHTML = list.map((s, i) => {
      const c = cfg.stages[s] || {};
      return `<div class="kcard${c.hidden ? ' off' : ''}" data-key="${esc(s)}">
        <div class="kcard-head">
          <button type="button" class="mv" data-mv="-1" ${i === 0 ? 'disabled' : ''} title="Move up">▲</button>
          <button type="button" class="mv" data-mv="1" ${i === list.length - 1 ? 'disabled' : ''} title="Move down">▼</button>
          <span class="nm" title="${esc(s)}">${esc(c.label || s)}</span>
          <label class="fx-check" style="margin:0"><input type="checkbox" data-f="hidden" ${c.hidden ? 'checked' : ''}> Hide</label>
        </div>
        <div class="row"><label class="fx-field">Name<input type="text" data-f="label" value="${esc(c.label || '')}" placeholder="${esc(s)}"></label></div>
      </div>`;
    }).join('');
  }
  function onStageInput (e) {
    const el = e.target; const card = el.closest('[data-key]'); if (!card || !el.dataset.f) return;
    const st = (cfg.stages[card.dataset.key] = cfg.stages[card.dataset.key] || {});
    st[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.f === 'label') card.querySelector('.nm').textContent = el.value || card.dataset.key;
    if (el.dataset.f === 'hidden') card.classList.toggle('off', el.checked);
    scheduleSave();
  }
  function onStageClick (e) {
    const b = e.target.closest('[data-mv]'); if (!b) return;
    const keys = ordered(); const i = keys.indexOf(b.closest('[data-key]').dataset.key); const j = i + (+b.dataset.mv);
    if (j < 0 || j >= keys.length) return;
    [keys[i], keys[j]] = [keys[j], keys[i]]; cfg.order = keys; drawStages(); scheduleSave();
  }
  function drawOutcomes () {
    if (!ctx.outcomes.length) { $('outcomes').innerHTML = '<p class="fx-hint">Drag an Outcome onto the Marks card first.</p>'; return; }
    $('outcomes').innerHTML = ctx.outcomes.map((o) => {
      const c = cfg.outcomes[o] || {};
      return `<div class="kcard" data-key="${esc(o)}"><div class="kcard-head"><span class="nm">${esc(o)}</span><input type="color" data-f="color" value="${esc(c.color || ctx.colors[o] || '#a5a49e')}" title="Color"></div>
        <div class="row"><label class="fx-field">Name<input type="text" data-f="label" value="${esc(c.label || '')}" placeholder="${esc(o)}"></label></div></div>`;
    }).join('');
  }
  function onOutcomeInput (e) {
    const el = e.target; const card = el.closest('[data-key]'); if (!card || !el.dataset.f) return;
    const oc = (cfg.outcomes[card.dataset.key] = cfg.outcomes[card.dataset.key] || {});
    oc[el.dataset.f] = el.value; scheduleSave();
  }
  function scheduleSave () { clearTimeout(timer); timer = setTimeout(save, 250); }
  async function save () {
    clearTimeout(timer);
    try { tableau.extensions.settings.set('config', JSON.stringify(cfg)); await tableau.extensions.settings.saveAsync(); } catch (e) { console.warn('Could not save settings', e); }
  }
  init().catch((e) => { document.body.innerHTML = '<p style="padding:20px">Could not open the format dialog: ' + esc(e.message || e) + '</p>'; });
})();
