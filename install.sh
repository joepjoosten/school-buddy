#!/bin/bash
# School Buddy installer — run on the student's Mac after `git clone`.
# Installs dependencies (Homebrew, Bun, Hammerspoon), builds the web app,
# bootstraps the launchd agent, and wires up the Hammerspoon config.
set -euo pipefail

REPO="$(cd "$(dirname "$0")" && pwd)"
PLIST_LABEL="nl.schoolbuddy.daemon"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

echo "==> School Buddy install ($REPO)"

if ! command -v brew >/dev/null; then
  echo "Homebrew ontbreekt. Installeer eerst: https://brew.sh"
  exit 1
fi

command -v bun >/dev/null || brew install oven-sh/bun/bun
[ -d "/Applications/Hammerspoon.app" ] || brew install --cask hammerspoon

echo "==> bun install + web build"
(cd "$REPO" && bun install)
(cd "$REPO/apps/web" && bun run build)

echo "==> data dir"
mkdir -p "$HOME/.school-buddy"

echo "==> launchd agent"
BUN_BIN="$(command -v bun)"
sed -e "s|__BUN__|$BUN_BIN|g" \
    -e "s|__REPO__|$REPO|g" \
    -e "s|__HOME__|$HOME|g" \
  "$REPO/launchd/$PLIST_LABEL.plist" > "$PLIST_DEST"
launchctl bootout "gui/$UID/$PLIST_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$PLIST_DEST"

echo "==> hammerspoon config"
HS_INIT="$HOME/.hammerspoon/init.lua"
mkdir -p "$HOME/.hammerspoon"
LINE="dofile(\"$REPO/hammerspoon/school-buddy.lua\")"
if [ ! -f "$HS_INIT" ] || ! grep -qF "school-buddy.lua" "$HS_INIT"; then
  echo "$LINE" >> "$HS_INIT"
fi
open -a Hammerspoon || true

echo
echo "✅ Klaar. Volgende stappen:"
echo "  1. Somtoday koppelen:  cd apps/daemon && bun run setup \"<schoolnaam>\""
echo "  2. Rooster bekijken:   http://127.0.0.1:4823"
echo "  3. Hammerspoon: geef toestemming als macOS erom vraagt (Accessibility)."
