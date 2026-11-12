#!/bin/zsh
cd -- "${0:A:h}" || exit 1
if ! command -v node >/dev/null 2>&1; then
  print 'Node.js 20以上が必要です。https://nodejs.org/ の公式配布をインストールしてください。'
  read -r '?Enterで閉じる'
  exit 1
fi
node scripts/local.mjs &
quest_local_pid=$!
trap 'kill "$quest_local_pid" 2>/dev/null' EXIT INT TERM
for quest_wait in {1..25}; do
  if /usr/bin/curl --silent --fail --max-time 1 http://127.0.0.1:4174/local-info.json >/dev/null 2>&1; then
    /usr/bin/open -a 'Google Chrome' http://127.0.0.1:4174/
    break
  fi
  if ! kill -0 "$quest_local_pid" 2>/dev/null; then break; fi
  sleep 0.2
done
wait "$quest_local_pid"
