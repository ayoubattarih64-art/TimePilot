#!/usr/bin/env bash
# Launch a clean-profile Chromium (headless) with the built extension.
# $1 = browser exe path, $2 = port, $3 = profile dir name
set -u
EXE="$1"; PORT="$2"; PROF="$3"
cd "$(dirname "$0")/.."
rm -rf ".audit/$PROF"
mkdir -p ".audit/$PROF"
DIST=$(cygpath -w "$PWD/dist")
PDIR=$(cygpath -w "$PWD/.audit/$PROF")
nohup "$EXE" \
  --headless=new \
  --remote-debugging-port="$PORT" \
  --user-data-dir="$PDIR" \
  --load-extension="$DIST" \
  --disable-extensions-except="$DIST" \
  --no-first-run --no-default-browser-check --disable-sync \
  --disable-component-update --disable-background-networking \
  --disable-brave-update \
  --enable-logging=stderr --v=0 \
  about:blank \
  > ".audit/$PROF.log" 2>&1 &
echo "pid=$!"
