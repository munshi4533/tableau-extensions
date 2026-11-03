# Smooth Trend

Smooth line trend with a KPI header, growth/degrowth coloring and smart tooltips.

- Manifest (GitHub Pages): `manifests/SmoothTrend.trex`
- Manifest (Tableau Desktop testing): `manifests/localhost/SmoothTrend.trex`
- Preview with sample data: `extensions/smooth-trend/dev/preview.html` (scenarios: single, down, multi, daily, monthraw, kpi, ordinal, empty)

## Shelves

| Shelf | Put here | Required |
|---|---|---|
| **Date** | a date (continuous `MONTH(Date)` works best; `DAY(Date)` for a true MTD) or a discrete period | yes |
| **Value** | the measure to trend | yes |
| **Series** | a dimension to split into several lines (max 8; the rest become "Other") | no |
| **KPI** | your own calculation for the header number; a 2nd measure becomes the comparison | no |
| **Tooltip** (Tableau's built-in tile) | extra fields for the smart tooltip | no |

## Format Extension options

**1. Headline number** (top right of the header)

| Show | Meaning |
|---|---|
| Automatic | KPI shelf if you used it, otherwise Latest period |
| Latest period (max date) | value at the last date in the data |
| Previous period | the period before it (when the current month is incomplete) |
| MTD / QTD / YTD | adds up periods from the start of the month / quarter / year of the max date |
| Total / Average | across every period in the chart |
| My calculation (KPI shelf) | your calculated field at the latest date |

**Compare with**: previous period (for MTD: the same days last month), same period last year, first period, peak, or nothing. Only options that make sense for your choice can be picked.
**Combine periods by**: Sum, or Average (used automatically for % measures). **Short numbers**: 1.2M style.

**2. Dates**: *Date level* rolls the data up to Day / Week / Month / Quarter / Year (use Month if your data is monthly but the pill sends daily dates). *Date labels*: Automatic (follows the level, e.g. Jan 2025), as formatted in Tableau, or a fixed format (Jan 2025, January 2025, 2025-01, 01/2025, 15 Jan 2025, Q1 2025, 2025). Axis ticks always land on real periods.

**3. Header**: show/hide, title, icon, subtitle (date range, or "Data as of" the max date).
**4. Growth & degrowth**: *Higher is better* (untick for cost/churn), color the line by growth, good/bad colors.
**5. Line**: curve, width, color, area, value labels (none, high & low, high/low & latest, or all values, placed without overlapping; short or Tableau number format), all points, gridlines (off by default), background (transparent by default, white or a custom color), Y from zero, animation.
**6. Tooltip**: Smart (value + ▲/▼ vs previous), Tableau's own, or off.

Click a point to select it in Tableau (drives dashboard actions). Ctrl/Cmd-click adds to the selection.

## Version history
- **1.7.1**: Automatic value axis fits the data more often (e.g. −2.7M…−3.8M no longer starts at zero); "All values" labels keep one label per horizontal slot, so dense daily data stays readable.
- **1.7.0**: better negative values. *Value axis*: Automatic (starts at zero unless that squashes the line, e.g. −3.8M…−3.6M), Always zero, or Fit to data; the area fills down to the bottom edge. *Growth means*: Automatic / value goes up / size grows (ignore the minus sign; automatic when every value is negative), so a growing overdraft shows ▲ and, with Higher is better ticked, in red.
- **1.6.0**: right-click the chart to open Format Extension (when editing).
- **1.5.0**: *Text sizes* section in Format: title, headline number, value labels, date axis, value axis, legend & subtitle.
- **1.4.0**: *Value labels* option: none, high & low, high/low & latest, or **all values**. Labels never overlap; when there is no room a label flips to the other side of the line or is skipped. Short (2.4M) or Tableau number format.
- **1.3.0**: transparent background by default (Tableau's sheet/dashboard color shows through); Background option: Transparent / White / Custom color.
- **1.2.1**: gridlines removed by default; new *Gridlines* option in Format → Line.
- **1.2.0+repo**: moved to extensions/smooth-trend in the multi-extension repo (no functional change).
- **1.2.0**: Dates section: date level roll-up (day/week/month/quarter/year), date label formats; monthly data now labelled "Jan 2025" instead of full dates; axis ticks only on real periods.
- **1.1.1**: fix "Error parsing extension manifest": Tableau allows max 4 custom shelves, so the custom Tooltip shelf was removed; the built-in Tooltip tile is used instead.
- **1.1.0**: Format Extension dialog (replaces the gear panel); headline number options (latest, previous, MTD, QTD, YTD, total, average, KPI shelf); comparisons (previous, same period last year, first, peak); "Data as of" subtitle; help text on every shelf.
- **1.0.0**: first release.
