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
