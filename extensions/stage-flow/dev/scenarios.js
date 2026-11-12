/* Sample data for previewing Stage Flow without Tableau. Open dev/preview.html?scenario=<name>&cfg={...} */
/* global MockTableau */
(function () {
  const STAGES = ['Responsible lending', 'Income details', 'Medical condition', 'Scoring', 'Originating', 'Contract agreed', 'Commodity buy agreed', 'Contract signed', 'Ownership transferred', 'Disbursed'];
  const REACHED = [591405, 452300, 418900, 401200, 176400, 141800, 136900, 131200, 127500, 124100];
  const SPLIT = [[0.02, 0.38, 0.60], [0.10, 0.45, 0.45], [0.55, 0.20, 0.25], [0.86, 0.09, 0.05], [0.30, 0.55, 0.15], [0.05, 0.75, 0.20], [0.03, 0.72, 0.25], [0.02, 0.70, 0.28], [0.02, 0.73, 0.25]];
  const SUBS = {
    'Affordability/Dbr': [['Dbr Breach - No Mortgage', 0.38], ['Dbr Breach - Include Mortgage', 0.22], ['Dbr - Credit Card', 0.18], ['Inputted Info And Expenses', 0.14], ['Approved Amount Less Than Product Min Amount', 0.08]],
    'Credit History': [['Simah Score Less Than Minimum Score', 0.44], ['Delinquencies', 0.24], ['Default', 0.18], ['Court Enforcement', 0.09], ['Bounced Check', 0.05]],
    Employment: [['Minimum Salary', 0.41], ['No Salary/Income', 0.22], ['Length Of Service', 0.17], ['Employer Category', 0.12], ['Blocked Employer', 0.08]],
    'Other Risk Reason': [['Restricted Medical Condition', 0.30], ['Max Age Exceeded', 0.18], ['Non-Saudi', 0.14], ['Fraud - Risk', 0.12], ['Black Listed', 0.09], ['Other Risk Reason', 0.17]],
    'Rejected Second Check Simah': [['Other Risk Reason', 1]],
    'Not specified': [['REJECTED_SALARY', 1]]
  };
  const MIX = [{ Employment: 0.7, 'Other Risk Reason': 0.2, 'Not specified': 0.1 }, { Employment: 0.8, 'Affordability/Dbr': 0.2 }, { 'Other Risk Reason': 0.85, Employment: 0.15 },
    { 'Affordability/Dbr': 0.38, 'Credit History': 0.34, Employment: 0.18, 'Other Risk Reason': 0.07, 'Not specified': 0.03 }, { 'Rejected Second Check Simah': 0.6, 'Credit History': 0.3, 'Other Risk Reason': 0.1 },
    { 'Other Risk Reason': 1 }, { 'Other Risk Reason': 1 }, { 'Other Risk Reason': 1 }, { 'Other Risk Reason': 1 }];
  function loanFlow (M, opts = {}) {
    const columns = ['furthest_stage', 'outcome', 'reject_reason', 'reject_sub_reason', 'CNTD(id)', 'MIN(furthest_rank)'];
    const types = ['string', 'string', 'string', 'string', 'int', 'int'];
    const data = [];
    const NUL = M.dv('%null%', null, 'Null');
    const add = (stage, rank, outcome, r1, r2, v) => { v = Math.round(v); if (v <= 0) return; data.push([M.dv(stage, stage, stage), M.dv(outcome, outcome, outcome), r1 ? M.dv(r1, r1, r1) : NUL, r2 ? M.dv(r2, r2, r2) : NUL, M.dv(v, v, M.fmtInt(v)), M.dv(rank, rank, String(rank))]); };
    STAGES.slice(0, -1).forEach((s, i) => {
      const d = REACHED[i] - REACHED[i + 1];
      const [rej, can, prog] = SPLIT[i];
      Object.entries(MIX[i]).forEach(([r, sh]) => SUBS[r].forEach(([sub, s2]) => add(s, i + 1, 'Rejected', r, sub, d * rej * sh * s2)));
      add(s, i + 1, 'Cancelled', null, null, d * can);
      add(s, i + 1, 'In progress', null, null, d * prog);
    });
    add('Disbursed', 10, 'Disbursed', null, null, REACHED[9] - 3460);
    add('Disbursed', 10, 'Cancelled after disbursement', null, null, 3460);
    if (opts.shuffle) data.sort((a, b) => String(a[0].value).localeCompare(String(b[0].value)));
    const encodings = [{ id: 'stage', field: M.field('furthest_stage') }, { id: 'outcome', field: M.field('outcome') }, { id: 'count', field: M.field('CNTD(id)') }];
    if (!opts.noReason) encodings.push({ id: 'reason', field: M.field('reject_reason') }, { id: 'reason', field: M.field('reject_sub_reason') });
    if (!opts.noRank) encodings.push({ id: 'detail', field: M.field('MIN(furthest_rank)') });
    return { columns, types, data, encodings };
  }
  MockTableau.scenario('loans', (M) => loanFlow(M, { shuffle: true }));
  MockTableau.scenario('noRank', (M) => loanFlow(M, { noRank: true }));
  MockTableau.scenario('noReason', (M) => loanFlow(M, { noReason: true }));
  MockTableau.scenario('empty', () => ({ columns: [], data: [], encodings: [] }));
})();
