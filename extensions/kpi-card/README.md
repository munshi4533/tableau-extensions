# KPI Card

A row of KPI cards from a **plain date** and **your measures**. The extension works out last day, MTD and last month itself, so you don't need MTD calculations in Tableau, and calculated KPIs like Average Loan Size stay correct for every period.

## Set up

1. Marks card → **Viz Extensions** → KPI Card.
2. **Date**: a day-level date, e.g. `DAY(Disbursement Date)` or the exact date.
3. **Measures**: your basic measures, e.g. `SUM(Loan Amount)`, `CNT(Loans)`, `SUM(Outstanding Balance)`, `SUM(Target Amount)`. One card each.
4. **Format Extension** (or right-click the cards):
   - **Cards**
     - **Combine days** per measure: *Sum* for amounts and counts, *Latest value* for balances or stock (outstanding, active customers), *Average*, *Highest*, *Lowest*.
     - **+ Calculated KPI**: a formula over the measures, e.g. `[Loan Amount] / [Loans]`. Each part is rolled up for the period first, then the formula runs.
     - Per card: name, color, its own period, *higher / lower is better*, number format (as in Tableau, K / M / Mn / B, %, prefix, suffix) and target.
     - Use ▲ ▼ to change the order and *Hide* to hide input measures.
   - **Big number**: Last day, MTD, Last month, YTD or Total (all dates); compare with previous day / LMTD / previous month (automatic) or the same period last year; viewer buttons; small values for the other periods; target bar; mini trend line.
   - **Chart**: mini trend line, bars per date + running total, bars, line, running total or none (per card in Cards). Dates: all, or the last N months or days. The running total adds up over all dates or restarts each month (MTD) or year (YTD).
   - **Look**: title, cards per row, card style, alignment, text sizes, background.

## How the numbers are calculated

- **Last day** is the latest date in the data that has a value for the cards shown. A target table running into the future doesn't move it.
- **MTD** runs from the 1st of that month to the last day and is compared with **LMTD**, the same days of last month.
- **Last month** is the full previous month, compared with the month before.
- **YTD** runs from 1 January to the last day and is compared with **LYTD**, the same days last year. A fixed monthly target becomes monthly × 12, with a pace marker.
- A comparison is only shown when the data covers the whole comparison period (e.g. LYTD needs data from 1 January last year).
- **Calculated KPI, MTD Average Loan Size:** `sum(Loan Amount, 1st–8th) ÷ sum(Loans, 1st–8th)`, not an average of daily averages.
- **Formula functions:** `SUM(x)` (accepted, has no effect), `ABS`, `MIN`, `MAX`, `ROUND(x, digits)`, `ZN(x)` (empty → 0), `IFNULL(x, y)`, `DAYS()` (days with data in the period, e.g. `[Loan Amount] / DAYS()` = average per day). Dividing by zero shows "–".
- **Targets:**
  - *Fixed monthly number* (`1200 Mn`, `1.2B`, `4500`): for Sum measures, MTD shows progress toward the full month with a marker for where you should be today, and Last day uses the monthly target ÷ days in the month. Balances, averages and ratios are compared with the number as it is.
  - *A measure on the shelf* is rolled up over the same days (MTD target to date).
  - *Formula*: any formula, e.g. `[Target Amount] * 1.1`.
- **Mini trend line** (length set in Format → Big number):
  - Month by month (3–36 months, default 12) is like for like: with MTD, each month covers the same days (1st–8th); with Last month, full months.
  - Day by day shows the last 7–365 days (default 30).
- **Distinct counts** (COUNTD, e.g. unique customers) can't be added across days, because the same customer counts every day. Use *Latest value*, or build the MTD distinct count in Tableau.
- If the date is at **MONTH** level, the periods become *This month* and *Last month*.

## Version history
- **1.3.0**: *Chart* tab. Each card can show a mini trend line, **bars per date + running total** (two scales, like a funnel dashboard), bars, a line or a running total, with date labels, a legend and per-card bar and line colors. The running total can add up over all dates or restart each month or year. Ratios run "to date" (e.g. approved so far ÷ submitted so far). New period **Total (all dates)**. *Periods to offer* chooses which buttons and small values appear.
- **1.2.0**: YTD (year to date) as a big-number period and viewer button, compared with LYTD (same days last year); YTD trend line shows the year building up month by month. Viewer buttons can be hidden (Format → Big number).
- **1.1.1**: The mini trend line fills the space under the numbers (it was capped small); size option Fill / Large / Medium / Small.
- **1.1.0**: Choose how much history the mini trend line shows: months (3–36) and days (7–365), in Format → Big number.
- **1.0.0**: First release.
