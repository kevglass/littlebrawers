#!/usr/bin/env bash
# Builds the game locally and uploads it to littlebrawlers.com via rsync.
#
# Requirements (local):
#   - Node.js + npm
#   - rsync, ssh
#   - SSH key access to kevglass@cokeandcode.com (or be prepared to type your password)
#
# Requirements (server):
#   - Apache (or nginx) with PHP ≥ 8.0 enabled
#   - The web root for littlebrawlers.com pointed at ~/littlebrawlers.com
#   - The PHP process must have write access to data/rooms/ and data/maps/
#     (on most cPanel/Plesk setups the PHP user matches the SSH user, so chmod 755 is
#     sufficient; on Apache + www-data you may need: sudo chown -R www-data data/)
#
set -euo pipefail

REMOTE_USER="kevglass"
REMOTE_HOST="cokeandcode.com"
REMOTE_DIR="littlebrawlers.com"
REMOTE="${REMOTE_USER}@${REMOTE_HOST}"

# ─── Colour helpers ────────────────────────────────────────────────────────────
BOLD=""; RESET=""; GREEN=""; CYAN=""; RED=""
if [ -t 1 ]; then
  BOLD=$(tput bold); RESET=$(tput sgr0)
  GREEN=$(tput setaf 2); CYAN=$(tput setaf 6); RED=$(tput setaf 1)
fi
step() { echo "${BOLD}${CYAN}▸ $*${RESET}"; }
ok()   { echo "${GREEN}✔  $*${RESET}"; }
fail() { echo "${RED}✖  $*${RESET}" >&2; exit 1; }

# ─── Sanity checks ─────────────────────────────────────────────────────────────
command -v rsync >/dev/null || fail "rsync not found"
command -v ssh   >/dev/null || fail "ssh not found"
command -v npm   >/dev/null || fail "npm not found"

cd "$(dirname "$0")"

# ─── 1. Build ──────────────────────────────────────────────────────────────────
step "Building shared types..."
npm run build -w packages/shared

step "Building client (production)..."
VITE_SIGNAL_BASE_URL="" npm run build -w packages/client

step "Building editor (production, base=/editor/)..."
VITE_SIGNAL_BASE_URL="" VITE_BASE="/editor/" npm run build -w packages/editor

ok "Build complete"

# ─── 2. Ensure remote directory structure exists ───────────────────────────────
step "Preparing remote directory structure..."
ssh "${REMOTE}" "
  set -e
  mkdir -p ${REMOTE_DIR}/editor
  mkdir -p ${REMOTE_DIR}/api/maps
  mkdir -p ${REMOTE_DIR}/lib
  mkdir -p ${REMOTE_DIR}/data/rooms
  mkdir -p ${REMOTE_DIR}/data/maps
  chmod 775 ${REMOTE_DIR}/data ${REMOTE_DIR}/data/rooms ${REMOTE_DIR}/data/maps
"

# ─── 3. Upload game client (static files) ─────────────────────────────────────
step "Uploading game client..."
rsync -azP --delete \
  packages/client/dist/ \
  "${REMOTE}:${REMOTE_DIR}/"

# ─── 4. Upload level editor ───────────────────────────────────────────────────
step "Uploading level editor..."
rsync -azP --delete \
  packages/editor/dist/ \
  "${REMOTE}:${REMOTE_DIR}/editor/"

# ─── 5. Upload PHP API files ──────────────────────────────────────────────────
step "Uploading PHP API..."
rsync -azP --delete \
  server/api/ \
  "${REMOTE}:${REMOTE_DIR}/api/"

# ─── 6. Upload PHP lib ────────────────────────────────────────────────────────
step "Uploading PHP lib..."
rsync -azP --delete \
  server/lib/ \
  "${REMOTE}:${REMOTE_DIR}/lib/"

# ─── 7. Upload data directory structure only (never overwrite saved data) ─────
step "Syncing data directory structure (preserving existing maps/rooms)..."
rsync -azP \
  --exclude="rooms/*.json" \
  --exclude="maps/*.json" \
  server/data/ \
  "${REMOTE}:${REMOTE_DIR}/data/"

ok "Deployed → https://littlebrawlers.com"
echo
echo "  Game:   https://littlebrawlers.com/"
echo "  Editor: https://littlebrawlers.com/editor/"
