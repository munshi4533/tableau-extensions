/* Sample data for previewing __NAME__ in a browser. The first scenario is the default. */
/* global MockTableau */
MockTableau.scenario('basic', (M) => {
  const columns = ['Segment', 'SUM(Customers)'];
  const rows = [['Retail', 182000], ['SME', 41250], ['Corporate', 3900], ['Private', 1200]];
  return {
    columns,
    data: rows.map(([s, v]) => [M.dv(s, s, s), M.dv(v, v, M.fmtInt(v))]),
    encodings: [{ id: 'category', field: M.field(columns[0]) }, { id: 'value', field: M.field(columns[1]) }]
  };
});
MockTableau.scenario('empty', () => ({ columns: [], data: [], encodings: [] }));
