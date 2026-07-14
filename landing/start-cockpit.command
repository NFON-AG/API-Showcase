#!/bin/zsh
set -e

SCRIPT_DIR="${0:A:h}"
cd "$SCRIPT_DIR"

export LANDING_HOST="${LANDING_HOST:-127.0.0.1}"
export LANDING_ENABLE_SERVICE_CONTROL="${LANDING_ENABLE_SERVICE_CONTROL:-true}"
export PORT="${PORT:-3010}"
export CTI_UPSTREAM="${CTI_UPSTREAM:-http://127.0.0.1:3002}"
export PORTAL_UPSTREAM="${PORTAL_UPSTREAM:-http://127.0.0.1:3001}"
export CORE_HISTORY_UPSTREAM="${CORE_HISTORY_UPSTREAM:-${CALL_HISTORY_UPSTREAM:-http://127.0.0.1:3000}}"

# Start the three showcase APIs automatically after the cockpit is up. Set to
# false to only launch the cockpit and start each API by hand from the UI.
AUTOSTART_APIS="${LANDING_AUTOSTART_APIS:-true}"

BASE="http://$LANDING_HOST:$PORT"

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 20+ wird benoetigt. Bitte Node installieren und das Script erneut starten."
  read -r "?Enter zum Schliessen..."
  exit 1
fi

# Start every showcase API through the cockpit control API so the cockpit keeps
# ownership (and can stop them again). Reads the CSRF token from /api/status.
start_all_apis() {
  if [ "$AUTOSTART_APIS" != "true" ]; then
    return 0
  fi
  local token
  token="$(curl -fsS "$BASE/api/status" 2>/dev/null \
    | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{process.stdout.write(JSON.parse(d).csrfToken||'')}catch{process.stdout.write('')}})")"
  if [ -z "$token" ]; then
    echo "Hinweis: APIs konnten nicht automatisch gestartet werden (kein CSRF-Token). Start ueber das Cockpit moeglich."
    return 0
  fi
  for svc in cti portal core-history; do
    curl -fsS -X POST -H "X-CSRF-Token: $token" "$BASE/api/services/$svc/start" >/dev/null 2>&1 || true
  done
  echo "NFON CTI API, NFON Portal API und NFON Call History API werden gestartet."
}

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "NFON API Cockpit laeuft bereits auf $BASE/combined/"
  start_all_apis
  open "$BASE/combined/" >/dev/null 2>&1 || true
  exit 0
fi

echo "Starte NFON API Cockpit auf $BASE/combined/"
echo "NFON CTI API, NFON Portal API und NFON Call History API koennen auch einzeln im Cockpit gesteuert werden."
npm start &
SERVER_PID=$!

for _ in {1..40}; do
  if curl -fsS "$BASE/api/status" >/dev/null 2>&1; then
    start_all_apis
    open "$BASE/combined/" >/dev/null 2>&1 || true
    wait "$SERVER_PID"
    exit $?
  fi
  sleep 0.25
done

echo "Serverstart dauert laenger als erwartet. Terminal offen lassen und im Browser neu laden:"
echo "$BASE/combined/"
wait "$SERVER_PID"
