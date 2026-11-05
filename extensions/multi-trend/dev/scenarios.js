/* Sample data for previewing Multi Measure Trend without Tableau. */
/* global MockTableau */
(function () {
  function rng (seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

  // Like the Loan 360 sheet: day of month 1–31, last month vs last-3-month average vs this month (MTD, only first days)
  MockTableau.scenario('loans', (M) => {
    const rnd = rng(11);
    const columns = ['DAY(Disbursement Date)', 'AGG(Disburse Amount | Last Month)', 'AGG(Disburse Amount | Last 3 Months)', 'AGG(Disbursed Amount | MTD)'];
    const money = (v) => 'SAR ' + Math.round(v).toLocaleString('en-US');
    const data = [];
    for (let d = 1; d <= 31; d++) {
      const lm = 2.6e6 + Math.sin(d / 2.2) * 9e5 + rnd() * 9e5 + (d === 19 ? 1.6e6 : 0);
      const l3 = 3.1e6 + Math.sin(d / 3) * 8e5 + rnd() * 1.2e6 + (d > 14 && d < 21 ? 1.2e6 : 0);
      const mtd = d <= 4 ? 3.7e6 + d * 1.1e5 : null;
      data.push([M.dv(d, d, String(d)), M.dv(lm, lm, money(lm)), M.dv(l3, l3, money(l3)), mtd === null ? M.dv('%null%', null, 'Null') : M.dv(mtd, mtd, money(mtd))]);
    }
    return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, ...columns.slice(1).map((c) => ({ id: 'measures', field: M.field(c) }))] };
  });

  // Monthly: sales as bars, target as dashed line, margin % on the right axis
  MockTableau.scenario('mixed', (M) => {
    const columns = ['MONTH(Order Date)', 'SUM(Sales)', 'SUM(Target)', 'AGG(Margin %)', 'SUM(Orders)'];
    let v = 900000;
    const data = M.months(12, Date.UTC(2025, 10, 1)).map((d, i) => {
      v = v * (1.03 + Math.sin(i) * 0.07);
      const t = 950000 + i * 30000; const mg = 0.18 + Math.sin(i / 2) * 0.04; const o = Math.round(v / 310);
      return [M.dv(M.iso(d), d, M.fmtMonth(d)), M.dv(v, v, M.fmtMoney(v)), M.dv(t, t, M.fmtMoney(t)), M.dv(mg, mg, (mg * 100).toFixed(1) + '%'), M.dv(o, o, o.toLocaleString('en-US'))];
    });
    return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'measures', field: M.field(columns[1]) }, { id: 'measures', field: M.field(columns[2]) }, { id: 'measures', field: M.field(columns[3]) }, { id: 'tooltip', field: M.field(columns[4]) }] };
  });

  MockTableau.scenario('empty', () => ({ columns: [], data: [], encodings: [] }));
})();

MockTableau.scenario('mn', (M) => {
  // Tableau custom number format "892 Mn" next to a count with display units "12.4K"
  const columns = ['MONTH(Disb Date)', 'SUM(Disbursed Amount)', 'SUM(Target Amount)', 'CNT(Contracts)'];
  const data = M.months(12, Date.UTC(2025, 10, 1)).map((d, i) => {
    const v = 700e6 + i * 16e6 + Math.sin(i) * 40e6; const t = 720e6 + i * 14e6; const c = 9800 + i * 260;
    const mn = (x) => Math.round(x / 1e6).toLocaleString('en-US') + ' Mn';
    return [M.dv(M.iso(d), d, M.fmtMonth(d)), M.dv(v, v, mn(v)), M.dv(t, t, mn(t)), M.dv(c, c, (c / 1000).toFixed(1) + 'K')];
  });
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'measures', field: M.field(columns[1]) }, { id: 'measures', field: M.field(columns[2]) }, { id: 'measures', field: M.field(columns[3]) }] };
});
