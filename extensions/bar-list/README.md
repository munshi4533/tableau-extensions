# Bar List

Ranked bars for one dimension, e.g. Salary Bucket, Simah Score or Employment, showing **value | % of total**. Features: Top N + Others, several KPIs with switch buttons (including calculated ones), an optional Breakdown and Target, and bars from a thin line to thick, square to fully round.

## Set up

1. Marks card → **Viz Extensions** → Bar List.
2. **Category:** the dimension. You get one bar per value. Add up to 4 dimensions (e.g. Category, then Sub-Category) to drill down.
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
     - Drill-down: levels open at the start, Top N inside an opened bar, % of parent or of total, Expand all / Collapse buttons.
     - Labels: content and position; long names wrap (or cut with …).
     - Bar shape: thickness and corners, plus a fill-up track.
     - Colors.
   - **Look:** title, text sizes and colors, background.
   - **Presets:** apply a saved look in one click; save your own; make one the default for new Bar Lists; copy or paste a style code to share it (send it to have it added as a team preset for everyone).

## How it works

- **% of total:** the share of the bar's value in the total of all bars, before Top N, so "Others" keeps its share. It's shown automatically for counts and sums, and hidden for averages, % measures and calculated ratios (you can turn it on in KPIs).
- **Calculated KPIs** are computed per bar from the measures summed for that bar (and for Others), so Avg Loan for Others is total amount ÷ total customers of those bars.
- **Top N** ranks by the KPI shown. Null / Not Available never takes a Top N place when "last, in grey" is on.
- **Click a bar** to select it in Tableau for dashboard filter or highlight actions. Cmd / Ctrl + click adds more bars; clicking the same bar again, or an empty spot, clears the selection. "Others" selects all bars it contains.
- **Drill-down:** with several dimensions on Category, a bar with sub-bars gets a **+**. Click it (or double-click the bar) to open its sub-bars underneath, indented; **−** closes them. Sub-bars show "value | % of parent". A single click on a sub-bar filters the dashboard on that category + sub-category; on a parent, on the whole category. Parent values are the sum of their sub-bars, which is right for counts and sums; COUNTD and averages don't add up across sub-bars, so use a calculated KPI for ratios (e.g. `[Loan Amount] / [Customers]`).
- **One action for the whole dashboard:** a filter action whose targets include the Bar List itself would normally shrink it to the bar you clicked. Bar List notices that and keeps all bars on screen, with the selected ones in color. Clicking a bar outside the filter first clears your previous click (all charts reset for a moment), then selects the new one.
- **Many bars:** the list scrolls instead of squeezing the bars.

## Version history
- **1.3.4**: A dashboard filter that leaves no rows shows "No data for the current filters" instead of "Could not draw the bars".
- **1.3.3**: Works with one dashboard filter action that targets every sheet (Bar List included). When your own click filters Bar List, it keeps showing all bars with the selected one in color; clicking another bar clears and re-selects automatically; all bars stay even if Tableau reloads the extension.
- **1.3.2**: Clicking on Tableau Server. A click made while the bars are reloading is sent once the reload is done (with up-to-date marks), so fast clicks no longer select the wrong marks or reset the dashboard; the highlight follows Tableau's selection, also after Tableau reloads the extension; no "Updating…" fade right after your own click.
- **1.3.1**: A closed bar's tooltip lists its sub-categories (largest first, value · % of the bar). Long category names wrap onto up to 3 lines and the row grows to fit (Format → Bars → Labels → Long names: wrap, or one line cut with …).
- **1.3.0**: Drill-down. Put Category and Sub-Category (up to 4 levels) on the Category shelf; + or a double-click opens a bar into its sub-bars. Expand all / Collapse buttons, Top N inside an opened bar, % of parent. "Others (1)" no longer appears: that one bar is just shown.
- **1.2.0**: *Presets* tab. Save the current look (bar shape and height, track, colors, labels, text, background) as a named preset and apply it to any Bar List. Pick one as the default for new Bar Lists on this computer. Copy / paste a style code to share a look; team presets are built in.
- **1.1.0**: Bar height in pixels (Thickness → Custom height). Fill-up track = total of all bars: each bar fills its share of the total (e.g. each loan status of all applications). Two-color gradient bars, across the full width or along each bar.
- **1.0.3**: The clicked bar keeps its color with a bold label and the rest turn grey, also on the first click on Tableau Server (no more "Updating…" fade over your own click). "Loading…" placeholder while the dashboard opens.
- **1.0.2**: On Tableau Server, a slow first filter action no longer blanks the bars: they stay visible (faded, with "Updating…") until the new data arrives.
- **1.0.1**: Fixed "Cannot use the same icon for more than one encoding" when adding the extension (Measures and Target shared an icon).
- **1.0.0**: First release.
