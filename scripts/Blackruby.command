#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# ♦ BLACKRUBY — Ein-Klick-Starter
#
# Doppelklick im Finder oder auf dem Desktop.
# Startet alle 13 Bots + Orchestrator + Dashboard automatisch.
# Öffnet den Browser auf http://localhost:5173
# ──────────────────────────────────────────────────────────────────────────────

set -e

# Resolve the repo dir relative to this script — works no matter where the
# .command is double-clicked from (Finder, Desktop alias, anywhere).
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
REPO="$( cd "$SCRIPT_DIR/.." && pwd )"
cd "$REPO"

# Ensure Homebrew + Node are on PATH (GUI apps don't inherit shell PATH)
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

clear
printf '\033[1;35m'
echo '╔══════════════════════════════════════════════════════╗'
echo '║       ♦ BLACKRUBY CROSSLISTING SYSTEM v2.0 ♦       ║'
echo '║   21 Marketplaces • Auto-Crosslist • AI Chat        ║'
echo '╚══════════════════════════════════════════════════════╝'
printf '\033[0m\n'

# ── 1. Node check ─────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  osascript -e 'display dialog "Node.js ist nicht installiert.\n\nhttps://nodejs.org/" buttons {"OK"} with icon stop'
  open "https://nodejs.org/"
  exit 1
fi
printf '  ✅ Node %s\n' "$(node -v)"

# ── 2. Kill alte Prozesse ─────────────────────────────────────────────────────
printf '  🔄 Alte Prozesse beenden...\n'
pkill -f "Vinted/system" 2>/dev/null || true
pkill -f "tsx.*vinted" 2>/dev/null || true
pkill -f "tsx.*orchestrator" 2>/dev/null || true
pkill -f "concurrently" 2>/dev/null || true
sleep 1

for port in $(seq 4700 4718) 5173; do
  pids=$(/usr/sbin/lsof -ti ":$port" 2>/dev/null || true)
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
done
printf '  ✅ Ports 4700-4718 + 5173 frei\n'

# ── 3. TSX IPC Pipe Cache leeren (Node v24 Fix) ──────────────────────────────
rm -rf /var/folders/*/T/tsx-*/ 2>/dev/null || true
printf '  ✅ TSX Cache bereinigt\n'

# ── 4. Dependencies ──────────────────────────────────────────────────────────
if [ ! -d "node_modules" ] || [ "package-lock.json" -nt "node_modules" ]; then
  printf '  📦 npm install...\n'
  npm install --silent
else
  printf '  ✅ Dependencies ok\n'
fi

# ── 5. Playwright ─────────────────────────────────────────────────────────────
CHROMIUM_DIR="$HOME/Library/Caches/ms-playwright"
if [ ! -d "$CHROMIUM_DIR" ] || [ -z "$(ls -A "$CHROMIUM_DIR" 2>/dev/null | grep -i chromium)" ]; then
  printf '  🌐 Playwright Chromium installieren...\n'
  npx playwright install chromium
else
  printf '  ✅ Playwright ok\n'
fi

# ── 6. DB Migration ──────────────────────────────────────────────────────────
printf '  💾 Datenbank-Migration...\n'
npm run db:migrate 2>/dev/null || true

# ── 7. Starten ────────────────────────────────────────────────────────────────
printf '\n'
printf '\033[1;32m'
echo '  ┌──────────────────────────────────────────────────┐'
echo '  │  🚀 Blackruby System startet...                  │'
echo '  │                                                  │'
echo '  │  📡 Orchestrator + 15 Worker      → :4700        │'
echo '  │  👗 Vinted/KA/CJ-Service          → :4701/4703/4720   │'
echo '  │  🖥️  Dashboard                     → :5173        │'
echo '  │                                                  │'
echo '  │  Ctrl+C zum Beenden aller Services               │'
echo '  └──────────────────────────────────────────────────┘'
printf '\033[0m\n'

# Open browser after 8 seconds (give services time to boot)
(sleep 8 && open "http://localhost:5173") &

# npm run dev = All bots + orchestrator + dashboard (no Tauri)
exec npm run dev
