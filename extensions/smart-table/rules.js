/* Smart Table – conditional formatting engine (shared by table.js and the Format dialog).
 *
 * A rule colors one column (or the whole row), based on that column or another one:
 *   style 'scale' : color scale low → (mid) → high, on background or text
 *   style 'if'    : IF <value> <op> <v1> [and v2] THEN background / text color / bold, on cell or whole row
 *   style 'bar'   : data bar inside the cell
 *   style 'arrow' : ▲ / ▼ by sign, green/red (flips when lower is better)
 */
/* exported SmartRules */
'use strict';

window.SmartRules = (function () {
  const OPS = [
    ['>', 'greater than'], ['>=', 'greater or equal'], ['<', 'less than'], ['<=', 'less or equal'],
    ['=', 'equals'], ['!=', 'not equal'], ['between', 'between'], ['contains', 'contains text'],
    ['empty', 'is empty'], ['notempty', 'is not empty']
  ];

  const DEFAULT_RULE = {
    column: '', basedOn: '', style: 'scale',
    low: '#f6c9c9', mid: '#ffffff', high: '#bfe3c6', useMid: false, target: 'bg',
    op: '>', v1: '', v2: '', bg: '#fde2c0', fg: '#0b0b0b', bold: false, scope: 'cell',
    barColor: '#86b6ef',
    higherIsBetter: true, up: '#0ca30c', down: '#d03b3b'
  };

  function hexToRgb (h) {
    const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
    if (!m) return [255, 255, 255];
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix (a, b, t) {
    const A = hexToRgb(a); const B = hexToRgb(b);
    return `rgb(${Math.round(A[0] + (B[0] - A[0]) * t)},${Math.round(A[1] + (B[1] - A[1]) * t)},${Math.round(A[2] + (B[2] - A[2]) * t)})`;
  }
  function luminance (rgbStr) {
    const m = rgbStr.match(/\d+/g);
    if (!m) return 1;
    const [r, g, b] = m.map((v) => { v = v / 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const inkFor = (bg) => (luminance(bg) < 0.4 ? '#ffffff' : '#0b0b0b');

  /**
   * compile(rules, getCol) -> function(rowIndex) returning { row: style|null, cells: { [colKey]: style } }
   * getCol(key) returns { type: 'number'|'date'|'string'|'bool', num: Float64Array|null, txt: string[] }
   */
  function compile (rules, getCol) {
    const compiled = [];
    for (const r0 of rules || []) {
      const r = { ...DEFAULT_RULE, ...r0 };
      if (!r.column) continue;
      const src = getCol(r.basedOn || r.column);
      if (!src || (r.column !== '*row*' && !getCol(r.column))) continue;
      const isNum = !!src.num;
      const c = { r, src, isNum };
      if ((r.style === 'scale' || r.style === 'bar') && isNum) {
        let min = Infinity; let max = -Infinity;
        const a = src.num;
        for (let i = 0; i < a.length; i++) { const v = a[i]; if (v === v) { if (v < min) min = v; if (v > max) max = v; } }
        c.min = min; c.max = max;
        c.mid = r.useMid ? (min < 0 && max > 0 ? 0 : (min + max) / 2) : null;
      }
      if (r.style === 'if') {
        c.n1 = parseFloat(String(r.v1).replace(/[, %]/g, '')) / (String(r.v1).includes('%') ? 100 : 1);
        c.n2 = parseFloat(String(r.v2).replace(/[, %]/g, '')) / (String(r.v2).includes('%') ? 100 : 1);
        c.t1 = String(r.v1).toLowerCase();
      }
      compiled.push(c);
    }
    if (!compiled.length) return null;

    function test (c, i) {
      const r = c.r;
      const txt = c.src.txt[i] || '';
      if (r.op === 'empty') return txt === '' || txt === 'Null' || txt === '%null%';
      if (r.op === 'notempty') return !(txt === '' || txt === 'Null' || txt === '%null%');
      if (r.op === 'contains') return txt.toLowerCase().includes(c.t1);
      if (c.isNum && c.n1 === c.n1) {
        const v = c.src.num[i];
        if (v !== v) return false;
        switch (r.op) {
          case '>': return v > c.n1;
          case '>=': return v >= c.n1;
          case '<': return v < c.n1;
          case '<=': return v <= c.n1;
          case '=': return v === c.n1;
          case '!=': return v !== c.n1;
          case 'between': return v >= Math.min(c.n1, c.n2) && v <= Math.max(c.n1, c.n2);
        }
        return false;
      }
      const t = txt.toLowerCase();
      if (r.op === '=') return t === c.t1;
      if (r.op === '!=') return t !== c.t1;
      return false;
    }

    return function styleFor (i) {
      let row = null;
      const cells = {};
      for (const c of compiled) {
        const r = c.r;
        let st = null;
        if (r.style === 'if') {
          if (!test(c, i)) continue;
          st = { bg: r.bg, fg: r.fg, bold: !!r.bold };
          if (r.scope === 'row') { row = Object.assign(row || {}, st); continue; }
        } else if (r.style === 'scale' && c.isNum) {
          const v = c.src.num[i];
          if (v !== v || !(c.max > c.min)) continue;
          let color;
          if (c.mid !== null) {
            color = v <= c.mid
              ? mix(r.low, r.mid, c.mid === c.min ? 1 : (v - c.min) / (c.mid - c.min))
              : mix(r.mid, r.high, c.max === c.mid ? 1 : (v - c.mid) / (c.max - c.mid));
          } else color = mix(r.low, r.high, (v - c.min) / (c.max - c.min));
          st = r.target === 'text' ? { fg: color } : { bg: color, fg: inkFor(color) };
        } else if (r.style === 'bar' && c.isNum) {
          const v = c.src.num[i];
          if (v !== v) continue;
          const lo = Math.min(0, c.min); const hi = Math.max(0, c.max);
          st = { bar: hi > lo ? Math.abs(v) / Math.max(Math.abs(lo), Math.abs(hi)) : 0, barColor: r.barColor };
        } else if (r.style === 'arrow' && c.isNum) {
          const v = c.src.num[i];
          if (v !== v || v === 0) continue;
          const good = (v > 0) === !!r.higherIsBetter;
          st = { arrow: v > 0 ? '▲' : '▼', arrowColor: good ? r.up : r.down };
        }
        if (st) cells[r.column] = Object.assign(cells[r.column] || {}, st);
      }
      return { row, cells };
    };
  }

  return { OPS, DEFAULT_RULE, compile };
})();
