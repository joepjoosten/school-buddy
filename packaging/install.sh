#!/bin/bash
# School Buddy installer — ships inside the release tarball from GitHub.
# Installs the compiled daemon + web app under ~/.school-buddy/app, bootstraps
# the launchd agent, and wires up Hammerspoon. No Bun/Node needed.
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)"
DEST="$HOME/.school-buddy/app"
PLIST_LABEL="nl.schoolbuddy.daemon"
PLIST_DEST="$HOME/Library/LaunchAgents/$PLIST_LABEL.plist"

echo "==> School Buddy installeren naar $DEST"
mkdir -p "$DEST" "$HOME/.school-buddy"
rm -rf "$DEST/web" "$DEST/hammerspoon"
# unlink first: a running daemon keeps its (unlinked) inode instead of crashing
rm -f "$DEST/school-buddy"
cp "$SRC/school-buddy" "$DEST/school-buddy"
cp -R "$SRC/web" "$DEST/web"
cp -R "$SRC/hammerspoon" "$DEST/hammerspoon"
chmod +x "$DEST/school-buddy"
# Downloads via a browser get quarantined; clear it so Gatekeeper stays quiet.
xattr -d com.apple.quarantine "$DEST/school-buddy" 2>/dev/null || true

echo "==> launchd agent"
cat > "$PLIST_DEST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$PLIST_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$DEST/school-buddy</string>
    <string>daemon</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>SCHOOL_BUDDY_WEB_DIR</key>
    <string>$DEST/web</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$HOME/.school-buddy/daemon.log</string>
  <key>StandardErrorPath</key>
  <string>$HOME/.school-buddy/daemon.log</string>
</dict>
</plist>
PLIST
launchctl bootout "gui/$UID/$PLIST_LABEL" 2>/dev/null || true
sleep 1
# bootstrap can transiently fail right after a bootout — retry a few times
for attempt in 1 2 3; do
  if launchctl bootstrap "gui/$UID" "$PLIST_DEST" 2>/dev/null; then break; fi
  [ "$attempt" = 3 ] && { echo "❌ launchd bootstrap mislukt"; exit 1; }
  sleep 2
done
# verify the daemon actually came up
for _ in 1 2 3 4 5 6 7 8 9 10; do
  if curl -s -o /dev/null "http://127.0.0.1:4823/api/health"; then
    echo "✅ daemon draait"
    break
  fi
  sleep 1
done
curl -s -o /dev/null "http://127.0.0.1:4823/api/health" \
  || echo "⚠️  daemon reageert nog niet — check: $DEST/school-buddy logs"

echo "==> somtoday:// callback-app"
# Built on this machine (osacompile) so Gatekeeper stays out of the way; it
# catches the OAuth redirect and completes the Somtoday koppeling automatically.
mkdir -p "$HOME/Applications"
CB_APP="$HOME/Applications/SomtodayCallback.app"
rm -rf "$CB_APP"
osacompile -o "$CB_APP" "$SRC/somtoday-callback.applescript"
CB_PLIST="$CB_APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string nl.schoolbuddy.callback" "$CB_PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier nl.schoolbuddy.callback" "$CB_PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes array" "$CB_PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0 dict" "$CB_PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLName string nl.schoolbuddy.callback" "$CB_PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes array" "$CB_PLIST"
/usr/libexec/PlistBuddy -c "Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string somtoday" "$CB_PLIST"
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$CB_APP"

echo "==> Hammerspoon"
if [ ! -d "/Applications/Hammerspoon.app" ]; then
  if command -v brew >/dev/null; then
    brew install --cask hammerspoon
  else
    echo "⚠️  Hammerspoon ontbreekt. Download het van https://www.hammerspoon.org en run dit script opnieuw."
  fi
fi
HS_INIT="$HOME/.hammerspoon/init.lua"
mkdir -p "$HOME/.hammerspoon"
if [ ! -f "$HS_INIT" ] || ! grep -qF "school-buddy.lua" "$HS_INIT"; then
  echo "dofile(\"$DEST/hammerspoon/school-buddy.lua\")" >> "$HS_INIT"
fi
[ -d "/Applications/Hammerspoon.app" ] && open -a Hammerspoon || true

echo
echo "✅ Klaar. Volgende stappen:"
echo "  1. Somtoday koppelen:  $DEST/school-buddy setup \"<schoolnaam>\""
echo "  2. Rooster bekijken:   http://127.0.0.1:4823"
echo "  3. Hammerspoon: geef toestemming als macOS erom vraagt."
