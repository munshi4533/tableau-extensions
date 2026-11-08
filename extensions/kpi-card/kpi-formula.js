/* KPI Card – small, safe formula engine (no eval).
 *   [Field] references, numbers, + - * / ( ), and functions:
 *   SUM(x) ABS(x) MIN(a,b,…) MAX(a,b,…) ROUND(x[,digits]) ZN(x) IFNULL(x,y) DAYS()
 * Any null input gives null (except ZN / IFNULL); dividing by 0 gives null.
 *   const f = KpiFormula.compile('[Loan Amount] / [Loans]');
 *   f.error   -> message or null
 *   f.refs    -> ['Loan Amount', 'Loans']
 *   f.run((name) => value, { days: 8 }) -> number | null
 */
(function (root) {
  'use strict';
  const FUNCS = {
    ABS: { n: [1, 1], f: (a) => Math.abs(a) },
    SUM: { n: [1, 1], f: (a) => a }, // each [Field] is already rolled up for the period; SUM() is accepted for Tableau habits
    MIN: { n: [1, 99], f: (...a) => Math.min(...a) },
    MAX: { n: [1, 99], f: (...a) => Math.max(...a) },
    ROUND: { n: [1, 2], f: (x, d = 0) => { const p = Math.pow(10, d); return Math.round(x * p) / p; } },
    ZN: { n: [1, 1], nullOk: true, f: (x) => (x === null ? 0 : x) },
    IFNULL: { n: [2, 2], nullOk: true, f: (x, y) => (x === null ? y : x) },
    DAYS: { n: [0, 0], ctx: true, f: (ctx) => (ctx && ctx.days) || null }
  };

  function tokenize (src) {
    const t = []; let i = 0;
    while (i < src.length) {
      const c = src[i];
      if (/\s/.test(c)) { i++; continue; }
      if (c === '[') {
        const j = src.indexOf(']', i);
        if (j < 0) throw new Error('Missing ] after [' + src.slice(i + 1, i + 15));
        const name = src.slice(i + 1, j).trim();
        if (!name) throw new Error('Empty [ ]');
        t.push({ k: 'ref', v: name }); i = j + 1; continue;
      }
      const num = src.slice(i).match(/^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i);
      if (num) { t.push({ k: 'num', v: parseFloat(num[0]) }); i += num[0].length; continue; }
      const id = src.slice(i).match(/^[A-Za-z_]\w*/);
      if (id) { t.push({ k: 'id', v: id[0].toUpperCase() }); i += id[0].length; continue; }
      if ('+-*/(),'.includes(c)) { t.push({ k: c }); i++; continue; }
      throw new Error(`Unexpected "${c}". Put field names in [square brackets].`);
    }
    return t;
  }

  // recursive descent -> closure tree
  function parse (tokens) {
    let p = 0; const refs = [];
    const peek = () => tokens[p]; const take = (k) => (tokens[p] && tokens[p].k === k ? tokens[p++] : null);
    const nul = (a, b, f) => (a === null || b === null ? null : f(a, b));
    function expr () {
      let l = term();
      for (;;) {
        if (take('+')) { const a = l; const b = term(); l = (g, c) => nul(a(g, c), b(g, c), (x, y) => x + y); } else if (take('-')) { const a = l; const b = term(); l = (g, c) => nul(a(g, c), b(g, c), (x, y) => x - y); } else return l;
      }
    }
    function term () {
      let l = unary();
      for (;;) {
        if (take('*')) { const a = l; const b = unary(); l = (g, c) => nul(a(g, c), b(g, c), (x, y) => x * y); } else if (take('/')) { const a = l; const b = unary(); l = (g, c) => nul(a(g, c), b(g, c), (x, y) => (y === 0 ? null : x / y)); } else return l;
      }
    }
    function unary () {
      if (take('-')) { const a = unary(); return (g, c) => { const v = a(g, c); return v === null ? null : -v; }; }
      if (take('+')) return unary();
      return primary();
    }
    function primary () {
      const t = peek();
      if (!t) throw new Error('The formula ends too early.');
      if (take('num')) return () => t.v;
      if (take('ref')) { if (!refs.includes(t.v)) refs.push(t.v); return (g) => { const v = g(t.v); return Number.isFinite(v) ? v : null; }; }
      if (take('(')) { const e = expr(); if (!take(')')) throw new Error('Missing )'); return e; }
      if (take('id')) {
        const fn = FUNCS[t.v];
        if (!fn) throw new Error(`Unknown function ${t.v}. Use SUM, ABS, MIN, MAX, ROUND, ZN, IFNULL or DAYS.`);
        if (!take('(')) throw new Error(`${t.v} needs ( )`);
        const args = [];
        if (!take(')')) {
          do { args.push(expr()); } while (take(','));
          if (!take(')')) throw new Error('Missing ) after ' + t.v);
        }
        if (args.length < fn.n[0] || args.length > fn.n[1]) throw new Error(`${t.v} takes ${fn.n[0] === fn.n[1] ? fn.n[0] : fn.n[0] + '–' + fn.n[1]} value(s).`);
        return (g, c) => {
          if (fn.ctx) return fn.f(c);
          const v = args.map((a) => a(g, c));
          if (!fn.nullOk && v.some((x) => x === null)) return null;
          const r = fn.f(...v);
          return Number.isFinite(r) ? r : null;
        };
      }
      throw new Error(`Unexpected "${t.k === 'id' ? t.v : t.k}".`);
    }
    const root = expr();
    if (p < tokens.length) throw new Error(`Unexpected "${tokens[p].v ?? tokens[p].k}" — missing an operator?`);
    return { root, refs };
  }

  function compile (src) {
    const s = String(src || '').trim();
    if (!s) return { error: 'Write a formula, e.g. [Loan Amount] / [Loans]', refs: [], run: () => null };
    try {
      const { root: fn, refs } = parse(tokenize(s));
      return { error: null, refs, run: (get, ctx) => { const v = fn(get, ctx || {}); return Number.isFinite(v) ? v : null; } };
    } catch (e) {
      return { error: e.message, refs: [], run: () => null };
    }
  }

  root.KpiFormula = { compile };
})(typeof window !== 'undefined' ? window : globalThis);
