# Stage Flow

Where applications go, stage by stage: a flow through ordered stages (e.g. Responsible lending → … → Disbursed). The band is the applications that **reached** each stage; what **ended** at a stage peels off as a leak, split by outcome (Rejected / Cancelled / In progress), with the reasons on hover. After the last stage the flow splits into the success outcome (e.g. Disbursed, kept) and the rest (e.g. Cancelled after disbursement).

## Data: one row per application

| id | furthest_stage | furthest_rank | outcome | reject_reason | reject_sub_reason |
|---|---|---|---|---|---|

- **furthest_stage / furthest_rank:** the furthest stage the application reached (repeats and loops do not matter).
- **outcome:** from the latest status, e.g. Disbursed, Cancelled after disbursement, Cancelled, Rejected, In progress.
- The SQL for D360 loan applications (ods.loan_application_aud + ods.loan_application + enriched.loan_application) is in the project notes.

## Set up

1. Marks card → **Viz Extensions** → Stage Flow.
2. **Stage:** furthest_stage. **Outcome:** outcome. **Count:** COUNTD(id). **Reason** (optional): reject_reason, then reject_sub_reason.
3. **Order of the stages:** put `MIN(furthest_rank)` on **Detail** (or set the order in Format Extension → Stages).
4. **Format Extension:**
   - **Stages:** rename (e.g. "Started"), hide (its applications count at the stage before it), move ▲ ▼.
   - **Outcomes:** which outcome means success (automatic: Disbursed / Success / Completed …), names and colors.
   - **Look:** left to right or top to bottom, main flow large or medium, leaks angled or curved, band sizes true or readable, numbers full or short, flow color, % of previous on the band, legend, header (first → last, last and kept, biggest drop), text sizes, background.

## How it works

- Reached a stage = applications whose furthest stage is that stage or later. Ended at a stage = furthest stage is that stage (for the last stage: every outcome except success).
- Do not put the application id on the Marks card: COUNTD(id) keeps the data to a few dozen rows (stages × outcomes × reasons), fast on Server.
- **Click** a stage (everything that reached it), a leak, or one outcome in a leak to filter the dashboard; works with one dashboard-wide filter action that targets every sheet (the flow stays whole). Cmd / Ctrl + click adds, an empty spot clears.
- Same loading as the other extensions: "Loading…" first, "Updating…" while filters apply, "No data for the current filters".

## Version history
- **1.1.0**: Bigger main flow (wider stage bars, more height for the band; Look → Main flow: Large / Medium). Leaks drop straight down with square corners (Look → Leaks: Angled / Curved).
- **1.0.0**: First version: flow with leaks (left to right / top to bottom), outcomes and reasons on hover, kept vs after the last stage, click to filter.
