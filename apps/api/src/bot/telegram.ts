import { Router, type RequestHandler } from "express";
import { Bot, webhookCallback } from "grammy";
import { extractVariables, type FoundVia } from "@kosh/shared";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { getStore, type ServerItem } from "../db/index.js";
import { ingest } from "../modules/ingest.js";
import { createSkillVersion } from "../modules/skills.js";

const nowIso = () => new Date().toISOString();

async function userForChat(chatId: number) {
  return getStore().users.findOne({ telegramChatId: chatId });
}

function forwardOrigin(msg: { forward_origin?: { type: string; chat?: { title?: string }; sender_user?: { first_name?: string } } }): FoundVia | undefined {
  const o = msg.forward_origin;
  if (!o) return undefined;
  const label = o.chat?.title ?? o.sender_user?.first_name ?? "forward";
  return { kind: "telegram", label };
}

function build(): Bot {
  const bot = new Bot(config.telegram.token!);

  bot.command("start", async (ctx) => {
    const login = ctx.match?.trim();
    if (!login) return ctx.reply("Send /start <your-login> to link this chat to your Kosh vault.");
    if (config.allowedLogins.length && !config.allowedLogins.includes(login)) return ctx.reply("That login isn't allowed.");
    const user = await getStore().users.findOne({ login });
    if (!user) return ctx.reply("No such user. Sign in on the web first.");
    await getStore().users.updateById(user.id, { telegramChatId: ctx.chat.id });
    return ctx.reply(`Linked ✓ Send links, a .md/.zip document, or text and I'll save them for @${login}.`);
  });

  bot.on(["message:entities:url", "message:entities:text_link"], async (ctx) => {
    const user = await userForChat(ctx.chat.id);
    if (!user) return ctx.reply("This chat isn't linked. Send /start <your-login>.");
    const urls = [...new Set(ctx.entities(["url", "text_link"]).map((e) => (e.type === "text_link" ? e.url : e.text)))];
    const note = ctx.message?.text?.replace(/https?:\/\/\S+/g, "").trim() || undefined;
    const foundVia = forwardOrigin(ctx.message ?? {});
    for (const url of urls) {
      const { item, duplicate } = await ingest(user.id, url, { source: "bot", note, foundVia });
      await ctx.reply(duplicate ? `Already saved: ${item.title ?? url}` : `Saving… ${url}`);
    }
  });

  bot.on("message:document", async (ctx) => {
    const user = await userForChat(ctx.chat.id);
    if (!user) return ctx.reply("This chat isn't linked. Send /start <your-login>.");
    const doc = ctx.message.document;
    if ((doc.file_size ?? 0) > 20 * 1024 * 1024) return ctx.reply("Telegram caps bot downloads at 20 MB — upload this on the web app.");
    const file = await ctx.getFile();
    const ab = await fetch(`https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`).then((r) => r.arrayBuffer());
    const buf = Buffer.from(new Uint8Array(ab));
    const name = doc.file_name ?? "file";
    if (/\.md$/i.test(name) && buf.toString("utf8").includes("name:")) {
      const { skill } = await createSkillVersion(user.id, [{ path: "SKILL.md", mime: "text/markdown", content: buf.toString("utf8") }], { origin: "bot", itemSource: "bot", trust: "mine", foundVia: forwardOrigin(ctx.message) });
      return ctx.reply(`Saved skill ${skill.name} · v${skill.latest}\nInstall: npx kosh add ${skill.name}`);
    }
    const item = await getStore().items.create({
      userId: user.id,
      kind: "file",
      title: name,
      tags: [],
      collections: [],
      stage: "to-try",
      source: "bot",
      status: "ready",
      fileObject: { path: name, size: buf.length, mime: doc.mime_type ?? "application/octet-stream" },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } as Omit<ServerItem, "id">);
    return ctx.reply(`Saved file ${item.title}`);
  });

  bot.on("message:text", async (ctx) => {
    const user = await userForChat(ctx.chat.id);
    if (!user) return ctx.reply("This chat isn't linked. Send /start <your-login>.");
    const text = ctx.message.text;
    const body = text;
    await getStore().items.create({
      userId: user.id,
      kind: "prompt",
      title: text.slice(0, 60),
      description: text.slice(0, 140),
      tags: [],
      collections: [],
      stage: "to-try",
      source: "bot",
      status: "ready",
      prompt: { body, variables: extractVariables(body).map((name) => ({ name })), usedCount: 0 },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    } as Omit<ServerItem, "id">);
    return ctx.reply("Saved as a prompt. (Send a link to save a link, or a .md to save a skill.)");
  });

  return bot;
}

let handler: RequestHandler | null = null;
export const telegramRouter: Router = Router();
telegramRouter.post("/telegram/webhook", (req, res, next) => {
  if (!config.telegram.token) {
    res.json({ ok: true, note: "Telegram bot not configured (set TELEGRAM_BOT_TOKEN)." });
    return;
  }
  if (config.telegram.webhookSecret && req.header("x-telegram-bot-api-secret-token") !== config.telegram.webhookSecret) {
    res.status(401).json({ error: { code: "BAD_SECRET", message: "Invalid webhook secret." } });
    return;
  }
  if (!handler) {
    try {
      handler = webhookCallback(build(), "express");
      logger.info("telegram bot initialised");
    } catch (err) {
      logger.error({ err }, "telegram bot init failed");
      res.status(500).json({ error: { code: "BOT_INIT", message: "Bot failed to initialise." } });
      return;
    }
  }
  void (handler as RequestHandler)(req, res, next);
});
