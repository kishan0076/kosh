import { pino } from "pino";
import { config } from "./config.js";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (config.isProd ? "info" : "debug"),
  transport: config.isProd
    ? undefined
    : { target: "pino/file", options: { destination: 1 } }, // stdout, no pino-pretty dep
});
