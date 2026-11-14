# Sviluppo

Agente ricette della cucina italiana. Legge le note di un vault Obsidian e risponde in italiano citando solo quelle note. Il modello è Claude, chiamato come il provider Anthropic di YOLO.

```bash
npm run ricetta -- "cacio e pepe"
```

`VAULT_PATH` punta al vault. Se manca, il default è:

`/cursor/stores/bc-bf9078ee-bb07-4134-a754-d6efb764ca4c/internal/vault/Cucina Italiana`

La chiave sta solo in `ANTHROPIC_API_KEY`. Non va committata. Senza chiave il comando cerca comunque le note, dice che Claude non è configurato ed elenca i titoli trovati. Se il piatto non è nel vault, lo dice e non inventa la ricetta.

`ANTHROPIC_MODEL` cambia il modello. Il default è `claude-3-5-sonnet-latest`.

```bash
npm test
```
