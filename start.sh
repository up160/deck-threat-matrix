#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
command -v python3 >/dev/null || { echo 'Install Python 3.11+ first.'; exit 1; }
command -v npm >/dev/null || { echo 'Install Node.js 20.19+ first.'; exit 1; }
if [ ! -d .venv ]; then python3 -m venv .venv; fi
if ! cmp -s requirements.lock .venv/requirements-installed.txt; then
  .venv/bin/python -m pip install -r requirements.lock
  cp requirements.lock .venv/requirements-installed.txt
fi
if ! cmp -s frontend/package-lock.json frontend/node_modules/.dtm-package-lock; then
  (cd frontend && npm ci)
  cp frontend/package-lock.json frontend/node_modules/.dtm-package-lock
fi
(cd frontend && npm run build)
echo 'Deck Threat Matrix: http://127.0.0.1:8765 (Ctrl+C to stop)'
exec .venv/bin/python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8765
