/* Sample data for previewing Smooth Trend without Tableau (see shared/dev/mock-tableau.js).
 * The first scenario is the default. Open dev/preview.html?scenario=<name>
 */
/* global MockTableau */

MockTableau.scenario('single', (M) => {
  let v = 1200000;
  const columns = ['MONTH(Txn Date)', 'SUM(Transfer Amount)', 'SUM(Transfers)'];
  const data = M.months(18).map((d, i) => {
    v = v * (1.035 + Math.sin(i * 1.3) * 0.07);
    const cnt = Math.round(v / 950);
    return [M.dv(M.iso(d), d, M.fmtMonth(d)), M.dv(v, v, M.fmtMoney(v)), M.dv(cnt, cnt, M.fmtInt(cnt))];
  });
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }, { id: 'tooltip', field: M.field(columns[2]) }] };
});

MockTableau.scenario('down', (M) => {
  let v = 1200000;
  const columns = ['MONTH(Txn Date)', 'SUM(Transfer Amount)'];
  const data = M.months(18).map((d, i) => {
    v = v * (0.97 + Math.sin(i * 1.3) * 0.07);
    return [M.dv(M.iso(d), d, M.fmtMonth(d)), M.dv(v, v, M.fmtMoney(v))];
  });
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }] };
});

MockTableau.scenario('multi', (M) => {
  const columns = ['MONTH(Txn Date)', 'Segment', 'SUM(Deposits)'];
  const data = [];
  Object.entries({ Retail: 520000, SME: 300000, Corporate: 160000 }).forEach(([s, base], si) => {
    let v = base;
    M.months(14).forEach((d, i) => {
      v = v * (1 + 0.02 * (si === 2 ? -1 : 1) + Math.cos(i + si) * 0.05);
      data.push([M.dv(M.iso(d), d, M.fmtMonth(d)), M.dv(s, s, s), M.dv(v, v, M.fmtMoney(v))]);
    });
  });
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'series', field: M.field(columns[1]) }, { id: 'value', field: M.field(columns[2]) }] };
});

MockTableau.scenario('daily', (M) => {
  const columns = ['DAY(Txn Date)', 'SUM(Transfer Amount)'];
  const data = [];
  for (let t = Date.UTC(2025, 0, 1), i = 0; t <= Date.UTC(2026, 9, 25); t += 864e5, i++) {
    const d = new Date(t);
    const v = 40000 + i * 35 + Math.sin(i / 9) * 6000 + (d.getUTCDay() === 5 ? -15000 : 0);
    data.push([M.dv(M.iso(d), d, M.fmtDay(d)), M.dv(v, v, M.fmtMoney(v))]);
  }
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }] };
});

MockTableau.scenario('monthraw', (M) => {
  // monthly data on an exact-date pill: Tableau formats it as a full date
  let v = 152000;
  const columns = ['Month Start', 'SUM(Active Customers)'];
  const data = M.months(7, Date.UTC(2026, 3, 1)).map((d, i) => {
    v = v * (1.02 + Math.sin(i) * 0.03);
    return [M.dv(M.iso(d), d, `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()} 12:00:00 AM`), M.dv(v, v, M.fmtInt(v))];
  });
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }] };
});

MockTableau.scenario('kpi', (M) => {
  let v = 900000;
  const columns = ['MONTH(Txn Date)', 'SUM(Transfer Amount)', 'AGG(MTD Transfers)', 'AGG(LMTD Transfers)'];
  const data = M.months(12, Date.UTC(2025, 10, 1)).map((d, i) => {
    v = v * (1.03 + Math.sin(i) * 0.05);
    return [M.dv(M.iso(d), d, M.fmtMonth(d)), M.dv(v, v, M.fmtMoney(v)), M.dv(812345, 812345, M.fmtMoney(812345)), M.dv(760100, 760100, M.fmtMoney(760100))];
  });
  return {
    columns,
    data,
    encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }, { id: 'kpi', field: M.field(columns[2]) }, { id: 'kpi', field: M.field(columns[3]) }]
  };
});

MockTableau.scenario('ordinal', (M) => {
  const qs = ['Q1 2024', 'Q2 2024', 'Q3 2024', 'Q4 2024', 'Q1 2025', 'Q2 2025', 'Q3 2025'];
  const vals = [0.412, 0.438, 0.425, 0.47, 0.502, 0.488, 0.531];
  const columns = ['QUARTER(Onboard Date)', 'AGG(Funding Ratio)'];
  const data = qs.map((q, i) => [M.dv(q, q, q), M.dv(vals[i], vals[i], (vals[i] * 100).toFixed(1) + '%')]);
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }] };
});

MockTableau.scenario('empty', () => ({ columns: [], data: [], encodings: [] }));
