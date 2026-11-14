import { rispondi } from "./agent.mjs";
import { caricaEnvLocal } from "./env.mjs";
import { DEFAULT_VAULT_PATH } from "./vault.mjs";

await caricaEnvLocal();

const query = process.argv.slice(2).join(" ").trim();
const vaultPath = process.env.VAULT_PATH?.trim() || DEFAULT_VAULT_PATH;

const result = await rispondi({ vaultPath, query });
process.stdout.write(`${result.text}\n`);
process.exit(result.ok ? 0 : 1);
