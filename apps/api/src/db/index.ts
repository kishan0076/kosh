import { config, dbDriver } from "../config.js";
import { logger } from "../logger.js";
import { createMemoryStore } from "./memory.js";
import type { Store } from "./types.js";

let store: Store | null = null;

export async function initStore(): Promise<Store> {
  if (store) return store;
  if (dbDriver() === "mongo") {
    const { createMongoStore } = await import("./mongoose.js");
    logger.info("db: connecting to MongoDB");
    store = await createMongoStore(config.mongoUri!);
  } else {
    logger.info({ dataDir: config.dataDir }, "db: using in-memory/JSON store (set MONGODB_URI for Mongo)");
    store = createMemoryStore(config.dataDir);
  }
  return store;
}

export function getStore(): Store {
  if (!store) throw new Error("Store not initialised — call initStore() first.");
  return store;
}

export * from "./types.js";
