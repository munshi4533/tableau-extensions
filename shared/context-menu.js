/* Shared right-click menu for all extensions in this repo.
 *
 *   ExtMenu.attach((event) => [
 *     ExtMenu.authoring() && { label: 'Format Extension…', icon: 'format', action: openFormatDialog },
 *     'separator',
 *     { label: 'Download CSV', icon: 'download', action: () => ... },
 *   ]);
 *
 * Tableau does not show its own right-click menu over an extension, so this menu
 * gives authors the Format Extension option right where they click. Falsy items are skipped;
 * if nothing is left, the menu doesn't open.
 */
/* global tableau */
(function () {
  const ICONS = {
    format: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
    clear: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/><path d="m16 16 5 5m0-5-5 5"/>',
    load: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    up: '<path d="m6 15 6-6 6 6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    filter: '<path d="M3 5h18l-7 8v6l-4-2v-4z"/>'
  };

  const css = `
  .ext-menu { position: fixed; z-index: 1000; min-width: 190px; padding: 4px; background: #fff; color: #0b0b0b;
    border: 1px solid rgba(11,11,11,.12); border-radius: 8px; box-shadow: 0 10px 30px rgba(0,0,0,.16);
    font: 12px/1.3 -apple-system, "Segoe UI", Roboto, Arial, sans-serif; user-select: none; }
  .ext-menu button { display: flex; align-items: center; gap: 8px; width: 100%; padding: 7px 10px; border: 0; background: none;
    border-radius: 5px; font: inherit; color: inherit; text-align: left; cursor: pointer; white-space: nowrap; }
  .ext-menu button:hover, .ext-menu button:focus { background: #f1f1ee; outline: none; }
  .ext-menu svg { width: 14px; height: 14px; flex: none; color: #52514e; }
  .ext-menu small { margin-left: auto; padding-left: 14px; color: #898781; }
  .ext-menu hr { border: 0; border-top: 1px solid #e6e5df; margin: 4px 2px; }`;

  let menu = null;
  function close () { if (menu) { menu.remove(); menu = null; } }

  function show (items, x, y) {
    close();
    if (!document.getElementById('ext-menu-css')) {
      const st = document.createElement('style'); st.id = 'ext-menu-css'; st.textContent = css; document.head.appendChild(st);
    }
    menu = document.createElement('div');
    menu.className = 'ext-menu';
    menu.setAttribute('role', 'menu');
    items.forEach((it) => {
      if (it === 'separator') { menu.appendChild(document.createElement('hr')); return; }
      const b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('role', 'menuitem');
      b.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[it.icon] || ''}</svg>` +
        `<span></span>${it.hint ? '<small></small>' : ''}`;
      b.querySelector('span').textContent = it.label;
      if (it.hint) b.querySelector('small').textContent = it.hint;
      b.addEventListener('click', () => { close(); it.action(); });
      menu.appendChild(b);
    });
    document.body.appendChild(menu);
    const r = menu.getBoundingClientRect();
    menu.style.left = Math.max(4, Math.min(x, window.innerWidth - r.width - 4)) + 'px';
    menu.style.top = Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) + 'px';
    const first = menu.querySelector('button');
    if (first) first.focus();
  }

  function clean (items) {
    const out = [];
    for (const it of items) {
      if (!it) continue;
      if (it === 'separator' && (!out.length || out[out.length - 1] === 'separator')) continue;
      out.push(it);
    }
    while (out.length && out[out.length - 1] === 'separator') out.pop();
    return out;
  }

  window.ExtMenu = {
    attach (getItems) {
      document.addEventListener('contextmenu', (e) => {
        const items = clean(getItems(e) || []);
        if (!items.length) return; // nothing to offer: leave the default behaviour
        e.preventDefault();
        show(items, e.clientX, e.clientY);
      });
      document.addEventListener('mousedown', (e) => { if (menu && !menu.contains(e.target)) close(); });
      document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
      window.addEventListener('blur', close);
      document.addEventListener('scroll', close, true);
    },
    // true while editing the workbook (Desktop, or Edit mode on Server/Cloud)
    authoring () {
      try {
        const m = tableau.extensions.environment && tableau.extensions.environment.mode;
        return !m || String(m).toLowerCase() !== 'viewing';
      } catch (e) { return true; }
    },
    close
  };
})();
