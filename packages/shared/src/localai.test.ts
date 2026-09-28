import { describe, expect, it } from "vitest";
import { buildChatRequest, DEFAULT_LOCAL_AI_URL, extractJsonObject, normalizeLocalBaseUrl, parseChatResponse, parseModelList } from "./localai.js";

describe("normalizeLocalBaseUrl", () => {
  it("defaults when empty", () => {
    expect(normalizeLocalBaseUrl("")).toBe(DEFAULT_LOCAL_AI_URL);
    expect(normalizeLocalBaseUrl(undefined)).toBe(DEFAULT_LOCAL_AI_URL);
  });
  it("adds http:// and /v1", () => {
    expect(normalizeLocalBaseUrl("localhost:11434")).toBe("http://localhost:11434/v1");
    expect(normalizeLocalBaseUrl("192.168.1.9:1234")).toBe("http://192.168.1.9:1234/v1");
  });
  it("keeps an existing scheme and /v1, trims trailing slash", () => {
    expect(normalizeLocalBaseUrl("http://localhost:11434/v1/")).toBe("http://localhost:11434/v1");
    expect(normalizeLocalBaseUrl("https://my-box.local:8080/v1")).toBe("https://my-box.local:8080/v1");
  });
  it("does not double a versioned path", () => {
    expect(normalizeLocalBaseUrl("http://localhost:1234/v2")).toBe("http://localhost:1234/v2");
  });
});

describe("buildChatRequest", () => {
  it("includes the system message only when present", () => {
    const withSys = buildChatRequest({ model: "m", system: "be terse", prompt: "hi" });
    expect(withSys.messages).toEqual([{ role: "system", content: "be terse" }, { role: "user", content: "hi" }]);
    expect(withSys.stream).toBe(false);
    const noSys = buildChatRequest({ model: "m", prompt: "hi" });
    expect(noSys.messages).toEqual([{ role: "user", content: "hi" }]);
  });
  it("honors maxTokens/temperature overrides", () => {
    const r = buildChatRequest({ model: "m", prompt: "x", maxTokens: 128, temperature: 0 });
    expect(r.max_tokens).toBe(128);
    expect(r.temperature).toBe(0);
  });
});

describe("parseChatResponse", () => {
  it("extracts assistant content", () => {
    expect(parseChatResponse({ choices: [{ message: { content: "hello" } }] })).toBe("hello");
  });
  it("returns null for empty/malformed", () => {
    expect(parseChatResponse({ choices: [] })).toBeNull();
    expect(parseChatResponse({ choices: [{ message: { content: "  " } }] })).toBeNull();
    expect(parseChatResponse(null)).toBeNull();
  });
});

describe("parseModelList", () => {
  it("reads OpenAI /v1/models", () => {
    expect(parseModelList({ data: [{ id: "llama3.2" }, { id: "qwen2.5" }] })).toEqual(["llama3.2", "qwen2.5"]);
  });
  it("reads Ollama /api/tags", () => {
    expect(parseModelList({ models: [{ name: "llama3.2:latest" }] })).toEqual(["llama3.2:latest"]);
  });
  it("dedupes across both shapes and ignores junk", () => {
    expect(parseModelList({ data: [{ id: "a" }, { id: 3 }], models: [{ name: "a" }, { name: "b" }] })).toEqual(["a", "b"]);
    expect(parseModelList({})).toEqual([]);
  });
});

describe("extractJsonObject", () => {
  it("parses a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("tolerates code fences and surrounding prose", () => {
    expect(extractJsonObject('Here you go:\n```json\n{"ok":true}\n```\nthanks')).toEqual({ ok: true });
  });
  it("returns null when there is no object", () => {
    expect(extractJsonObject("no json here")).toBeNull();
    expect(extractJsonObject(null)).toBeNull();
    expect(extractJsonObject("{ not valid")).toBeNull();
  });
});
