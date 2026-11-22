import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler } from "./lib/handler.mjs";
import { createMessageStore } from "./lib/store.mjs";
import { createWhatsAppClient } from "./lib/whatsapp-cloud.mjs";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(appDir, "public");

export function createAppServer({
  client,
  store,
  port = 0,
  host = "127.0.0.1",
  appSecret,
  verifyToken,
  phoneNumberId,
} = {}) {
  const server = createServer(createHandler({
    client,
    store,
    publicDir,
    appSecret,
    verifyToken,
    phoneNumberId,
  }));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}

function missingCredentials() {
  const missing = [];
  if (!process.env.WHATSAPP_ACCESS_TOKEN) missing.push("WHATSAPP_ACCESS_TOKEN");
  if (!process.env.WHATSAPP_PHONE_NUMBER_ID && !process.env.WHATSAPP_BUSINESS_ACCOUNT_ID) {
    missing.push("WHATSAPP_PHONE_NUMBER_ID oppure WHATSAPP_BUSINESS_ACCOUNT_ID");
  }
  return missing;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const missing = missingCredentials();
  if (missing.length) {
    console.error(`Mancano: ${missing.join(", ")}.`);
    console.error("Per ricevere i messaggi servono anche WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN.");
    process.exit(1);
  }
  if (!process.env.WHATSAPP_APP_SECRET || !process.env.WHATSAPP_VERIFY_TOKEN) {
    console.error("Senza WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN il webhook non accetta messaggi.");
  }
  const client = createWhatsAppClient({
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID,
    graphVersion: process.env.WHATSAPP_GRAPH_VERSION,
  });
  try {
    const account = await client.confirmBusinessNumber();
    const store = createMessageStore({
      filePath: process.env.WHATSAPP_DATA_FILE || path.join(appDir, "data", "inbox.json"),
    });
    await store.load();
    const port = Number(process.env.PORT || 8787);
    const server = await createAppServer({
      client,
      store,
      port,
      appSecret: process.env.WHATSAPP_APP_SECRET,
      verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
      phoneNumberId: account.phone_number_id,
    });
    const address = server.address();
    console.log(
      `Messaggi WhatsApp per ${account.display_number} (${account.name}) su http://127.0.0.1:${address.port}`,
    );
  } catch (error) {
    console.error(error.message || "Impossibile confermare il numero WhatsApp Business.");
    process.exit(1);
  }
}
