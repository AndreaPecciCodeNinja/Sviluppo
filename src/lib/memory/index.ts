export {
  getMemoryDbPath,
  getMemoryMaxMessages,
  getMemoryDb,
} from "./db";
export {
  listFacts,
  createFact,
  updateFact,
  deleteFact,
  listRecentMessages,
  appendMessage,
  buildMemoryPromptBlock,
  type MemoryFact,
  type MemorySnippet,
} from "./store";

/**
 * Optional LangChain-compatible adapter (SqliteChatMessageHistory) lives in
 * `./langchain-history`. Import that file directly when needed — it is not
 * re-exported here so fact/snippet API routes stay free of LangChain deps.
 */
