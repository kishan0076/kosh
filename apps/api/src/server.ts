import "./load-env.js"; // must run before config.js reads process.env
import { createApp } from "./app.js";
import { config } from "./config.js";
import { initStore } from "./db/index.js";
import { logger } from "./logger.js";
import { startJobs } from "./jobs/index.js";

async function main() {
  await initStore();
  const app = createApp();
  const server = app.listen(config.port, () => {
    logger.info(`Kosh API listening on ${config.apiUrl} (http://localhost:${config.port})`);
  });
  startJobs();

  const shutdown = (sig: string) => {
    logger.info(`${sig} received, shutting down`);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  logger.error({ err }, "failed to start");
  process.exit(1);
});
