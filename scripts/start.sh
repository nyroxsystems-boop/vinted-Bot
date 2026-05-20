#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# Blackruby Quick Start — Open Terminal, paste this command:
#
#   bash /Users/home/Desktop/Vinted/system/scripts/start.sh
#
# Or double-click Vinted-System.command in Finder.
# ──────────────────────────────────────────────────────────────────────────────

set -e
cd /Users/home/Desktop/Vinted/system

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

echo ""
echo "═══════════════════════════════════════════════════"
echo "  Blackruby Crosslisting System v2.0"
echo "  21 Marketplaces • Auto-Crosslist • AI Chat"  
echo "═══════════════════════════════════════════════════"
echo ""

# Check Node
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Node.js nicht installiert! → https://nodejs.org/"
  exit 1
fi
echo "✅ Node $(node -v)"

# Check deps
if [ ! -d "node_modules" ]; then
  echo "📦 Dependencies installieren..."
  npm install
fi
echo "✅ Dependencies ok"

# Free ports
echo "🔌 Ports freigeben..."
for port in 4700 4701 4702 4703 4704 4705 4706 4707 4708 4709 4710 4711 4712 4713 5173; do
  pids=$(/usr/sbin/lsof -ti ":$port" 2>/dev/null || true)
  [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
done

# Clean tsx pipes (Node v24 EPERM fix)
rm -rf /var/folders/*/T/tsx-*/ 2>/dev/null || true

echo ""
echo "🚀 Starte System..."
echo ""
echo "  📡 Orchestrator + 12 Worker   → :4700"
echo "  👗 Vinted Bot                 → :4701"  
echo "  📦 Temu Bot                   → :4702"
echo "  🏪 + 9 weitere Bots           → :4703-4713"
echo "  🌍 EU Champions               → :4714-4718 (via Orchestrator)"
echo "  🖥️  Dashboard                  → http://localhost:5173"
echo ""

# Start with npm run dev (concurrently)
exec npm run dev
