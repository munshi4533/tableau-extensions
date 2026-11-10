/* Sample data for previewing KPI Card without Tableau (see shared/dev/mock-tableau.js).
 * The first scenario is the default. Open dev/preview.html?scenario=<name>&cfg={...}
 */
/* global MockTableau */

// daily lending data, 1 Nov 2025 – 8 Nov 2026, with Tableau-style formats ("28 Mn", "62.4%")
function loanDays (M, from, to) {
  const mn = (x) => Math.round(x / 1e6).toLocaleString('en-US') + ' Mn';
  const rows = []; let bal = 1800e6;
  for (let t = from, i = 0; t <= to; t += 864e5, i++) {
    const d = new Date(t); const fri = d.getUTCDay() === 5;
    const loans = Math.round((fri ? 45 : 110) + i * 0.12 + Math.sin(i / 5) * 14);
    const size = 255000 + i * 90 + Math.cos(i / 9) * 22000; // average loan size drifts up
    const amt = loans * size;
    bal = bal + amt * 0.35 - 6e6;
    const target = (fri ? 14e6 : 33e6) + i * 25000;
    const appr = 0.6 + Math.sin(i / 17) * 0.04;
    rows.push([M.dv(M.iso(d), d, M.fmtDay(d)), M.dv(amt, amt, mn(amt)), M.dv(loans, loans, M.fmtInt(loans)), M.dv(bal, bal, mn(bal)), M.dv(target, target, mn(target)), M.dv(appr, appr, (appr * 100).toFixed(1) + '%')]);
  }
  return rows;
}
const LOAN_COLS = ['DAY(Disbursement Date)', 'SUM(Loan Amount)', 'CNT(Loans)', 'SUM(Outstanding Balance)', 'SUM(Target Amount)', 'AGG(Approval Rate)'];

MockTableau.scenario('loans', (M) => {
  const data = loanDays(M, Date.UTC(2025, 10, 1), Date.UTC(2026, 10, 8));
  return { columns: LOAN_COLS, data, encodings: [{ id: 'date', field: M.field(LOAN_COLS[0]) }, ...LOAN_COLS.slice(1).map((c) => ({ id: 'measures', field: M.field(c) }))] };
});

MockTableau.scenario('twoMonths', (M) => {
  // short history: sparklines fall back to days
  const data = loanDays(M, Date.UTC(2026, 8, 20), Date.UTC(2026, 10, 8));
  return { columns: LOAN_COLS.slice(0, 3), data: data.map((r) => r.slice(0, 3)), encodings: [{ id: 'date', field: M.field(LOAN_COLS[0]) }, { id: 'measures', field: M.field(LOAN_COLS[1]) }, { id: 'measures', field: M.field(LOAN_COLS[2]) }] };
});

MockTableau.scenario('monthly', (M) => {
  // date at MONTH level: periods become This month / Last month
  const columns = ['MONTH(Disbursement Date)', 'SUM(Loan Amount)', 'CNT(Loans)'];
  const data = M.months(14, Date.UTC(2025, 8, 1)).map((d, i) => {
    const n = 2900 + i * 40; const a = n * (262000 + i * 1500);
    return [M.dv(M.iso(d), d, M.fmtMonth(d)), M.dv(a, a, M.fmtMoney(a)), M.dv(n, n, M.fmtInt(n))];
  });
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'measures', field: M.field(columns[1]) }, { id: 'measures', field: M.field(columns[2]) }] };
});

MockTableau.scenario('empty', () => ({ columns: [], data: [], encodings: [] }));

MockTableau.scenario('twoYears', (M) => {
  // two years of history, so YTD can be compared with LYTD
  const data = loanDays(M, Date.UTC(2024, 10, 1), Date.UTC(2026, 10, 8));
  return { columns: LOAN_COLS, data, encodings: [{ id: 'date', field: M.field(LOAN_COLS[0]) }, ...LOAN_COLS.slice(1).map((c) => ({ id: 'measures', field: M.field(c) }))] };
});

MockTableau.scenario('funnel', (M) => {
  // lending funnel per day (like Initiated / Submitted / Approved / Disbursed cards)
  const columns = ['DAY(Created Date)', 'CNT(Initiated)', 'CNT(Submitted)', 'CNT(Approved)', 'CNT(Disbursed)'];
  const data = [];
  for (let t = Date.UTC(2026, 0, 6), i = 0; t <= Date.UTC(2026, 10, 8); t += 864e5, i++) {
    const d = new Date(t);
    const spike = i >= 218 && i <= 222 ? 6 - Math.abs(220 - i) * 2 : 1;
    const base = (300 + i * 7 + Math.abs(Math.sin(i * 1.7)) * 900) * spike;
    const ini = Math.round(base); const sub = Math.round(ini * 0.19); const app = Math.round(sub * (0.8 + 0.1 * Math.sin(i / 40))); const dis = Math.round(app * (0.18 + i * 0.0012));
    data.push([M.dv(M.iso(d), d, M.fmtDay(d)), ...[ini, sub, app, dis].map((v) => M.dv(v, v, M.fmtInt(v)))]);
  }
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, ...columns.slice(1).map((c) => ({ id: 'measures', field: M.field(c) }))] };
});

MockTableau.scenario('dateLevel', (M) => {
  // like a Tableau calc: DATETRUNC([Date Level] parameter, [Disbursement Date]) on the Date shelf
  const level = String(M.param('Date Level', 'Day')).toLowerCase();
  const trunc = (d) => {
    const y = d.getUTCFullYear(); const m = d.getUTCMonth();
    if (level === 'month') return new Date(Date.UTC(y, m, 1));
    if (level === 'quarter') return new Date(Date.UTC(y, m - (m % 3), 1));
    if (level === 'year') return new Date(Date.UTC(y, 0, 1));
    return d;
  };
  const byKey = new Map();
  loanDays(M, Date.UTC(2025, 0, 1), Date.UTC(2026, 10, 8)).forEach((r) => {
    const d = trunc(r[0].nativeValue); const k = +d;
    const o = byKey.get(k) || { d, a: 0, n: 0 };
    o.a += r[1].value; o.n += r[2].value; byKey.set(k, o);
  });
  const mn = (x) => Math.round(x / 1e6).toLocaleString('en-US') + ' Mn';
  const columns = ['Date by Level', 'SUM(Loan Amount)', 'CNT(Loans)'];
  const data = [...byKey.values()].map((o) => [M.dv(M.iso(o.d), o.d, M.fmtDay(o.d)), M.dv(o.a, o.a, mn(o.a)), M.dv(o.n, o.n, M.fmtInt(o.n))]);
  return { columns, data, params: [{ name: 'Date Level', value: 'Day' }], encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'measures', field: M.field(columns[1]) }, { id: 'measures', field: M.field(columns[2]) }] };
});
