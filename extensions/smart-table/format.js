/* Format Extension dialog for Smart Table.
 * Saves to the workbook settings on every change (live preview); Cancel restores what was there before.
 */
/* global tableau, SmartRules */
'use strict';

(function () {
  let DEFAULTS = {};
  let ctx = { columns: [] };
  let cfg = {};
  let original = null;
  const form = document.getElementById('form');
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // show the version in the dialog header (stamped by tools/build.py)
  const verMeta = document.querySelector('meta[name="ext-version"]');
  if (verMeta) { const h = document.querySelector('.fx-top p'); if (h) h.textContent += ` · v${verMeta.content}`; }

  async function init () {
    const payload = await tableau.extensions.initializeDialogAsync();
    try { ({ ctx = { columns: [] }, defaults: DEFAULTS = {} } = JSON.parse(payload || '{}')); } catch (e) { /* empty */ }
    original = tableau.extensions.settings.get('config') || null;
    let saved = {};
    try { saved = original ? JSON.parse(original) : {}; } catch (e) { saved = {}; }
    cfg = { ...DEFAULTS, ...saved };
    cfg.columns = { ...(cfg.columns || {}) };
    cfg.rules = Array.isArray(cfg.rules) ? cfg.rules.map((r) => ({ ...r })) : [];

    fillSimple();
    drawRules();
    drawColumns();
    refresh();

    // simple inputs (name="...") on the Table tab
    form.addEventListener('input', (e) => {
      const el = e.target;
      if (el.name && el.name in DEFAULTS && !el.closest('#rules') && !el.closest('#columns')) {
        cfg[el.name] = el.type === 'checkbox' ? el.checked : el.value;
        if (el.name === 'freeze' || el.name === 'fontSize') cfg[el.name] = +el.value;
        refresh();
        scheduleSave();
      }
    });
    $('tabs').addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (!b) return;
      document.querySelectorAll('#tabs button').forEach((x) => x.classList.toggle('on', x === b));
      document.querySelectorAll('.fx-tab').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
    });
    $('addRule').addEventListener('click', () => {
      const first = numericCols()[0] || shownCols()[0];
      cfg.rules.push({ ...SmartRules.DEFAULT_RULE, column: first ? first.key : '', style: first && first.type === 'number' ? 'scale' : 'if' });
      drawRules(); scheduleSave();
    });
    $('ok').addEventListener('click', async () => { await save(); tableau.extensions.ui.closeDialog('ok'); });
    $('cancel').addEventListener('click', async () => {
      if (original === null) tableau.extensions.settings.erase('config'); else tableau.extensions.settings.set('config', original);
      try { await tableau.extensions.settings.saveAsync(); } catch (e) { /* ignore */ }
      tableau.extensions.ui.closeDialog('cancel');
    });
    $('reset').addEventListener('click', () => {
      cfg = { ...DEFAULTS, columns: {}, rules: [] };
      fillSimple(); drawRules(); drawColumns(); refresh(); scheduleSave();
    });
  }

  function fillSimple () {
    for (const el of form.elements) {
      if (!el.name || !(el.name in cfg) || el.closest('#rules') || el.closest('#columns')) continue;
      if (el.type === 'checkbox') el.checked = !!cfg[el.name]; else el.value = cfg[el.name];
    }
  }
  function refresh () { $('bgColorField').hidden = cfg.background !== 'custom'; }

  const shownCols = () => ctx.columns.filter((c) => c.shown);
  const numericCols = () => ctx.columns.filter((c) => c.type === 'number');
  const colName = (k) => (ctx.columns.find((c) => c.key === k) || { name: k }).name;

  // ------------------------------------------------------------ conditional color rules
  function opts (list, value) { return list.map(([v, t]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(t)}</option>`).join(''); }

  function drawRules () {
    const box = $('rules');
    if (!cfg.rules.length) { box.innerHTML = '<p class="fx-hint">No rules yet. Example: color Balance from red (low) to green (high), or make the whole row bold when Status = Unfunded.</p>'; return; }
    box.innerHTML = cfg.rules.map((r0, i) => {
      const r = { ...SmartRules.DEFAULT_RULE, ...r0 };
      const target = ctx.columns.find((c) => c.key === r.column);
      const styles = [['scale', 'Color scale'], ['if', 'If … then color'], ['bar', 'Data bar'], ['arrow', 'Up / down arrows']];
      const basedList = (numOnly) => [['', `Same column${target ? ` (${target.name})` : ''}`]].concat(
        ctx.columns.filter((c) => c.key !== r.column && (!numOnly || c.type === 'number')).map((c) => [c.key, c.name + (c.shown ? '' : ' (Detail)')]));
      let body = '';
      if (r.style === 'scale') {
        body = `<div class="row">
            <label class="fx-field">Based on<select data-f="basedOn">${opts(basedList(true), r.basedOn)}</select></label>
            <label class="fx-field">Color the<select data-f="target">${opts([['bg', 'Background'], ['text', 'Text']], r.target)}</select></label></div>
          <div class="row">
            <label class="fx-color">Low <input type="color" data-f="low" value="${esc(r.low)}"></label>
            <label class="fx-check"><input type="checkbox" data-f="useMid" ${r.useMid ? 'checked' : ''}> Middle</label>
            ${r.useMid ? `<label class="fx-color">Mid <input type="color" data-f="mid" value="${esc(r.mid)}"></label>` : ''}
            <label class="fx-color">High <input type="color" data-f="high" value="${esc(r.high)}"></label></div>
          <div class="sample">Preview <i style="background:linear-gradient(90deg,${r.low},${r.useMid ? r.mid + ',' : ''}${r.high})"></i>${r.useMid ? 'middle = 0 when values go below and above 0' : ''}</div>`;
      } else if (r.style === 'if') {
        const needV = !['empty', 'notempty'].includes(r.op);
        body = `<div class="row">
            <label class="fx-field">If<select data-f="basedOn">${opts(basedList(false), r.basedOn)}</select></label>
            <label class="fx-field">is<select data-f="op">${opts(SmartRules.OPS, r.op)}</select></label></div>
          <div class="row">
            ${needV ? `<label class="fx-field">Value<input type="text" data-f="v1" value="${esc(r.v1)}" placeholder="e.g. 1000, 5%, Riyadh"></label>` : ''}
            ${r.op === 'between' ? `<label class="fx-field">and<input type="text" data-f="v2" value="${esc(r.v2)}"></label>` : ''}</div>
          <div class="row">
            <label class="fx-field">Then color<select data-f="scope">${opts([['cell', 'This cell'], ['row', 'The whole row']], r.scope)}</select></label>
            <label class="fx-color">Fill <input type="color" data-f="bg" value="${esc(r.bg)}"></label>
            <label class="fx-color">Text <input type="color" data-f="fg" value="${esc(r.fg)}"></label>
            <label class="fx-check"><input type="checkbox" data-f="bold" ${r.bold ? 'checked' : ''}> Bold</label></div>`;
      } else if (r.style === 'bar') {
        body = `<div class="row">
            <label class="fx-field">Based on<select data-f="basedOn">${opts(basedList(true), r.basedOn)}</select></label>
            <label class="fx-color">Bar <input type="color" data-f="barColor" value="${esc(r.barColor)}"></label></div>`;
      } else {
        body = `<div class="row">
            <label class="fx-field">Based on<select data-f="basedOn">${opts(basedList(true), r.basedOn)}</select></label></div>
          <div class="row">
            <label class="fx-check"><input type="checkbox" data-f="higherIsBetter" ${r.higherIsBetter ? 'checked' : ''}> Higher is better</label>
            <label class="fx-color">Good <input type="color" data-f="up" value="${esc(r.up)}"></label>
            <label class="fx-color">Bad <input type="color" data-f="down" value="${esc(r.down)}"></label></div>
          <p class="fx-hint">▲ for values above 0, ▼ below 0. Untick "Higher is better" for cost, churn…</p>`;
      }
      const colList = shownCols().map((c) => [c.key, c.name]);
      return `<div class="rule" data-i="${i}">
        <div class="rule-head">
          <label class="fx-field">Column<select data-f="column">${opts(colList, r.column)}</select></label>
          <label class="fx-field">Style<select data-f="style">${opts(styles, r.style)}</select></label>
          <button type="button" class="x" data-del="${i}" title="Delete rule">×</button>
        </div>${body}</div>`;
    }).join('');
  }

  $('rules').addEventListener('input', (e) => {
    const el = e.target;
    const card = el.closest('[data-i]');
    if (!card || !el.dataset.f) return;
    const r = cfg.rules[+card.dataset.i];
    r[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value;
    // structural changes redraw the card
    if (['style', 'useMid', 'op', 'column'].includes(el.dataset.f)) {
      if (el.dataset.f === 'style' && ['scale', 'bar', 'arrow'].includes(r.style)) {
        const t = ctx.columns.find((c) => c.key === (r.basedOn || r.column));
        if (t && t.type !== 'number') r.basedOn = (numericCols()[0] || {}).key || '';
      }
      drawRules();
    } else if (el.type === 'color') {
      const s = card.querySelector('.sample i');
      if (s && r.style === 'scale') s.style.background = `linear-gradient(90deg,${r.low},${r.useMid ? r.mid + ',' : ''}${r.high})`;
    }
    scheduleSave();
  });
  $('rules').addEventListener('click', (e) => {
    const d = e.target.closest('[data-del]');
    if (!d) return;
    cfg.rules.splice(+d.dataset.del, 1);
    drawRules(); scheduleSave();
  });

  // ------------------------------------------------------------ columns (rename / align / hide)
  function drawColumns () {
    const list = shownCols();
    if (!list.length) { $('columns').innerHTML = '<p class="fx-hint">Add fields to the Fields shelf first.</p>'; return; }
    $('columns').innerHTML = '<span class="h">Field</span><span class="h">Header text</span><span class="h">Align</span><span class="h">Hide</span>' +
      list.map((c) => {
        const cc = cfg.columns[c.key] || {};
        return `<span class="n" title="${esc(c.key)}">${esc(c.name)}</span>
          <input type="text" data-k="${esc(c.key)}" data-c="label" value="${esc(cc.label || '')}" placeholder="${esc(c.name)}">
          <select data-k="${esc(c.key)}" data-c="align">${opts([['auto', 'Auto'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']], cc.align || 'auto')}</select>
          <label><input type="checkbox" data-k="${esc(c.key)}" data-c="hidden" ${cc.hidden ? 'checked' : ''}></label>`;
      }).join('');
  }
  $('columns').addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.k) return;
    const cc = cfg.columns[el.dataset.k] = { ...(cfg.columns[el.dataset.k] || {}) };
    cc[el.dataset.c] = el.type === 'checkbox' ? el.checked : el.value;
    scheduleSave();
  });

  // ------------------------------------------------------------ save (debounced, live)
  let timer = null;
  function scheduleSave () { clearTimeout(timer); timer = setTimeout(save, 350); }
  async function save () {
    clearTimeout(timer);
    try {
      tableau.extensions.settings.set('config', JSON.stringify(cfg));
      await tableau.extensions.settings.saveAsync();
    } catch (e) { console.warn('Could not save settings', e); }
  }

  init().catch((e) => { document.body.innerHTML = '<p style="padding:20px">Could not open the format dialog: ' + esc(e.message || e) + '</p>'; });
})();
