import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { rispondi } from "../src/agent.mjs";
import { caricaEnvLocal } from "../src/env.mjs";
import { ANTHROPIC_MESSAGES_URL, ANTHROPIC_VERSION, richiestaClaude } from "../src/claude.mjs";
import { cercaNote } from "../src/search.mjs";
import { DEFAULT_VAULT_PATH, caricaNote } from "../src/vault.mjs";

const fixture = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/vault");

test("cacio e pepe è la nota classica, l'indice non entra", async () => {
  const notes = await caricaNote(fixture);
  const found = cercaNote(notes, "cacio e pepe");
  assert.deepEqual(found.map((note) => note.rel), ["ricette/cacio-e-pepe.md"]);
  assert.equal(found[0].title, "Cacio e pepe");
});

test("un piatto assente non produce note", async () => {
  const notes = await caricaNote(fixture);
  assert.deepEqual(cercaNote(notes, "souffle di marte"), []);
});

test("senza chiave elenca i titoli e non chiama Claude", async () => {
  let called = false;
  const result = await rispondi({
    vaultPath: fixture,
    query: "cacio e pepe",
    env: {},
    fetchImpl() {
      called = true;
      throw new Error("non doveva partire");
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.kind, "senza-chiave");
  assert.equal(called, false);
  assert.match(result.text, /Claude non è configurato: manca ANTHROPIC_API_KEY/);
  assert.match(result.text, /Cacio e pepe \(ricette\/cacio-e-pepe\.md\)/);
});

test("piatto assente", async () => {
  const result = await rispondi({
    vaultPath: fixture,
    query: "souffle di marte",
    env: { ANTHROPIC_API_KEY: "sk-test" },
  });
  assert.equal(result.kind, "assente");
  assert.match(result.text, /non c'è una ricetta/);
});

test("la richiesta a Claude usa endpoint e header di YOLO, la chiave non finisce nel corpo", () => {
  const { url, init } = richiestaClaude({
    apiKey: "sk-ant-segreto",
    query: "cacio e pepe",
    notes: [{ rel: "ricette/cacio-e-pepe.md", title: "Cacio e pepe", text: "solo pepe", storica: false }],
  });
  assert.equal(url, ANTHROPIC_MESSAGES_URL);
  assert.equal(init.method, "POST");
  assert.equal(init.headers["x-api-key"], "sk-ant-segreto");
  assert.equal(init.headers["anthropic-version"], ANTHROPIC_VERSION);
  assert.equal(init.body.includes("sk-ant-segreto"), false);
  assert.match(init.body, /solo pepe/);
  assert.match(init.body, /agente ricette della cucina italiana/);
});

test("con la chiave stampa la risposta e le note usate", async () => {
  const result = await rispondi({
    vaultPath: fixture,
    query: "panna cotta",
    env: { ANTHROPIC_API_KEY: "sk-test", ANTHROPIC_MODEL: "claude-test" },
    async fetchImpl(url, init) {
      assert.equal(url, ANTHROPIC_MESSAGES_URL);
      assert.equal(init.headers["x-api-key"], "sk-test");
      const body = JSON.parse(init.body);
      assert.equal(body.model, "claude-test");
      assert.match(body.messages[0].content, /Panna cotta/);
      return new Response(JSON.stringify({ content: [{ type: "text", text: "Risposta ancorata." }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(result.kind, "risposta");
  assert.match(result.text, /Note usate:/);
  assert.match(result.text, /Panna cotta \(ricette\/panna-cotta\.md\)/);
  assert.match(result.text, /Risposta ancorata/);
  assert.equal(result.text.includes("sk-test"), false);
});

test("il vault vero risolve cacio e pepe e rifiuta un piatto inventato", async () => {
  if (!existsSync(DEFAULT_VAULT_PATH)) return;
  const found = await rispondi({ vaultPath: DEFAULT_VAULT_PATH, query: "cacio e pepe", env: {} });
  assert.match(found.text, /ricette\/cacio-e-pepe\.md/);
  const missing = await rispondi({
    vaultPath: DEFAULT_VAULT_PATH,
    query: "souffle di marte",
    env: { ANTHROPIC_API_KEY: "non-usata" },
  });
  assert.equal(missing.kind, "assente");
});

test(".env.local riempie solo le variabili assenti e non stampa il segreto", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "env-local-"));
  const file = path.join(dir, ".env.local");
  await writeFile(file, "# commento\n\nANTHROPIC_API_KEY=\"sk-dal-file\"\nANTHROPIC_MODEL=dal-file\nGIA=dal-file\n");
  const env = { GIA: "gia-ambiente" };
  assert.equal(await caricaEnvLocal(env, file), true);
  assert.equal(env.ANTHROPIC_API_KEY, "sk-dal-file");
  assert.equal(env.ANTHROPIC_MODEL, "dal-file");
  assert.equal(env.GIA, "gia-ambiente");
  assert.equal(await caricaEnvLocal(env, path.join(dir, "manca.env")), false);
});

test("vault mancante", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "vuoto-"));
  const result = await rispondi({
    vaultPath: path.join(dir, "inesistente"),
    query: "cacio e pepe",
    env: {},
  });
  assert.equal(result.kind, "vault");
});
