#!/bin/bash
# Chiude i listener delle demo. Stesso elenco di ./avvia-demo.sh,
# più il pannello sulla 3020, che viene chiuso per ultimo.
# 3010 Hub portali, 3013 CRM Demo, 3014 Assistenza Tecnica,
# 3021 Collegamento tablet, 3022 Sincronizzatore, 3023 Macchina simulata, 3020 Pannello.
# Da macOS, nella cartella del repository: ./spegni-demo.sh

set -u

ROOT="$(cd "$(dirname "$0")" && pwd)"
STATO="$ROOT/.demo"

if ! command -v lsof >/dev/null 2>&1; then
  echo "lsof non è disponibile. Su macOS fa parte del sistema." >&2
  exit 1
fi

ferma() {
  nome="$1"
  porta="$2"
  pids="$(lsof -nP -iTCP:"$porta" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -f "$STATO/$nome.pid" ]; then
    pid_file="$(cat "$STATO/$nome.pid" 2>/dev/null || true)"
    case " $pids " in
      *" $pid_file "*) ;;
      *)
        if [ -n "$pid_file" ]; then
          pids="$pids
$pid_file"
        fi
        ;;
    esac
  fi
  if [ -z "$(printf '%s' "$pids" | tr -d '[:space:]')" ]; then
    echo "$nome ($porta) non è in esecuzione."
    rm -f "$STATO/$nome.pid"
    return 0
  fi
  printf '%s\n' "$pids" | while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    kill "$pid" 2>/dev/null || true
  done
  tentativo=0
  while [ "$tentativo" -lt 20 ]; do
    rimasti="$(lsof -nP -iTCP:"$porta" -sTCP:LISTEN -t 2>/dev/null || true)"
    if [ -z "$(printf '%s' "$rimasti" | tr -d '[:space:]')" ]; then
      break
    fi
    tentativo=$((tentativo + 1))
    sleep 0.25
  done
  rimasti="$(lsof -nP -iTCP:"$porta" -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -n "$(printf '%s' "$rimasti" | tr -d '[:space:]')" ]; then
    printf '%s\n' "$rimasti" | while IFS= read -r pid; do
      [ -n "$pid" ] || continue
      kill -9 "$pid" 2>/dev/null || true
    done
  fi
  rm -f "$STATO/$nome.pid"
  echo "$nome ($porta) fermata."
}

ferma "hub" 3010
ferma "crm" 3013
ferma "assistenza-tecnica" 3014
ferma "macchina" 3023
ferma "sincronia" 3022
ferma "assistenza" 3021

# Il pannello sta eseguendo questo script: chiudilo dopo,
# così la risposta può uscire prima che il listener 3020 cada.
nohup bash -c '
  sleep 0.6
  pids="$(lsof -nP -iTCP:3020 -sTCP:LISTEN -t 2>/dev/null || true)"
  if [ -z "$(printf "%s" "$pids" | tr -d "[:space:]")" ]; then
    exit 0
  fi
  printf "%s\n" "$pids" | while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    kill "$pid" 2>/dev/null || true
  done
  sleep 0.5
  rimasti="$(lsof -nP -iTCP:3020 -sTCP:LISTEN -t 2>/dev/null || true)"
  printf "%s\n" "$rimasti" | while IFS= read -r pid; do
    [ -n "$pid" ] || continue
    kill -9 "$pid" 2>/dev/null || true
  done
' >/dev/null 2>&1 &
disown 2>/dev/null || true
echo "Pannello (3020) in chiusura per ultimo."
