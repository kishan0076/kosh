import PQueue from "p-queue";
import pRetry from "p-retry";
import { logger } from "../logger.js";

const queue = new PQueue({ concurrency: 4 });

/** Enqueue a background job with a priority and bounded retries. */
export function enqueue(name: string, fn: () => Promise<void>, priority = 5): void {
  void queue.add(
    () =>
      pRetry(fn, {
        retries: 2,
        onFailedAttempt: (e) => logger.warn({ job: name, attempt: e.attemptNumber, err: e.message }, "job retry"),
      }).catch((err) => logger.error({ job: name, err }, "job failed")),
    { priority },
  );
}

export const queueSize = () => queue.size + queue.pending;
