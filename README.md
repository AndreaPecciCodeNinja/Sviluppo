# Sviluppo

Agente ricette della cucina italiana. Legge le note di un vault Obsidian e risponde in italiano citando solo quelle note. Il modello è Claude, chiamato come il provider Anthropic di YOLO.

```bash
npm run ricetta -- "cacio e pepe"
```

`VAULT_PATH` punta al vault. Se manca, il default è:

`/cursor/stores/bc-bf9078ee-bb07-4134-a754-d6efb764ca4c/internal/vault/Cucina Italiana`

La chiave sta in `ANTHROPIC_API_KEY`. All'avvio, se c'è un file `.env.local` nella radice del progetto, le variabili che non sono già nell'ambiente vengono lette da lì. Una variabile già impostata non viene sovrascritta. `.env.local` è in `.gitignore`: non va committato. Senza chiave il comando cerca comunque le note, dice che Claude non è configurato ed elenca i titoli trovati. Se il piatto non è nel vault, lo dice e non inventa la ricetta.

`ANTHROPIC_MODEL` cambia il modello. Il default è `claude-sonnet-4-5`.

L'interfaccia a due riquadri (alimenti a sinistra, menù a destra) è anche un assistente. Se l'utente scrive «aiutami a preparare cena», la risposta resta nel riquadro, senza voce: una domanda alla volta, con la parola «scrivi», e il menù parte solo dopo il sì su almeno quattro alimenti. Un elenco già scritto nel riquadro cerca subito. Nome e istruzioni fisse stanno nel browser (`localStorage`), non nel git.

```bash
npm run menu
```

Poi vai su http://127.0.0.1:4173. Sul Mac di Andrea il vault è `VAULT_PATH=/Users/macair_andrea/Documents/Cucina Italiana`.

```bash
npm test
```
