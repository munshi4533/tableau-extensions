/* Sample data for previewing Bar List without Tableau. Open dev/preview.html?scenario=<name>&cfg={...} */
/* global MockTableau */

// one panel of the "Affordability Overview" (counts as in the screenshot) + a loan amount per bucket
function panel (M, dim, rows, amtPer) {
  const columns = [dim, 'CNT(Customers)', 'SUM(Loan Amount)'];
  const data = rows.map(([n, c], i) => { const a = c * (amtPer[i % amtPer.length]); return [M.dv(n, n, n), M.dv(c, c, M.fmtInt(c)), M.dv(a, a, Math.round(a / 1e6).toLocaleString('en-US') + ' Mn')]; });
  return { columns, data, encodings: [{ id: 'category', field: M.field(columns[0]) }, { id: 'measures', field: M.field(columns[1]) }, { id: 'measures', field: M.field(columns[2]) }] };
}
MockTableau.scenario('salary', (M) => panel(M, 'Salary Bucket', [['Not Available', 266662], ['4K to 5K', 15348], ['5K to 8K', 38809], ['8K to 10K', 24564], ['10K to 15K', 49119], ['15K to 20K', 34290], ['20K to 25K', 12333], ['25K to 40K', 11309], ['40K+', 4199], ['Less Than 4K', 18851]], [8000, 12000, 21000, 30000, 42000, 55000, 64000, 80000, 120000, 6000]));
MockTableau.scenario('simah', (M) => panel(M, 'Simah Score', [['Zero', 964], ['0-500', 19632], ['500-600', 50400], ['600-700', 139095], ['700-800', 92110], ['800 or More', 11935], ['Not Available', 161348]], [9000, 14000, 22000, 31000, 38000, 45000, 12000]));
MockTableau.scenario('employment', (M) => panel(M, 'Employment', [['Null', 370732], ['BLUE_CHIPS', 2729], ['GOVERNMENT', 29472], ['MILITARY', 9938], ['MILITARY_AIRFORCE', 969], ['PENSIONER', 3386], ['PRIVATE_COMPANIES', 15363], ['SEMI_GOVERNMENT', 11517], ['UNCATEGORIZED_EMPLOYER', 31378]], [10000, 52000, 41000, 36000, 34000, 18000, 33000, 38000, 21000]));

MockTableau.scenario('breakdown', (M) => {
  // Salary bucket split by product, with a target per bucket
  const columns = ['Salary Bucket', 'Product', 'CNT(Customers)', 'SUM(Target Customers)'];
  const data = [];
  [['Less Than 4K', 18851], ['4K to 5K', 15348], ['5K to 8K', 38809], ['8K to 10K', 24564], ['10K to 15K', 49119], ['15K to 20K', 34290], ['20K to 25K', 12333], ['25K to 40K', 11309], ['40K+', 4199]].forEach(([n, c], i) => {
    const t = Math.round(c * (0.9 + (i % 4) * 0.08));
    [['Cash', 0.55], ['BNPL', 0.3], ['Card', 0.15]].forEach(([p, sh], pi) => { const v = Math.round(c * sh); const tv = pi === 0 ? t : 0; data.push([M.dv(n, n, n), M.dv(p, p, p), M.dv(v, v, M.fmtInt(v)), M.dv(tv, tv, M.fmtInt(tv))]); });
  });
  return { columns, data, encodings: [{ id: 'category', field: M.field(columns[0]) }, { id: 'breakdown', field: M.field(columns[1]) }, { id: 'measures', field: M.field(columns[2]) }, { id: 'target', field: M.field(columns[3]) }] };
});
MockTableau.scenario('empty', () => ({ columns: [], data: [], encodings: [] }));

MockTableau.scenario('long', (M) => {
  // 40 nationalities: the list scrolls; a good case for Top N
  const columns = ['Nationality', 'CNT(Customers)'];
  const names = ['SA', 'IN', 'PK', 'EG', 'PH', 'BD', 'JO', 'YE', 'SY', 'SD', 'LB', 'NP', 'LK', 'ID', 'TR', 'MA', 'TN', 'DZ', 'IQ', 'PS', 'ET', 'ER', 'KE', 'NG', 'GB', 'US', 'FR', 'DE', 'IT', 'ES', 'CN', 'MY', 'TH', 'VN', 'AF', 'IR', 'OM', 'KW', 'BH', 'AE'];
  const data = names.map((n, i) => { const c = Math.round(504300 / Math.pow(i + 1, 1.6)); return [M.dv(n, n, n), M.dv(c, c, M.fmtInt(c))]; });
  return { columns, data, encodings: [{ id: 'category', field: M.field(columns[0]) }, { id: 'measures', field: M.field(columns[1]) }] };
});

MockTableau.scenario('status', (M) => {
  // loan application status (like the "Application's Current Status" panel)
  const columns = ['Current Status', 'CNT(Applications)'];
  const data = [['Rejected', 362762], ['Originating', 110300], ['Contract Agreed', 6000], ['Commodity Buy Agreed', 14000], ['Contract Signed', 9000], ['Commodity Ownership Transferred', 2000], ['Commodity Sell Agreed', 76900], ['Cancelled', 22000]].map(([n, c]) => [M.dv(n, n, n), M.dv(c, c, M.fmtInt(c))]);
  return { columns, data, encodings: [{ id: 'category', field: M.field(columns[0]) }, { id: 'measures', field: M.field(columns[1]) }] };
});
