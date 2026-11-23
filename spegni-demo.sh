#!/bin/bash
# Ferma assistenza (3020), sincronia (3021) e macchina (3022).
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

ferma "macchina" 3022
ferma "sincronia" 3021
ferma "assistenza" 3020
