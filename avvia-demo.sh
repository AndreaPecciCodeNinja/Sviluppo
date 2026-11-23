#!/bin/bash
# Avvia lo stesso elenco che ./spegni-demo.sh chiude, senza il pannello.
# 3010 Hub portali, 3013 CRM Demo, 3014 Assistenza Tecnica,
# 3021 Collegamento tablet, 3022 Sincronizzatore, 3023 Macchina simulata.
# Il pannello 3020 è già in esecuzione e non viene riavviato.
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

# gestisci.mjs non è in questo repository: sta sul Mac di Andrea.
# Non viene creato qui. Spegni chiude comunque 3010 e 3013.
SVILUPPO_MAC="/Users/macair_andrea/Documents/Sviluppo"
GESTISCI="$SVILUPPO_MAC/pannello-demo/gestisci.mjs"

avvia_con_gestisci() {
  nome="$1"
  porta="$2"
  argomento="$3"
  comando="node pannello-demo/gestisci.mjs avvia $argomento"
  if in_ascolto "$porta"; then
    echo "$nome è già in ascolto su http://127.0.0.1:$porta/"
    return 0
  fi
  if [ ! -d "$SVILUPPO_MAC" ]; then
    echo "$nome ($porta): cartella non trovata: $SVILUPPO_MAC" >&2
    echo "Comando, con quella cartella come directory di lavoro: $comando" >&2
    return 0
  fi
  if [ ! -f "$GESTISCI" ]; then
    echo "$nome ($porta): pannello-demo/gestisci.mjs non è in questo repository." >&2
    echo "Comando previsto sul Mac di Andrea, da $SVILUPPO_MAC: $comando" >&2
    echo "Lo script non è stato creato." >&2
    return 1
  fi
  : > "$STATO/$nome.log"
  (
    cd "$SVILUPPO_MAC" || exit 1
    nohup node pannello-demo/gestisci.mjs avvia "$argomento" >>"$STATO/$nome.log" 2>&1 &
    echo $! > "$STATO/$nome.pid"
  )
  if ! attendi "$porta" "$nome" "$nome" 80; then
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
    nohup env PORT=3014 \
      SINCRO_URL="http://127.0.0.1:3022/api/ingresso" \
      SINCRO_INGRESSO="http://127.0.0.1:3022/api/ingresso" \
      SYNC_URL="http://127.0.0.1:3022/api/ingresso" \
      NEXT_PUBLIC_SINCRO_URL="http://127.0.0.1:3022/api/ingresso" \
      npm start >>"$STATO/$nome.log" 2>&1 &
    echo $! > "$STATO/$nome.pid"
  )
  if ! attendi "$porta" "Assistenza Tecnica Demo" "$nome" 80; then
    return 1
  fi
  echo "Assistenza Tecnica Demo su http://127.0.0.1:$porta/"
}

cd "$ROOT"
avvia_con_gestisci "hub" 3010 "hub" || exit 1
avvia_con_gestisci "crm" 3013 "crm" || exit 1
avvia "assistenza" 3021 "demo-assistenza/server.mjs" || exit 1
avvia "sincronia" 3022 "demo-sincronia/server.mjs" || exit 1
avvia "macchina" 3023 "demo-macchina/server.mjs" || exit 1
avvia_assistenza_tecnica || exit 1
echo "Demo avviata. Il pannello sulla porta 3020 non è stato riavviato. Per fermarle: ./spegni-demo.sh"
