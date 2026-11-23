#!/bin/bash
# Avvia assistenza (3021), sincronia (3022), macchina (3023)
# e Assistenza Tecnica Demo (3014) in background.
# Da macOS, nella cartella del repository: ./avvia-demo.sh

set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
STATO="$ROOT/.demo"
ASSISTENZA_TECNICA="/Users/macair_andrea/Documents/ChatGPT/Progetto CRM/assistenza-demo-clone"
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
  limite="${4:-40}"
  while [ "$tentativo" -lt "$limite" ]; do
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
  if ! attendi "$porta" "$nome" "$nome" "${4:-40}"; then
    return 1
  fi
  echo "$nome su http://127.0.0.1:$porta/"
}

avvia_assistenza_tecnica() {
  nome="assistenza-tecnica"
  porta=3014
  if in_ascolto "$porta"; then
    echo "Assistenza Tecnica Demo è già in ascolto su http://127.0.0.1:$porta/"
    return 0
  fi
  if [ ! -d "$ASSISTENZA_TECNICA" ]; then
    echo "Cartella di Assistenza Tecnica Demo non trovata: $ASSISTENZA_TECNICA" >&2
    echo "Comando previsto, con quella cartella come directory di lavoro: PORT=3014 npm start" >&2
    return 1
  fi
  if ! command -v npm >/dev/null 2>&1; then
    echo "npm non è nel PATH. Serve per avviare Assistenza Tecnica Demo." >&2
    return 1
  fi
  : > "$STATO/$nome.log"
  (
    cd "$ASSISTENZA_TECNICA" || exit 1
    nohup env PORT=3014 npm start >>"$STATO/$nome.log" 2>&1 &
    echo $! > "$STATO/$nome.pid"
  )
  if ! attendi "$porta" "Assistenza Tecnica Demo" "$nome" 80; then
    return 1
  fi
  echo "Assistenza Tecnica Demo su http://127.0.0.1:$porta/"
}

cd "$ROOT"
avvia "assistenza" 3021 "demo-assistenza/server.mjs" || exit 1
avvia "sincronia" 3022 "demo-sincronia/server.mjs" || exit 1
avvia "macchina" 3023 "demo-macchina/server.mjs" || exit 1
avvia_assistenza_tecnica || exit 1
echo "Demo avviata. Per fermarla: ./spegni-demo.sh"
