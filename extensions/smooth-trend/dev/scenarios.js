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

MockTableau.scenario('dpd', (M) => {
  // like Tableau's Color shelf: dpd_bucket splits the count into two lines; DPD 180+ starts later
  const columns = ['DAY(Snap Dt)', 'dpd_bucket', 'AGG(No of Contracts)'];
  const data = [];
  for (let t = Date.UTC(2026, 6, 1), i = 0; t <= Date.UTC(2026, 9, 24); t += 864e5, i++) {
    const d = new Date(t);
    const a = Math.round(30 + i * 0.28 + Math.sin(i / 6) * 4);
    data.push([M.dv(M.iso(d), d, M.fmtDay(d)), M.dv('DPD 90-179', 'DPD 90-179', 'DPD 90-179'), M.dv(a, a, M.fmtInt(a))]);
    if (i >= 40) {
      const b = Math.round(4 + (i - 40) * 0.17 + Math.cos(i / 5) * 1.5);
      data.push([M.dv(M.iso(d), d, M.fmtDay(d)), M.dv('DPD 180+', 'DPD 180+', 'DPD 180+'), M.dv(b, b, M.fmtInt(b))]);
    }
  }
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'series', field: M.field(columns[1]) }, { id: 'value', field: M.field(columns[2]) }] };
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

MockTableau.scenario('overdraft', (M) => {
  // all-negative daily balance, like an overdraft: -3.67M drifting to -3.84M
  const columns = ['snap_dt', 'SUM(rtl_od_bal)'];
  const data = [];
  let v = -3670000;
  for (let i = 0; i < 33; i++) {
    const d = new Date(Date.UTC(2026, 9, 1 + i));
    v += -5200 - Math.max(0, Math.sin(i / 3)) * 9000 + (i === 25 ? 15000 : 0);
    data.push([M.dv(M.iso(d), d, M.fmtDay(d)), M.dv(v, v, v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))]);
  }
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }] };
});

MockTableau.scenario('target', (M) => {
  // monthly sales with a monthly target on Detail and a parameter "Sales Goal"
  const columns = ['MONTH(Order Date)', 'SUM(Sales)', 'SUM(Target)', 'AGG(Budget Line)'];
  let v = 1100000;
  const data = M.months(14, Date.UTC(2025, 8, 1)).map((d, i) => {
    v = v * (1.03 + Math.sin(i * 1.1) * 0.06);
    const t = 1150000 + i * 45000; const b = 1500000;
    return [M.dv(M.iso(d), d, M.fmtMonth(d)), M.dv(v, v, M.fmtMoney(v)), M.dv(t, t, M.fmtMoney(t)), M.dv(b, b, M.fmtMoney(b))];
  });
  return {
    columns, data,
    encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }, { id: 'detail', field: M.field(columns[2]) }, { id: 'detail', field: M.field(columns[3]) }],
    params: [{ name: 'Sales Goal', value: 1800000, formatted: 'SAR 1,800,000' }]
  };
});

MockTableau.scenario('overdraftYear', (M) => {
  // 306 days, -2.74M stepping down to -3.84M (like the real OD Total sheet)
  const columns = ['snap_dt', 'SUM(Total Overdrawn Amount (SAR))'];
  const data = [];
  let v = -2740000;
  for (let i = 0; i < 306; i++) {
    const d = new Date(Date.UTC(2026, 0, 1 + i));
    v += -3600 + Math.sin(i / 2.3) * 2500 + (i % 40 === 20 ? -120000 : 0);
    data.push([M.dv(M.iso(d), d, M.fmtDay(d)), M.dv(v, v, v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))]);
  }
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }] };
});

MockTableau.scenario('profitloss', (M) => {
  // crosses zero: monthly profit/loss
  const columns = ['MONTH(Date)', 'SUM(Net Profit)'];
  const vals = [-420000, -310000, -150000, -60000, 40000, 120000, 90000, 210000, 330000, 280000, 410000, 520000];
  const data = M.months(12, Date.UTC(2025, 10, 1)).map((d, i) => [M.dv(M.iso(d), d, M.fmtMonth(d)), M.dv(vals[i], vals[i], M.fmtMoney(vals[i]))]);
  return { columns, data, encodings: [{ id: 'date', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }] };
});

MockTableau.scenario('empty', () => ({ columns: [], data: [], encodings: [] }));
