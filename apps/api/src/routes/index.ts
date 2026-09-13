import type { Router } from "express";
import { authRouter } from "../auth/routes.js";
import { itemsRouter } from "./items.js";
import { eventsRouter } from "./events.js";
import { skillsRouter } from "./skills.js";
import { promptsRouter } from "./prompts.js";
import { collectionsRouter } from "./collections.js";
import { tagsRouter } from "./tags.js";
import { filesRouter } from "./files.js";
import { imgRouter } from "./img.js";
import { mcpRouter } from "../mcp/server.js";
import { telegramRouter } from "../bot/telegram.js";

/** Mount all feature routers. */
export function mountRoutes(api: Router): void {
  api.use(authRouter);
  api.use(itemsRouter);
  api.use(eventsRouter);
  api.use(skillsRouter);
  api.use(promptsRouter);
  api.use(collectionsRouter);
  api.use(tagsRouter);
  api.use(filesRouter);
  api.use(imgRouter);
  api.use(mcpRouter);
  api.use(telegramRouter);
}
