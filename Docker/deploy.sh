#!/usr/bin/env bash
# deploy.sh — run this on the Ubuntu server to update and restart Foundry.
# Can be called from any directory; resolves paths relative to its own location.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"

echo "==> Pulling latest changes..."
cd "$REPO_ROOT"
git pull

echo "==> Installing Node dependencies..."
npm install

echo "==> Compiling SCSS..."
npm run build

echo "==> Restarting FoundryVTT (pulling latest image if available)..."
cd "$SCRIPT_DIR"
docker compose up -d --pull always

echo ""
echo "==> Done. Current status:"
docker compose ps
