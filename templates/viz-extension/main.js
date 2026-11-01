/* __NAME__ – starter Viz Extension.
 * 1. Reads the fields on your custom shelves (extension.json "encodings")
 * 2. Reads the sheet's summary data
 * 3. Draws a simple bar list with d3. Replace render() with your own chart.
 */
/* global d3, tableau */
'use strict';

(function () {
  let worksheet;
  let rows = [];
  let enc = {};

  async function init () {
    await tableau.extensions.initializeAsync();
    worksheet = tableau.extensions.worksheetContent.worksheet;
    worksheet.addEventListener(tableau.TableauEventType.SummaryDataChanged, refresh);
    new ResizeObserver(() => render()).observe(document.body);
    refresh();
  }

  async function refresh () {
    const spec = await worksheet.getVisualSpecificationAsync();
    enc = {};
    if (spec.activeMarksSpecificationIndex >= 0) {
      for (const e of spec.marksSpecifications[spec.activeMarksSpecificationIndex].encodings) {
        (enc[e.id] = enc[e.id] || []).push(e.field);
      }
    }
    const reader = await worksheet.getSummaryDataReaderAsync(undefined, { ignoreSelection: true });
    rows = [];
    for (let p = 0; p < reader.pageCount; p++) {
      const page = await reader.getPageAsync(p);
      page.data.forEach((r) => {
        const row = {};
        page.columns.forEach((c) => { row[c.fieldName] = r[c.index]; });
        rows.push(row);
      });
    }
    await reader.releaseAsync();
    render();
  }

  function render () {
    const chart = document.getElementById('chart');
    const empty = document.getElementById('empty');
    chart.innerHTML = '';
    const cat = enc.category && enc.category[0];
    const val = enc.value && enc.value[0];
    if (!cat || !val) { empty.hidden = false; empty.textContent = 'Drag a dimension to Category and a measure to Value.'; return; }
    empty.hidden = true;

    const data = rows.map((r) => ({
      label: r[cat.name].formattedValue,
      value: Number(r[val.name].nativeValue) || 0,
      text: r[val.name].formattedValue
    })).sort((a, b) => b.value - a.value);

    const W = chart.clientWidth - 24;
    const H = chart.clientHeight - 24;
    const labelW = 110;
    const x = d3.scaleLinear().domain([0, d3.max(data, (d) => d.value) || 1]).range([0, W - labelW - 70]);
    const y = d3.scaleBand().domain(data.map((d) => d.label)).range([0, H]).padding(0.25);
    const svg = d3.select(chart).append('svg').attr('width', W).attr('height', H);
    const g = svg.selectAll('g').data(data).join('g').attr('transform', (d) => `translate(0,${y(d.label)})`);
    g.append('text').attr('class', 'bar-label').attr('x', labelW - 8).attr('y', y.bandwidth() / 2).attr('dy', '0.32em').attr('text-anchor', 'end').text((d) => d.label);
    g.append('rect').attr('x', labelW).attr('height', y.bandwidth()).attr('width', (d) => Math.max(1, x(d.value))).attr('rx', 3).attr('fill', '#2a78d6');
    g.append('text').attr('class', 'bar-value').attr('x', (d) => labelW + x(d.value) + 6).attr('y', y.bandwidth() / 2).attr('dy', '0.32em').text((d) => d.text);
  }

  init().catch((e) => { document.getElementById('empty').hidden = false; document.getElementById('empty').textContent = 'Error: ' + e.message; });
})();
