# Tableau Extensions

One GitHub repository, many Tableau **Viz Extensions** (Tableau 2024.2+ on Desktop, Server and Cloud), all hosted for free on GitHub Pages.

| Extension | Folder | Manifest |
|---|---|---|
| Smooth Trend | `extensions/smooth-trend/` | `manifests/SmoothTrend.trex` |
| Smart Table | `extensions/smart-table/` | `manifests/SmartTable.trex` |
| Multi Measure Trend | `extensions/multi-trend/` | `manifests/MultiTrend.trex` |
| KPI Card | `extensions/kpi-card/` | `manifests/KpiCard.trex` |

(The live list is on the landing page: `https://<github-user>.github.io/tableau-extensions/`.)

## Folder layout

```
tableau-extensions/                 ← repo root = GitHub Pages site root
├── index.html                      landing page listing every extension      (generated)
├── extensions.json                 list of extensions                         (generated)
├── repo.json                       your GitHub user, repo name, author info   (edit once)
├── manifests/                      .trex files                                (generated)
│   ├── SmoothTrend.trex              → GitHub Pages URL (share these)
│   └── localhost/SmoothTrend.trex    → http://localhost:8765 (Tableau Desktop testing)
├── extensions/
│   └── smooth-trend/               one folder per extension
│       ├── extension.json            name, version, shelves (encodings) → source of the .trex
│       ├── index.html, *.js, *.css   the extension itself
│       ├── icon.png                  70×70 icon shown in Tableau
│       ├── README.md                 how to use this extension
│       └── dev/
│           ├── scenarios.js          sample data for the browser preview
│           └── *-preview.html        browser previews                         (generated)
├── shared/
│   ├── lib/                        d3 + Tableau Extensions API (shared by all extensions)
│   └── dev/mock-tableau.js         fake Tableau API used by the previews
├── templates/viz-extension/        starter used for new extensions
└── tools/
    ├── build.py                    regenerates everything marked (generated)
    ├── new_extension.py            creates a new extension from the template
    └── serve.sh                    local web server on port 8765
```

**Rule of thumb:** edit `extensions/<name>/…` and `repo.json`, then run `python3 tools/build.py`. Never edit generated files by hand.

## Everyday workflow (Mac)

```bash
cd ~/Documents/tableau-extensions
./tools/serve.sh                      # leave this Terminal window open
```

- Landing page: http://localhost:8765/
- Preview any extension with sample data: http://localhost:8765/extensions/smooth-trend/dev/preview.html (switch scenarios and open *Format Extension…* from the toolbar bottom-right)
- In Tableau Desktop: Marks card → mark-type dropdown → **Viz Extensions → Add Extension → Access Local Viz Extensions** → pick a file from `manifests/localhost/`.

After changing code: switch to another sheet and back (or reopen the workbook).
After changing `extension.json` (shelves, name, version): run `python3 tools/build.py`, then remove and re-add the extension in Tableau.

## Add a new extension

```bash
python3 tools/new_extension.py kpi-card "KPI Card"
```

This copies `templates/viz-extension` (a working bar-list example) into `extensions/kpi-card/`, then rebuilds. Then:

1. Define the shelves in `extensions/kpi-card/extension.json` (max **4**; Tableau adds Tooltip and Detail itself; `build.py` checks this).
2. Write the chart in `main.js`; add sample data in `dev/scenarios.js`.
3. `python3 tools/build.py` → test with the preview and `manifests/localhost/KpiCard.trex`.

## Publish on GitHub Pages

1. Set your GitHub username once: `python3 tools/build.py <your-github-username>` (saved in `repo.json`; all `.trex` files and the landing page are updated).
2. Create a **public** repo named `tableau-extensions` on GitHub and push this folder (GitHub Desktop: *File → Add Local Repository*, then *Publish repository*; untick "Keep this code private").
3. On GitHub: **Settings → Pages** → *Deploy from a branch* → `main` / `(root)` → Save.
4. After about a minute, open `https://<your-github-username>.github.io/tableau-extensions/`.
5. Share the `.trex` files from `manifests/` (not `manifests/localhost/`). For Tableau Server/Cloud, an admin adds `https://<your-github-username>.github.io` to the allowed extensions list. One entry covers every extension in this repo.

To release a change: bump `version` in the extension's `extension.json`, run `python3 tools/build.py`, commit and push. GitHub Pages updates within a minute or two.

`Ref/` is local-only reference material (ignored by git, see `.gitignore`).
