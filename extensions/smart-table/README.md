# Smart Table

A light, fast flat table for large data (built for 20,000+ rows).

- Manifest (GitHub Pages): `manifests/SmartTable.trex`
- Manifest (Tableau Desktop testing): `manifests/localhost/SmartTable.trex`
- Preview with sample data: `extensions/smart-table/dev/preview.html` (scenarios: customers50k, customers200k, small, detail, empty)

## Why it is fast

- **Only the visible rows exist in the page** (virtual scrolling). 200,000 rows scroll at the same speed as 200.
- Data is read once from Tableau into compact columns; sorting, filtering and search run on those columns. They don't rebuild the page.
- No chart library, web fonts or images to download. The page is about 50 KB plus the Tableau library.
- Open the browser console to see the load time split into Tableau, reading and drawing.

In the browser preview, 200,000 rows × 9 columns took about 150 ms to process and draw. Sorting took about 0.2 s and search about 0.2 s. Most of the load time inside Tableau is Tableau sending the data.

## Shelves

| Shelf | Put here |
|---|---|
| **Fields** | every column you want, in order: dimensions and measures |
| **Detail** (Tableau's built-in tile) | fields you don't want to show but need for colors or actions |

## Fast start: first rows only

The table loads only the **first 500 rows** by default, so even very large sheets open quickly. The top bar shows "First 500 of 52,000 rows". Click **Load all 52,000** to fetch the rest.
Sort, filter, search and totals work on the loaded rows. Change the number in **Format Extension → Table → Speed** (100, 500, 1,000, 5,000 or All). When filters from other sheets change the data, the table goes back to the first rows.

## Download

Click the download icon in the top-right corner:
- **Download CSV**: the rows as they are now, with your filters and sort. Numbers and dates are exported as plain values, so Excel can calculate with them. Arabic text keeps its encoding.
- **Download CSV – all rows**: loads every row first, then downloads with your filters and sort.
- **Copy to clipboard**: paste straight into Excel.

## In the table

- **Sort:** click a header (▲ ▼ then off), or use the header's funnel menu.
- **Filter any column:** hover a header and click the funnel. Text columns get a searchable tick list with counts. Number and date columns get From/To. The number of active filters shows top-right; click it to clear them all.
- **Search:** searches every column.
- **Resize columns:** drag a header edge. In authoring mode the widths are saved with the workbook.
- **Select rows:** click a row, Ctrl/⌘-click to add rows, Shift-click to select a range, Esc to clear.

## Actions

- **Table → other sheets:** selected rows are selected in Tableau, so dashboard Filter, Highlight and Go to URL actions from this sheet work. Add Detail fields if the action needs fields that aren't columns.
- **Other sheets → table:** filter actions and dashboard filters reload the table. Your sort and column filters are kept.

## Format Extension

**Table tab:** title and title size, row count and search bar; row height; font size; header text that wraps over 1, 2, 3 or all lines; header height (or drag the header's bottom edge, double-click to reset); stretch columns to fill the width; lines; striped rows; row numbers; freeze the first 1–4 columns; totals row (sum or average, and % columns are always averaged); header colors; selection color; background (white, transparent or custom); whether clicking rows selects in Tableau.

**Conditional colors tab:** add as many rules as you like. Each rule colors one column, based on that column or any other column (including Detail fields).

| Style | What it does |
|---|---|
| Color scale | low → (middle) → high colors on the background or the text; the middle can be 0 |
| If … then color | `>`, `≥`, `<`, `≤`, equals, not equal, between, contains, is empty, is not empty; then fill, text color and bold, for the cell or **the whole row** |
| Data bar | a bar inside the cell, sized by the value |
| Up / down arrows | ▲ green / ▼ red by sign, flipped when lower is better |

**Columns tab:** rename headers, choose alignment, hide columns.

## Version history
- **1.2.1**: visible grip in the middle of the header's bottom edge for dragging it taller.
- **1.2.0**: long column names wrap instead of being cut (up to 3 lines by default); taller header by dragging its bottom edge or setting a height; title size option (default 16); columns stretch to fill the width.
- **1.1.0**: loads the first 500 rows by default (setting) with a *Load all* button; download icon in the top-right (CSV of loaded or all rows, or copy to clipboard).
- **1.0.0**: first release.
