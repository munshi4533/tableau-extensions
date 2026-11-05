# Multi Measure Trend

Several measures on one chart, without dual-axis tricks. Each measure can be a **solid, dashed or dotted line**, an **area** or **bars**, with its own color and a left or right axis. The tooltip shows every measure at the hovered period.

- Manifest (GitHub Pages): `manifests/MultiTrend.trex`
- Manifest (Tableau Desktop testing): `manifests/localhost/MultiTrend.trex`
- Preview with sample data: `extensions/multi-trend/dev/preview.html` (scenarios: loans, mixed, empty)

## Shelves

| Shelf | Put here |
|---|---|
| **Date** | a date or period: `DAY(Date)`, `MONTH(Date)`, a discrete period… |
| **Measures** | up to 10 measures or calculations (e.g. *Disbursed MTD*, *Last Month*, *Last 3 Months*). Each one becomes its own line, area or bars. |
| **Tooltip / Detail** (Tableau's tiles) | extra fields shown at the bottom of the tooltip |

A measure that is empty for some periods simply stops. For example, an MTD line ends at today.

## Format Extension (or right-click the chart)

**Measures tab:** one card per measure:
- color, display name, hide
- show as **Line / Area / Bars**
- **Line style:** solid ——, dashed – – –, dotted · · ·; width; curve (straight, smooth, step)
- **Axis:** left, or right for a different scale such as a %
- value labels (none, latest, high & low, all; they never overlap); points

**Chart tab:** title (automatic "A vs B"), date-range subtitle, legend (top, bottom, none) with each measure's latest value; value axis (automatic, from zero, fit); date label format; left and right axis titles; gridlines; tooltip (smart, Tableau's own, or off) comparing each value with **the previous period** or with **the first measure**; higher is better; text sizes; background.

In the chart: hover for the tooltip; click a period to select it in Tableau (for dashboard actions); click a legend item to hide or show that measure.

## Version history
- **1.0.1**: More reliable on Tableau Server and dashboards: data loads one at a time when filters or parameters change quickly (it sometimes failed to draw before), retries once, keeps the last good chart instead of going blank, redraws when a hidden sheet appears. A % measure next to a currency measure now starts on the right axis.
- **1.0.0**: first release.
