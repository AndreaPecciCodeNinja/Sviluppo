#!/bin/bash
# Avvia assistenza (3020), sincronia (3021) e macchina (3022) in background.
# Da macOS, nella cartella del repository: ./avvia-demo.sh

set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
STATO="$ROOT/.demo"
mkdir -p "$STATO"

if ! command -v node >/dev/null 2>&1; then
  echo "Node non è nel PATH. Installalo e rilancia ./avvia-demo.sh da ~/Documents/Sviluppo." >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  echo "curl non è disponibile." >&2
  exit 1
fi

in_ascolto() {
  curl -fsS --max-time 1 "http://127.0.0.1:$1/" >/dev/null 2>&1
}

attendi() {
  porta="$1"
  nome="$2"
  tentativo=0
  while [ "$tentativo" -lt 40 ]; do
    if in_ascolto "$porta"; then
      return 0
    fi
    tentativo=$((tentativo + 1))
    sleep 0.25
  done
  echo "$nome non risponde sulla porta $porta. Ultime righe del log:" >&2
  if [ -f "$STATO/$3.log" ]; then
    tail -n 20 "$STATO/$3.log" >&2
  fi
  return 1
}

avvia() {
  nome="$1"
  porta="$2"
  script="$3"
  if in_ascolto "$porta"; then
    echo "$nome è già in ascolto su http://127.0.0.1:$porta/"
    return 0
  fi
  : > "$STATO/$nome.log"
  nohup node "$ROOT/$script" >>"$STATO/$nome.log" 2>&1 &
  echo $! > "$STATO/$nome.pid"
  if ! attendi "$porta" "$nome" "$nome"; then
    return 1
  fi
  echo "$nome su http://127.0.0.1:$porta/"
}

cd "$ROOT"
avvia "assistenza" 3020 "demo-assistenza/server.mjs" || exit 1
avvia "sincronia" 3021 "demo-sincronia/server.mjs" || exit 1
avvia "macchina" 3022 "demo-macchina/server.mjs" || exit 1
echo "Demo avviata. Per fermarla: ./spegni-demo.sh"
