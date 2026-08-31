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
# a fresh user account has no LaunchAgents directory yet
mkdir -p "$HOME/Library/LaunchAgents"
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
# Installed per user in ~/Applications when it isn't there yet: that needs no
# administrator rights (writing to /Applications or using brew does).
HS_APP=""
for candidate in "/Applications/Hammerspoon.app" "$HOME/Applications/Hammerspoon.app"; do
  if [ -d "$candidate" ]; then
    HS_APP="$candidate"
    break
  fi
done
if [ -z "$HS_APP" ]; then
  echo "    Hammerspoon downloaden naar ~/Applications…"
  mkdir -p "$HOME/Applications"
  HS_TMP="$(mktemp -d)"
  HS_TAG="$(curl -s -o /dev/null -w '%{redirect_url}' https://github.com/Hammerspoon/hammerspoon/releases/latest | sed 's#.*/tag/##')"
  if [ -n "$HS_TAG" ] && curl -fsSL -o "$HS_TMP/hs.zip" \
      "https://github.com/Hammerspoon/hammerspoon/releases/download/$HS_TAG/Hammerspoon-$HS_TAG.zip"; then
    if unzip -q "$HS_TMP/hs.zip" -d "$HS_TMP"; then
      rm -rf "$HOME/Applications/Hammerspoon.app"
      mv "$HS_TMP/Hammerspoon.app" "$HOME/Applications/Hammerspoon.app"
      # downloaded apps are quarantined; clearing it keeps Gatekeeper quiet
      xattr -dr com.apple.quarantine "$HOME/Applications/Hammerspoon.app" 2>/dev/null || true
      HS_APP="$HOME/Applications/Hammerspoon.app"
      echo "    ✅ Hammerspoon $HS_TAG geïnstalleerd in ~/Applications"
    fi
  fi
  rm -rf "$HS_TMP"
  if [ -z "$HS_APP" ]; then
    echo "⚠️  Hammerspoon niet geïnstalleerd — download het handmatig van https://www.hammerspoon.org (de rest werkt gewoon)."
  fi
fi
HS_INIT="$HOME/.hammerspoon/init.lua"
mkdir -p "$HOME/.hammerspoon"
if [ ! -f "$HS_INIT" ] || ! grep -qF "school-buddy.lua" "$HS_INIT"; then
  echo "dofile(\"$DEST/hammerspoon/school-buddy.lua\")" >> "$HS_INIT"
fi
if [ -n "$HS_APP" ]; then
  open -a "$HS_APP" || true
fi

echo
echo "✅ Klaar. Volgende stappen:"
echo "  1. Somtoday koppelen:  $DEST/school-buddy setup \"<schoolnaam>\""
echo "  2. Rooster bekijken:   http://127.0.0.1:4823"
echo "  3. Hammerspoon: geef toestemming als macOS erom vraagt."
