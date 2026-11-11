/* Sample data for previewing Smart Table without Tableau (see shared/dev/mock-tableau.js).
 * dev/preview.html?scenario=customers50k | customers200k | small | detail | empty
 */
/* global MockTableau */
(function () {
  // deterministic pseudo-random numbers so screenshots are stable
  function rng (seed) { return () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; }; }

  const FIRST = ['Abdullah', 'Sara', 'Mohammed', 'Noura', 'Faisal', 'Lama', 'Khalid', 'Reem', 'Omar', 'Hessa', 'Yousef', 'Dana', 'Turki', 'Maha', 'Saad', 'Jawaher'];
  const LAST = ['Al-Qahtani', 'Al-Otaibi', 'Al-Harbi', 'Al-Shehri', 'Al-Ghamdi', 'Al-Zahrani', 'Al-Dosari', 'Al-Mutairi', 'Al-Anazi', 'Al-Subaie'];
  const CITIES = ['Riyadh', 'Jeddah', 'Dammam', 'Makkah', 'Madinah', 'Khobar', 'Abha', 'Tabuk', 'Buraidah', 'Hail', 'Jazan', 'Najran'];
  const SEGMENTS = ['Retail', 'Retail', 'Retail', 'Affluent', 'SME', 'Youth'];
  const STATUS = ['Active', 'Active', 'Active', 'Dormant', 'Unfunded', 'Closed'];

  function customers (M, n, withDetail) {
    const rnd = rng(42);
    const columns = ['Customer ID', 'Customer Name', 'City', 'Segment', 'Status', 'DAY(Onboard Date)', 'SUM(Balance)', 'SUM(Transactions)', 'AGG(Balance Growth %)'];
    const types = ['string', 'string', 'string', 'string', 'string', 'date', 'float', 'int', 'float'];
    if (withDetail) { columns.push('Risk Score'); types.push('int'); }
    const data = new Array(n);
    const start = Date.UTC(2022, 0, 1);
    for (let i = 0; i < n; i++) {
      const id = 'C' + String(100000 + i);
      const name = FIRST[Math.floor(rnd() * FIRST.length)] + ' ' + LAST[Math.floor(rnd() * LAST.length)];
      const city = CITIES[Math.floor(rnd() * rnd() * CITIES.length)];
      const seg = SEGMENTS[Math.floor(rnd() * SEGMENTS.length)];
      const st = STATUS[Math.floor(rnd() * STATUS.length)];
      const d = new Date(start + Math.floor(rnd() * 1760) * 864e5);
      const bal = st === 'Unfunded' ? 0 : Math.round(Math.pow(rnd(), 3) * 250000 * 100) / 100;
      const tx = st === 'Unfunded' ? 0 : Math.floor(rnd() * 140);
      const g = st === 'Unfunded' ? null : Math.round((rnd() - 0.42) * 1000) / 1000;
      const row = [
        M.dv(id, id, id), M.dv(name, name, name), M.dv(city, city, city), M.dv(seg, seg, seg), M.dv(st, st, st),
        M.dv(M.iso(d), d, M.fmtDay(d)),
        M.dv(bal, bal, 'SAR ' + bal.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
        M.dv(tx, tx, M.fmtInt(tx)),
        g === null ? M.dv('%null%', null, 'Null') : M.dv(g, g, (g * 100).toFixed(1) + '%')
      ];
      if (withDetail) { const r = Math.floor(rnd() * 100); row.push(M.dv(r, r, String(r))); }
      data[i] = row;
    }
    const encodings = columns.slice(0, 9).map((c) => ({ id: 'fields', field: M.field(c) }));
    if (withDetail) encodings.push({ id: 'detail', field: M.field('Risk Score') });
    return { columns, types, data, encodings };
  }

  MockTableau.scenario('customers50k', (M) => customers(M, 50000, false));
  MockTableau.scenario('customers200k', (M) => customers(M, 200000, false));
  MockTableau.scenario('small', (M) => customers(M, 40, false));
  MockTableau.scenario('detail', (M) => customers(M, 5000, true));
  MockTableau.scenario('longheaders', (M) => {
    const rnd = rng(7);
    const columns = ['Customer ID', 'Overall Status', 'Customer Summary', 'AGG(No. of Months Active (Last 12 Months))', 'SUM(Total Transfer Amount (Last 12 Months) SAR)', 'SUM(Net Profit (Last 12 Months) SAR)'];
    const types = ['string', 'string', 'string', 'int', 'float', 'float'];
    const data = [];
    for (let i = 0; i < 3000; i++) {
      const id = String(29024385719 - i * 13771); const m = Math.floor(rnd() * 3); const amt = Math.round(rnd() * 450000 * 100) / 100; const np = Math.round(amt * 0.006 * 100) / 100;
      const sum = `No transfer for ${2 + m} months · net profit SAR ${np >= 1000 ? (np / 1000).toFixed(1) + 'K' : Math.round(np)} in 12 months`;
      const f2 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      data.push([M.dv(id, id, id), M.dv('At Risk', 'At Risk', 'At Risk'), M.dv(sum, sum, sum), M.dv(m, m, String(m)), M.dv(amt, amt, f2(amt)), M.dv(np, np, f2(np))]);
    }
    return { columns, types, data, encodings: columns.map((c) => ({ id: 'fields', field: M.field(c) })) };
  });
  // a few contracts (dashboard filtered down to 1–2 rows)
  function contracts (M, n) {
    const columns = ['Contract Id', 'Contract Status', 'Loan bucket', 'dpd_bucket', 'SUM(Total Disbursed Amount (SAR))', 'SUM(Total Profit Paid (SAR))', 'SUM(Total Principal Paid (SAR))', 'SUM(Overdue Amount (SAR))', 'SUM(Overdue Days)'];
    const types = ['string', 'string', 'string', 'string', 'float', 'float', 'float', 'float', 'int'];
    const rows = [['9b67fbe3-681b-4c2e-9f1a-2b7d', 'REPAID', '50K-100K', 'Current', 75000, 2542.47, 74999.96, 0, 0], ['a41c0d77-25e9-4b0f-8c3e-91aa', 'REPAID', '10K-50K', 'Current', 30000, 980.1, 30000, 0, 0], ['c0ffee12-0000-4b0f-8c3e-91aa', 'ACTIVE', '100K+', '1-30', 150000, 4100, 52000, 3100, 12]];
    const f2 = (v) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const data = rows.slice(0, n).map((r) => r.map((v, i) => (i < 4 ? M.dv(v, v, v) : M.dv(v, v, i === 8 ? String(v) : f2(v)))));
    return { columns, types, data, encodings: columns.map((c) => ({ id: 'fields', field: M.field(c) })) };
  }
  MockTableau.scenario('one', (M) => contracts(M, 1));
  MockTableau.scenario('two', (M) => contracts(M, 2));
  // a row with only Null values (shown as an empty line before 1.4.2)
  MockTableau.scenario('nullrow', (M) => { const d = contracts(M, 1); d.data.unshift(d.columns.map(() => M.dv('%null%', null, 'Null'))); return d; });
  MockTableau.scenario('empty', () => ({ columns: [], data: [], encodings: [] }));
})();
