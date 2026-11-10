# Bar List

Ranked bars for one dimension, e.g. Salary Bucket, Simah Score or Employment, showing **value | % of total**. Features: Top N + Others, several KPIs with switch buttons (including calculated ones), an optional Breakdown and Target, and bars from a thin line to thick, square to fully round.

## Set up

1. Marks card → **Viz Extensions** → Bar List.
2. **Category:** the dimension. You get one bar per value.
3. **Measures:** one or more KPIs, e.g. `CNT(Customers)`, `SUM(Loan Amount)`. With several, viewers switch between them with buttons.
4. Optional:
   - **Breakdown:** a second dimension that splits each bar into colored segments.
   - **Target:** a target per bar, shown as a marker; bars can fill up to it.
   - Tableau's **Tooltip** and **Detail** tiles add tooltip rows.
5. **Format Extension** (or right-click):
   - **KPIs:** name, number format (as in Tableau, K / M / Mn / B, %, prefix, suffix), % of total, which KPI shows first. **+ Calculated KPI** adds a formula, e.g. `[Loan Amount] / [Customers]`.
   - **Bars:**
     - Sort (high → low, low → high, A → Z, as in Tableau).
     - Top N + "Others"; Null / Not Available last in grey.
     - Labels: content and position.
     - Bar shape: thickness and corners, plus a fill-up track.
     - Colors.
   - **Look:** title, text sizes and colors, background.

## How it works

- **% of total:** the share of the bar's value in the total of all bars, before Top N, so "Others" keeps its share. It's shown automatically for counts and sums, and hidden for averages, % measures and calculated ratios (you can turn it on in KPIs).
- **Calculated KPIs** are computed per bar from the measures summed for that bar (and for Others), so Avg Loan for Others is total amount ÷ total customers of those bars.
- **Top N** ranks by the KPI shown. Null / Not Available never takes a Top N place when "last, in grey" is on.
- **Click a bar** to select it in Tableau for dashboard filter or highlight actions. Cmd / Ctrl + click adds more bars; clicking the same bar again, or an empty spot, clears the selection. "Others" selects all bars it contains.
- **Many bars:** the list scrolls instead of squeezing the bars.

## Version history
- **1.1.0**: Bar height in pixels (Thickness → Custom height). Fill-up track = total of all bars: each bar fills its share of the total (e.g. each loan status of all applications). Two-color gradient bars, across the full width or along each bar.
- **1.0.3**: The clicked bar keeps its color with a bold label and the rest turn grey, also on the first click on Tableau Server (no more "Updating…" fade over your own click). "Loading…" placeholder while the dashboard opens.
- **1.0.2**: On Tableau Server, a slow first filter action no longer blanks the bars: they stay visible (faded, with "Updating…") until the new data arrives.
- **1.0.1**: Fixed "Cannot use the same icon for more than one encoding" when adding the extension (Measures and Target shared an icon).
- **1.0.0**: First release.
