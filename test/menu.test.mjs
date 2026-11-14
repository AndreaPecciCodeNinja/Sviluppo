import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEFAULT_MODEL } from "../src/claude.mjs";
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
    async fetchImpl(_url, init) {
      const body = JSON.parse(init.body);
      assert.equal(body.model, DEFAULT_MODEL);
      assert.equal(DEFAULT_MODEL, "claude-sonnet-4-5");
      assert.equal(body.system, RUOLO_MENU);
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

test("nel vault vero guanciale, uova e pecorino portano alla carbonara", async () => {
  if (!existsSync(DEFAULT_VAULT_PATH)) return;
  const notes = await caricaNote(DEFAULT_VAULT_PATH);
  const found = cercaPiatti(notes, estraiAlimenti("guanciale, uova, pecorino"));
  assert.equal(found[0].rel, "ricette/spaghetti-alla-carbonara.md");
});
