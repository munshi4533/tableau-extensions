/* Sample data for previewing Funnel without Tableau. Open dev/preview.html?scenario=<name>&cfg={...} */
/* global MockTableau */
(function () {
  // one row: one measure per stage
  function stages (M, list, fmt) {
    const columns = list.map(([n]) => n);
    const data = [list.map(([, v]) => M.dv(v, v, fmt ? fmt(v) : M.fmtInt(v)))];
    return { columns, data, encodings: columns.map((c) => ({ id: 'stages', field: M.field(c) })) };
  }
  const LOAN = [['CNTD(Started App)', 474765], ['CNTD(Submitted App)', 88272], ['CNTD(Approved App)', 78432], ['CNTD(Disbursed App)', 19856]];
  MockTableau.scenario('applications', (M) => stages(M, LOAN));
  // names as on your dashboard
  MockTableau.scenario('d360', (M) => stages(M, [['CNTD(Application Started)', 591405], ['CNTD(Application Submitted)', 119495], ['CNTD(Application Approved)', 94454], ['CNTD(Loan Disbursed)', 23173]]));
  MockTableau.scenario('five', (M) => stages(M, [['CNTD(Onboarded)', 120400], ['CNTD(KYC Done)', 101250], ['CNTD(Funded)', 64310], ['CNTD(First Transaction)', 51880], ['CNTD(Active 30d)', 33120]]));
  MockTableau.scenario('amounts', (M) => stages(M, [['SUM(Requested Amount)', 9.82e9], ['SUM(Approved Amount)', 6.41e9], ['SUM(Disbursed Amount)', 3.95e9]], (v) => Math.round(v / 1e6).toLocaleString('en-US') + ' Mn'));
  // a dimension on Detail: several rows, the stage is their total
  MockTableau.scenario('byProduct', (M) => {
    const columns = ['Product', ...LOAN.map(([n]) => n)];
    const split = [['Cash', 0.55], ['BNPL', 0.3], ['Card', 0.15]];
    const data = split.map(([p, sh]) => [M.dv(p, p, p), ...LOAN.map(([, v]) => { const x = Math.round(v * sh); return M.dv(x, x, M.fmtInt(x)); })]);
    return { columns, data, encodings: [...LOAN.map(([n]) => ({ id: 'stages', field: M.field(n) })), { id: 'detail', field: M.field('Product') }] };
  });
  MockTableau.scenario('empty', () => ({ columns: [], data: [], encodings: [] }));
})();
