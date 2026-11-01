#!/bin/sh
# Serves the whole repo at http://localhost:8765 for Tableau Desktop testing and browser previews.
cd "$(dirname "$0")/.." || exit 1
echo "Serving $(pwd) at http://localhost:8765  (Ctrl+C to stop)"
echo "Landing page: http://localhost:8765/"
python3 -m http.server 8765
