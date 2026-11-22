import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createBirdClient } from "./lib/bird-client.mjs";
import { createHandler } from "./lib/handler.mjs";

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "public");

export function createAppServer({ client, port = 0, host = "127.0.0.1" } = {}) {
  const server = createServer(createHandler({ client, publicDir }));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const apiKey = process.env.BIRD_API_KEY;
  if (!apiKey) {
    console.error("Manca BIRD_API_KEY.");
    process.exit(1);
  }
  const client = createBirdClient({
    apiKey,
    apiBase: process.env.BIRD_API_BASE,
    workspaceId: process.env.BIRD_WORKSPACE_ID,
  });
  try {
    const account = await client.confirmBusinessNumber();
    const port = Number(process.env.PORT || 8787);
    const server = await createAppServer({ client, port });
    const address = server.address();
    console.log(
      `Messaggi WhatsApp per ${account.display_number} (${account.name}) su http://127.0.0.1:${address.port}`,
    );
  } catch (error) {
    console.error(error.message || "Impossibile confermare il numero WhatsApp Business.");
    process.exit(1);
  }
}
