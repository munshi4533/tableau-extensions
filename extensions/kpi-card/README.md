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
   - **Big number**: Last day, MTD or Last month; compare with previous day / LMTD / previous month (automatic) or the same period last year; viewer buttons; small values for the other periods; target bar; mini trend line.
   - **Look**: title, cards per row, card style, alignment, text sizes, background.

## How the numbers are calculated

- **Last day** is the latest date in the data that has a value for the cards shown. A target table running into the future doesn't move it.
- **MTD** runs from the 1st of that month to the last day and is compared with **LMTD**, the same days of last month.
- **Last month** is the full previous month, compared with the month before.
- **Calculated KPI, MTD Average Loan Size:** `sum(Loan Amount, 1st–8th) ÷ sum(Loans, 1st–8th)`, not an average of daily averages.
- **Formula functions:** `SUM(x)` (accepted, has no effect), `ABS`, `MIN`, `MAX`, `ROUND(x, digits)`, `ZN(x)` (empty → 0), `IFNULL(x, y)`, `DAYS()` (days with data in the period, e.g. `[Loan Amount] / DAYS()` = average per day). Dividing by zero shows "–".
- **Targets:**
  - *Fixed monthly number* (`1200 Mn`, `1.2B`, `4500`): for Sum measures, MTD shows progress toward the full month with a marker for where you should be today, and Last day uses the monthly target ÷ days in the month. Balances, averages and ratios are compared with the number as it is.
  - *A measure on the shelf* is rolled up over the same days (MTD target to date).
  - *Formula*: any formula, e.g. `[Target Amount] * 1.1`.
- **Mini trend line:**
  - Month by month (12 months) is like for like: with MTD, each month covers the same days (1st–8th); with Last month, full months.
  - Day by day shows the last 30 days.
- **Distinct counts** (COUNTD, e.g. unique customers) can't be added across days, because the same customer counts every day. Use *Latest value*, or build the MTD distinct count in Tableau.
- If the date is at **MONTH** level, the periods become *This month* and *Last month*.

## Version history
- **1.0.0**: First release.
