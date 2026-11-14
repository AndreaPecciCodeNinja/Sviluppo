export const NOME_PREDEFINITO = "Claude";
export const ISTRUZIONI_PREDEFINITE = "Presentati come agente AI e indica il tuo nome.";

export function normalizzaImpostazioni(input) {
  const dati = input && typeof input === "object" ? input : {};
  const nome = String("nome" in dati ? dati.nome : NOME_PREDEFINITO)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80) || NOME_PREDEFINITO;
  const istruzioni = String("istruzioni" in dati ? dati.istruzioni : ISTRUZIONI_PREDEFINITE)
    .trim()
    .slice(0, 2000);
  return { nome, istruzioni };
}

/** Testo aggiunto a ogni ruolo: Claude deve tenerne conto in ogni risposta. */
export function bloccoImpostazioni(input) {
  const { nome, istruzioni } = normalizzaImpostazioni(input);
  const fisse = istruzioni ? ` ${istruzioni}` : "";
  return `Impostazioni fisse, da rispettare in ogni risposta. Il tuo nome è ${nome}.${fisse}`;
}
