import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_MODEL } from "../src/claude.mjs";
import { turnoDialogo } from "../src/dialogo.mjs";
import { estraiAlimenti, cercaPiatti, componiMenu, RUOLO_MENU } from "../src/menu.mjs";
import { creaServer } from "../src/server.mjs";
import { DEFAULT_VAULT_PATH, caricaNote } from "../src/vault.mjs";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/vault");

test("gli alimenti si separano da virgole e dalla e", () => {
  assert.deepEqual(estraiAlimenti("pomodoro, basilico e pecorino"), [
    "pomodoro",
    "basilico",
    "pecorino",
  ]);
  assert.deepEqual(estraiAlimenti("   "), []);
});

test("pecorino trova il cacio e pepe e non la panna cotta", async () => {
  const notes = await caricaNote(fixture);
  const found = cercaPiatti(notes, estraiAlimenti("pecorino"));
  assert.deepEqual(found.map((note) => note.rel), ["ricette/cacio-e-pepe.md"]);
});

test("senza chiave il menù elenca le note e non chiama Claude", async () => {
  let called = false;
  const result = await componiMenu({
    vaultPath: fixture,
    alimenti: "pecorino",
    env: {},
    fetchImpl() {
      called = true;
      throw new Error("non doveva partire");
    },
  });
  assert.equal(called, false);
  assert.equal(result.kind, "senza-chiave");
  assert.match(result.text, /ricette\/cacio-e-pepe\.md/);
});

test("con la chiave il menù usa claude-sonnet-4-5 e solo le note trovate", async () => {
  const result = await componiMenu({
    vaultPath: fixture,
    alimenti: "pecorino",
    env: { ANTHROPIC_API_KEY: "sk-test" },
    impostazioni: { nome: "Cuoco", istruzioni: "Presentati come agente AI e indica il tuo nome." },
    async fetchImpl(_url, init) {
      const body = JSON.parse(init.body);
      assert.equal(body.model, DEFAULT_MODEL);
      assert.equal(DEFAULT_MODEL, "claude-sonnet-4-5");
      assert.match(body.system, new RegExp(RUOLO_MENU.slice(0, 40).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      assert.match(body.system, /Il tuo nome è Cuoco/);
      assert.match(body.system, /agente AI/);
      assert.match(body.messages[0].content, /Cacio e pepe/);
      assert.equal(body.messages[0].content.includes("Panna cotta"), false);
      assert.equal(init.headers["x-api-key"], "sk-test");
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Menù di prova." }] }), {
        status: 200,
      });
    },
  });
  assert.match(result.text, /Menù di prova/);
  assert.match(result.text, /Cacio e pepe/);
});

test("il server mostra i due riquadri e risponde agli alimenti", async () => {
  const server = creaServer({ vaultPath: fixture, env: {} });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const page = await fetch(`http://127.0.0.1:${port}/`);
    const html = await page.text();
    assert.match(html, /id="alimenti"/);
    assert.match(html, /id="menu"/);
    assert.match(html, /Crea il menù/);
    assert.match(html, /Parla/);
    assert.match(html, /Impostazioni/);
    assert.match(html, /localStorage/);
    assert.match(html, /speechSynthesis/);
    assert.match(html, /it-IT/);
    const dialogo = await fetch(`http://127.0.0.1:${port}/api/dialogo`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messaggi: [] }),
    });
    const chiacchiere = await dialogo.json();
    assert.equal(chiacchiere.kind, "senza-chiave");
    assert.equal(chiacchiere.stato, "domanda");
    assert.equal(chiacchiere.parla, false);
    assert.match(chiacchiere.testo, /non è configurato/);
    assert.match(chiacchiere.testo, /[Ss]crivi/);
    assert.equal(chiacchiere.notes.length, 0);
    const response = await fetch(`http://127.0.0.1:${port}/api/menu`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ alimenti: "pecorino" }),
    });
    const data = await response.json();
    assert.equal(data.kind, "senza-chiave");
    assert.match(data.text, /Cacio e pepe/);
    const stato = await fetch(`http://127.0.0.1:${port}/api/stato`).then((res) => res.json());
    assert.equal(stato.claude, false);
    assert.equal(Object.hasOwn(stato, "apiKey"), false);
  } finally {
    await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});

