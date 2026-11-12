# Funnel

Conversion funnel as a strip of boxes, e.g. **Started → Submitted → Approved → Disbursed**. Every box shows the stage value and two progresses: **% of start** (vs the first stage) and **% of previous** (vs the stage before it, red / amber / green). Arrows between the boxes show the drop (or the step %). A header shows the overall conversion and the weakest step.

## Set up

1. Marks card → **Viz Extensions** → Funnel.
2. **Stages:** one measure per stage, in funnel order, e.g. `COUNTD(Started App)`, `COUNTD(Submitted App)`, `COUNTD(Approved App)`, `COUNTD(Disbursed App)`. 4 measures = 4 boxes; drag to reorder.
3. **Format Extension** (or right-click):
   - **Stages:** rename (e.g. "Started"), recolor, hide, move up / down.
   - **Boxes:** progress style (two bars side by side, one under the other, or two rings), labels, red / amber / green thresholds for % of previous, values full or short, what the arrows show, layout (row / column / automatic).
   - **Look:** header and title, colors (a color per stage or one color), text sizes and colors, box fill and border, background.

## How it works

- A stage is the measure's total over the rows of the sheet (a dimension on Detail just splits it into rows that are added up). Use distinct counts that make sense as totals for the whole sheet.
- % of start = stage ÷ the first stage shown; % of previous = stage ÷ the stage before it. Hiding a stage changes what "previous" and "start" are.
- Side by side moves the two bars under each other by itself when a box gets narrow; in a tall narrow zone the boxes stack in a column (Layout: automatic).
- Same loading as the other extensions: "Loading…" on the first load, "Updating…" while other sheets filter it, and "No data for the current filters" when a filter leaves nothing.

## Version history
- **1.0.0**: First version: conversion strip (Option D) with side-by-side / stacked / ring progress, drop or step % arrows, header with overall conversion and weakest step.
