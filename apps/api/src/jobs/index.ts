import cron from "node-cron";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getStore } from "../db/index.js";
import { enqueue } from "../modules/queue.js";
import { enrichItem } from "../modules/enrich.js";

const DAY = 86_400_000;

/** Nightly: permanently purge items trashed more than 30 days ago (§7). */
async function purgeTrash() {
  const store = getStore();
  const cutoff = Date.now() - 30 * DAY;
  const users = await store.users.find({});
  let purged = 0;
  for (const u of users) {
    const trashed = (await store.items.find({ userId: u.id })).filter((i) => i.deletedAt && new Date(i.deletedAt).getTime() < cutoff);
    for (const i of trashed) {
      if (i.skillId) await store.skills.deleteById(i.skillId);
      await store.items.deleteById(i.id);
      purged++;
    }
  }
  if (purged) logger.info({ purged }, "trash purge complete");
}

/** Weekly: re-enrich repo cards to refresh stars/pushedAt and detect drift (§7). */
async function refreshRepos() {
  const store = getStore();
  const users = await store.users.find({});
  let queued = 0;
  for (const u of users) {
    const repos = (await store.items.find({ userId: u.id, kind: "link", deletedAt: null })).filter((i) => i.linkType === "repo");
    for (const i of repos) {
      enqueue(`refresh:${i.id}`, () => enrichItem(u.id, i.id), 1);
      queued++;
    }
  }
  if (queued) logger.info({ queued }, "weekly repo refresh enqueued");
}

/** Start scheduled jobs (opt-in via ENABLE_JOBS). */
export function startJobs(): void {
  if (!config.jobs) {
    logger.info("jobs disabled (set ENABLE_JOBS=1 to enable refresh/purge)");
    return;
  }
  cron.schedule("0 3 * * *", () => void purgeTrash().catch((err) => logger.error({ err }, "purge failed")));
  cron.schedule("0 4 * * 0", () => void refreshRepos().catch((err) => logger.error({ err }, "refresh failed")));
  logger.info("scheduled jobs started (nightly purge · weekly refresh)");
}