test("il dialogo senza chiave non chiama Claude e non cerca nel vault", async () => {
  let called = false;
  const result = await turnoDialogo({
    messaggi: [],
    env: {},
    fetchImpl() {
      called = true;
    },
  });
  assert.equal(called, false);
  assert.equal(result.stato, "domanda");
  assert.equal(result.parla, false);
  assert.equal(result.voce, "");
  assert.match(result.testo, /[Ss]crivi/);
});

test("«aiutami a preparare cena» è una richiesta, non un elenco", async () => {
  const { èRichiesta } = await import("../src/dialogo.mjs");
  assert.equal(èRichiesta("aiutami a preparare cena"), true);
  assert.equal(èRichiesta("pecorino, uova, guanciale"), false);
});

test("il dialogo scritto fa una domanda, poi conferma i quattro alimenti, e cerca solo al sì", async () => {
  const { èRichiesta: richiesta } = await import("../src/dialogo.mjs");
  assert.equal(richiesta("aiutami a preparare cena"), true);
  let viste = 0;
  const prima = await turnoDialogo({
    canale: "scritto",
    messaggi: [{ role: "user", content: "aiutami a preparare cena" }],
    impostazioni: { nome: "Cuoco", istruzioni: "Presentati come agente AI e indica il tuo nome." },
    env: { ANTHROPIC_API_KEY: "sk-test" },
    async fetchImpl(_url, init) {
      viste += 1;
      const body = JSON.parse(init.body);
      assert.match(body.system, /una sola domanda/);
      assert.match(body.system, /scrivi/);
      assert.match(body.system, /Il tuo nome è Cuoco/);
      assert.match(body.messages.map((msg) => msg.content).join("\n"), /aiutami a preparare cena/);
      return new Response(JSON.stringify({
        content: [{ type: "text", text: '{"testo":"Che cosa hai per cena? E per pranzo?"}' }],
      }), { status: 200 });
    },
  });
  assert.equal(prima.stato, "domanda");
  assert.equal(prima.parla, false);
  assert.equal(prima.voce, "");
  assert.equal((prima.testo.match(/\?/g) || []).length, 1);
  assert.match(prima.testo, /\bscrivi\b/i);

  const quattro = [
    { role: "user", content: "aiutami a preparare cena" },
    { role: "assistant", content: prima.testo },
    { role: "user", content: "uova, pecorino, guanciale e pomodoro" },
  ];
  const conferma = await turnoDialogo({
    canale: "scritto",
    messaggi: quattro,
    impostazioni: { nome: "Cuoco", istruzioni: "Presentati come agente AI e indica il tuo nome." },
    env: { ANTHROPIC_API_KEY: "sk-test" },
    async fetchImpl() {
      return new Response(JSON.stringify({
        content: [{ type: "text", text: '{"testo":"Va bene cosi?"}' }],
      }), { status: 200 });
    },
  });
  assert.equal(conferma.stato, "domanda");
  assert.equal(conferma.parla, false);
  assert.match(conferma.testo, /Cuoco, agente AI/);
  assert.match(conferma.testo, /\bscrivi\b/i);
  assert.match(conferma.testo, /quelli giusti/i);
  assert.equal((conferma.testo.match(/\?/g) || []).length, 1);
  for (const alimento of ["uova", "pecorino", "guanciale", "pomodoro"]) {
    assert.match(conferma.testo, new RegExp(alimento));
  }

  let chiamato = false;
  const si = await turnoDialogo({
    canale: "scritto",
    messaggi: [...quattro, { role: "assistant", content: conferma.testo }, { role: "user", content: "sì" }],
    env: { ANTHROPIC_API_KEY: "sk-test" },
    fetchImpl() {
      chiamato = true;
      throw new Error("non deve chiamare il modello dopo il sì");
    },
  });
  assert.equal(chiamato, false);
  assert.equal(si.stato, "definitivo");
  assert.equal(si.parla, false);
  assert.match(si.alimenti, /uova/);
  assert.equal(viste > 0, true);
});

test("nel vault vero guanciale, uova e pecorino portano alla carbonara", async () => {
  if (!existsSync(DEFAULT_VAULT_PATH)) return;
  const notes = await caricaNote(DEFAULT_VAULT_PATH);
  const found = cercaPiatti(notes, estraiAlimenti("guanciale, uova, pecorino"));
  assert.equal(found[0].rel, "ricette/spaghetti-alla-carbonara.md");
});
