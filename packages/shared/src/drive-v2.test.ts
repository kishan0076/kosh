import { describe, it, expect } from "vitest";
import {
  driveKindOf,
  sortDriveNodes,
  parseDriveSearch,
  dedupeDriveActivity,
  normalizeTag,
  parseTags,
  serializeTags,
  tagColorIndex,
  isNativeGoogleDoc,
  driveExportFormats,
  driveTextSource,
  driveHasTextSource,
  computeCleanupBuckets,
  canGrantExpiry,
  EXPIRY_ROLES,
  TAG_PROP_KEY,
  MAX_TAG_LEN,
  DRIVE_FOLDER_MIME,
  type SortableNode,
  type ActivityLike,
} from "./drive-v2.js";

describe("driveKindOf", () => {
  it("classifies folders first (by flag or mime)", () => {
    expect(driveKindOf({ isFolder: true })).toBe("folder");
    expect(driveKindOf({ mimeType: DRIVE_FOLDER_MIME })).toBe("folder");
    // isFolder wins even with a document mime
    expect(driveKindOf({ isFolder: true, mimeType: "application/vnd.google-apps.document" })).toBe("folder");
  });

  it("maps common mime types to coarse kinds", () => {
    expect(driveKindOf({ mimeType: "application/pdf" })).toBe("pdf");
    expect(driveKindOf({ mimeType: "image/png" })).toBe("image");
    expect(driveKindOf({ mimeType: "video/mp4" })).toBe("video");
    expect(driveKindOf({ mimeType: "audio/mpeg" })).toBe("audio");
    expect(driveKindOf({ mimeType: "application/vnd.google-apps.spreadsheet" })).toBe("sheet");
    expect(driveKindOf({ mimeType: "text/csv" })).toBe("sheet");
    expect(driveKindOf({ mimeType: "application/vnd.google-apps.presentation" })).toBe("slide");
    expect(driveKindOf({ mimeType: "application/vnd.google-apps.document" })).toBe("doc");
    expect(driveKindOf({ mimeType: "application/msword" })).toBe("doc");
    expect(driveKindOf({ mimeType: "text/plain" })).toBe("doc");
    expect(driveKindOf({ mimeType: "application/zip" })).toBe("archive");
    expect(driveKindOf({ mimeType: "application/x-7z-compressed" })).toBe("archive");
  });

  it("falls back to 'other' for unknown / missing mime", () => {
    expect(driveKindOf({})).toBe("other");
    expect(driveKindOf({ mimeType: "application/octet-stream" })).toBe("other");
  });
});

describe("sortDriveNodes", () => {
  const node = (n: Partial<SortableNode> & { name: string }): SortableNode => ({
    isFolder: false,
    ...n,
  });

  it("always puts folders before files regardless of key/dir", () => {
    const nodes = [
      node({ name: "zeta.txt" }),
      node({ name: "alpha", isFolder: true }),
      node({ name: "beta.txt" }),
      node({ name: "gamma", isFolder: true }),
    ];
    for (const dir of ["asc", "desc"] as const) {
      const sorted = sortDriveNodes(nodes, "name", dir);
      const folderCount = sorted.filter((s) => s.isFolder).length;
      expect(sorted.slice(0, folderCount).every((s) => s.isFolder)).toBe(true);
      expect(sorted.slice(folderCount).every((s) => !s.isFolder)).toBe(true);
    }
  });

  it("sorts names with natural/numeric ordering (file2 before file10)", () => {
    const nodes = [node({ name: "file10" }), node({ name: "file2" }), node({ name: "file1" })];
    expect(sortDriveNodes(nodes, "name", "asc").map((n) => n.name)).toEqual(["file1", "file2", "file10"]);
    expect(sortDriveNodes(nodes, "name", "desc").map((n) => n.name)).toEqual(["file10", "file2", "file1"]);
  });

  it("sorts by size numerically", () => {
    const nodes = [node({ name: "a", size: 500 }), node({ name: "b", size: 30 }), node({ name: "c" })];
    expect(sortDriveNodes(nodes, "size", "asc").map((n) => n.name)).toEqual(["c", "b", "a"]);
  });

  it("sorts by modified time (missing sorts first ascending)", () => {
    const nodes = [
      node({ name: "a", modifiedTime: "2024-01-02T00:00:00Z" }),
      node({ name: "b", modifiedTime: "2024-01-01T00:00:00Z" }),
      node({ name: "c" }),
    ];
    expect(sortDriveNodes(nodes, "modified", "asc").map((n) => n.name)).toEqual(["c", "b", "a"]);
  });

  it("sorts by created (upload) time — newest first when descending", () => {
    const nodes = [
      node({ name: "old", createdTime: "2024-01-01T00:00:00Z" }),
      node({ name: "new", createdTime: "2024-03-01T00:00:00Z" }),
      node({ name: "mid", createdTime: "2024-02-01T00:00:00Z" }),
      node({ name: "none" }), // missing createdTime sorts first ascending / last descending
    ];
    expect(sortDriveNodes(nodes, "created", "asc").map((n) => n.name)).toEqual(["none", "old", "mid", "new"]);
    expect(sortDriveNodes(nodes, "created", "desc").map((n) => n.name)).toEqual(["new", "mid", "old", "none"]);
  });

  it("keeps folders first when sorting by created time", () => {
    const nodes = [
      node({ name: "file-new", createdTime: "2024-03-01T00:00:00Z" }),
      node({ name: "folder-old", isFolder: true, createdTime: "2024-01-01T00:00:00Z" }),
    ];
    // folders always precede files even though the file is newer.
    expect(sortDriveNodes(nodes, "created", "desc").map((n) => n.name)).toEqual(["folder-old", "file-new"]);
  });

  it("sorts by kind, tiebreaking on name with natural/numeric order", () => {
    const nodes = [
      node({ name: "b.pdf", mimeType: "application/pdf" }),
      node({ name: "file10.png", mimeType: "image/png" }),
      node({ name: "a.pdf", mimeType: "application/pdf" }),
      node({ name: "file2.png", mimeType: "image/png" }),
    ];
    // images (kind "image") sort before pdfs (kind "pdf"); within a kind, natural name order.
    expect(sortDriveNodes(nodes, "kind", "asc").map((n) => n.name)).toEqual(["file2.png", "file10.png", "a.pdf", "b.pdf"]);
  });

  it("does not mutate the input array", () => {
    const nodes = [node({ name: "b" }), node({ name: "a" })];
    const copy = [...nodes];
    sortDriveNodes(nodes, "name", "asc");
    expect(nodes).toEqual(copy);
  });
});

describe("parseDriveSearch", () => {
  it("extracts free text", () => {
    expect(parseDriveSearch("quarterly report")).toEqual({ text: "quarterly report" });
  });

  it("maps type: operators to mime filters", () => {
    expect(parseDriveSearch("type:pdf")).toEqual({ mimeType: "application/pdf" });
    expect(parseDriveSearch("type:image")).toEqual({ mimeContains: "image/" });
    expect(parseDriveSearch("type:folder")).toEqual({ mimeType: DRIVE_FOLDER_MIME });
    // unknown type: falls back to free text
    expect(parseDriveSearch("type:widget")).toEqual({ text: "type:widget" });
  });

  it("resolves owner:me to the provided email, else keeps the literal", () => {
    expect(parseDriveSearch("owner:me", "a@b.com")).toEqual({ owner: "a@b.com" });
    expect(parseDriveSearch("owner:me")).toEqual({ owner: "me" });
    expect(parseDriveSearch("owner:carol@x.com")).toEqual({ owner: "carol@x.com" });
  });

  it("normalizes bare before:/after: dates to a datetime", () => {
    expect(parseDriveSearch("before:2024-05-01")).toEqual({ before: "2024-05-01T00:00:00" });
    expect(parseDriveSearch("after:2024-05-01T09:30:00")).toEqual({ after: "2024-05-01T09:30:00" });
  });

  it("handles is:starred and starred:true/false", () => {
    expect(parseDriveSearch("is:starred")).toEqual({ starred: true });
    expect(parseDriveSearch("starred:true")).toEqual({ starred: true });
    expect(parseDriveSearch("starred:false")).toEqual({ starred: false });
  });

  it("combines operators with residual free text", () => {
    expect(parseDriveSearch("budget type:sheet owner:me after:2024-01-01", "me@co.com")).toEqual({
      mimeContains: "spreadsheet",
      owner: "me@co.com",
      after: "2024-01-01T00:00:00",
      text: "budget",
    });
  });

  it("treats an unknown key:value as free text", () => {
    expect(parseDriveSearch("color:red")).toEqual({ text: "color:red" });
  });

  it("returns an empty object for a blank query", () => {
    expect(parseDriveSearch("   ")).toEqual({});
  });
});

describe("dedupeDriveActivity", () => {
  const e = (fileId: string, time: string, action: string): ActivityLike => ({ fileId, time, action });

  it("drops rows with the same (fileId, time, action), keeping the first seen", () => {
    const list = [
      e("f1", "t1", "edited"),
      e("f1", "t1", "edited"), // dup
      e("f1", "t2", "edited"), // different time
      e("f1", "t1", "trashed"), // different action
      e("f2", "t1", "edited"), // different file
    ];
    expect(dedupeDriveActivity(list)).toEqual([
      e("f1", "t1", "edited"),
      e("f1", "t2", "edited"),
      e("f1", "t1", "trashed"),
      e("f2", "t1", "edited"),
    ]);
  });

  it("preserves order and returns empty for empty input", () => {
    expect(dedupeDriveActivity([])).toEqual([]);
  });
});

describe("tags", () => {
  it("normalizeTag lowercases, trims, collapses spaces, strips commas, caps length", () => {
    expect(normalizeTag("  Work Stuff ")).toBe("work stuff");
    expect(normalizeTag("a,b")).toBe("a b");
    expect(normalizeTag("URGENT")).toBe("urgent");
    expect(normalizeTag("x".repeat(50)).length).toBe(MAX_TAG_LEN);
  });

  it("parseTags reads the CSV appProperty, deduping and dropping empties", () => {
    expect(parseTags({ appProperties: { [TAG_PROP_KEY]: "work,Work, urgent ,," } })).toEqual(["work", "urgent"]);
    expect(parseTags({})).toEqual([]);
    expect(parseTags({ appProperties: {} })).toEqual([]);
  });

  it("serializeTags normalizes, dedupes, and stays within the size budget", () => {
    expect(serializeTags(["Work", "work", "urgent"])).toBe("work,urgent");
    expect(serializeTags([])).toBe("");
    const many = Array.from({ length: 40 }, (_, i) => `tag${i}`);
    expect(serializeTags(many).length).toBeLessThanOrEqual(110);
  });

  it("parse/serialize round-trip is stable", () => {
    const csv = serializeTags(["Alpha", "beta", "beta", "Gamma"]);
    expect(parseTags({ appProperties: { [TAG_PROP_KEY]: csv } })).toEqual(["alpha", "beta", "gamma"]);
  });

  it("tagColorIndex is stable and within range", () => {
    expect(tagColorIndex("work", 8)).toBe(tagColorIndex("work", 8));
    expect(tagColorIndex("work", 8)).toBeGreaterThanOrEqual(0);
    expect(tagColorIndex("work", 8)).toBeLessThan(8);
    expect(tagColorIndex("", 8)).toBeGreaterThanOrEqual(0);
  });
});

describe("downloads / exports", () => {
  it("isNativeGoogleDoc flags Google-app files but not folders, shortcuts, or binary", () => {
    expect(isNativeGoogleDoc("application/vnd.google-apps.document")).toBe(true);
    expect(isNativeGoogleDoc("application/vnd.google-apps.spreadsheet")).toBe(true);
    expect(isNativeGoogleDoc(DRIVE_FOLDER_MIME)).toBe(false);
    expect(isNativeGoogleDoc("application/vnd.google-apps.shortcut")).toBe(false);
    expect(isNativeGoogleDoc("application/pdf")).toBe(false);
    expect(isNativeGoogleDoc(undefined)).toBe(false);
  });

  it("driveExportFormats returns targets for native docs and empty for binary/unknown", () => {
    const doc = driveExportFormats("application/vnd.google-apps.document");
    expect(doc.map((f) => f.ext)).toEqual(["pdf", "docx", "md", "txt"]);
    expect(driveExportFormats("application/vnd.google-apps.spreadsheet").some((f) => f.ext === "csv")).toBe(true);
    expect(driveExportFormats("application/pdf")).toEqual([]);
    expect(driveExportFormats(undefined)).toEqual([]);
    // every format has a non-empty label + a real mime target
    for (const f of doc) { expect(f.label).toBeTruthy(); expect(f.mimeType).toContain("/"); }
  });
});

describe("canGrantExpiry", () => {
  it("allows expiry only for user/group grants with a viewer/commenter/editor role", () => {
    expect(canGrantExpiry("user", "reader")).toBe(true);
    expect(canGrantExpiry("user", "commenter")).toBe(true);
    expect(canGrantExpiry("group", "writer")).toBe(true);
  });
  it("forbids expiry on link/domain grants regardless of role", () => {
    expect(canGrantExpiry("anyone", "reader")).toBe(false);
    expect(canGrantExpiry("domain", "writer")).toBe(false);
  });
  it("forbids expiry on manager/owner roles", () => {
    expect(canGrantExpiry("user", "owner")).toBe(false);
    expect(canGrantExpiry("user", "organizer")).toBe(false);
    expect(canGrantExpiry("user", "fileOrganizer")).toBe(false);
  });
  it("EXPIRY_ROLES holds exactly the three assignable roles", () => {
    expect([...EXPIRY_ROLES].sort()).toEqual(["commenter", "reader", "writer"]);
  });
});

describe("driveTextSource", () => {
  it("exports native Google docs to a text mime", () => {
    expect(driveTextSource("application/vnd.google-apps.document")).toEqual({ mode: "export", exportMime: "text/plain" });
    expect(driveTextSource("application/vnd.google-apps.presentation")).toEqual({ mode: "export", exportMime: "text/plain" });
    expect(driveTextSource("application/vnd.google-apps.spreadsheet")).toEqual({ mode: "export", exportMime: "text/csv" });
  });
  it("reads text-y binaries directly via media", () => {
    expect(driveTextSource("text/plain")).toEqual({ mode: "media" });
    expect(driveTextSource("text/markdown")).toEqual({ mode: "media" });
    expect(driveTextSource("application/json")).toEqual({ mode: "media" });
    expect(driveTextSource("application/xml")).toEqual({ mode: "media" });
  });
  it("returns null for types with no cheap text form", () => {
    expect(driveTextSource("application/pdf")).toBeNull();
    expect(driveTextSource("image/png")).toBeNull();
    expect(driveTextSource("application/vnd.google-apps.folder")).toBeNull();
    expect(driveTextSource("application/vnd.google-apps.drawing")).toBeNull();
    expect(driveTextSource(undefined)).toBeNull();
  });
  it("driveHasTextSource mirrors driveTextSource nullability", () => {
    expect(driveHasTextSource("application/vnd.google-apps.document")).toBe(true);
    expect(driveHasTextSource("text/csv")).toBe(true);
    expect(driveHasTextSource("application/pdf")).toBe(false);
    expect(driveHasTextSource(undefined)).toBe(false);
  });
});

describe("computeCleanupBuckets", () => {
  const NOW = Date.parse("2026-01-01T00:00:00Z");
  const daysAgo = (n: number) => new Date(NOW - n * 86400000).toISOString();
  const MB = 1024 * 1024;

  it("flags duplicates (keeping the newest) with correct reclaimable bytes", () => {
    const files = [
      { id: "a", name: "a.jpg", size: 100, md5Checksum: "x", modifiedTime: daysAgo(1) },
      { id: "b", name: "b.jpg", size: 100, md5Checksum: "x", modifiedTime: daysAgo(5) },
      { id: "c", name: "c.jpg", size: 100, md5Checksum: "x", modifiedTime: daysAgo(9) },
      { id: "solo", name: "solo.jpg", size: 100, md5Checksum: "y" },
    ];
    const dup = computeCleanupBuckets(files, { now: NOW }).find((b) => b.key === "duplicates")!;
    expect(dup.count).toBe(2); // two of the three are redundant
    expect(dup.bytes).toBe(200);
    expect(dup.fileIds).toEqual(["b", "c"]); // "a" (newest) is kept
  });

  it("flags stale files but never never-opened ones", () => {
    const files = [
      { id: "old", name: "old.txt", size: 10, viewedByMeTime: daysAgo(400) },
      { id: "recent", name: "recent.txt", size: 10, viewedByMeTime: daysAgo(30) },
      { id: "never", name: "never.txt", size: 10 }, // no viewedByMeTime -> left alone
    ];
    const buckets = computeCleanupBuckets(files, { now: NOW, staleDays: 365 });
    const stale = buckets.find((b) => b.key === "stale")!;
    expect(stale.fileIds).toEqual(["old"]);
  });

  it("flags large files over the threshold, biggest first", () => {
    const files = [
      { id: "big", name: "big.zip", size: 300 * MB },
      { id: "huge", name: "huge.mov", size: 900 * MB },
      { id: "small", name: "small.txt", size: 5 },
    ];
    const large = computeCleanupBuckets(files, { now: NOW, largeBytes: 100 * MB }).find((b) => b.key === "large")!;
    expect(large.fileIds).toEqual(["huge", "big"]);
    expect(large.count).toBe(2);
  });

  it("claims each file once (duplicates win over stale/large)", () => {
    const files = [
      { id: "keep", name: "k", size: 200 * MB, md5Checksum: "d", modifiedTime: daysAgo(1) },
      { id: "dupOldBig", name: "d", size: 200 * MB, md5Checksum: "d", modifiedTime: daysAgo(400), viewedByMeTime: daysAgo(400) },
    ];
    const buckets = computeCleanupBuckets(files, { now: NOW, largeBytes: 100 * MB, staleDays: 365 });
    expect(buckets.find((b) => b.key === "duplicates")!.fileIds).toEqual(["dupOldBig"]);
    // dupOldBig is claimed by duplicates, so it must NOT reappear under stale or large
    expect(buckets.find((b) => b.key === "stale")).toBeUndefined();
    const large = buckets.find((b) => b.key === "large");
    expect(large?.fileIds ?? []).not.toContain("dupOldBig");
    expect(large?.fileIds).toEqual(["keep"]); // the kept large file is still a legit large-file candidate
  });

  it("caps ids per bucket and marks capped", () => {
    const files = Array.from({ length: 10 }, (_, i) => ({ id: `f${i}`, name: `f${i}`, size: 200 * MB }));
    const large = computeCleanupBuckets(files, { now: NOW, largeBytes: 100 * MB, maxIdsPerBucket: 4 }).find((b) => b.key === "large")!;
    expect(large.fileIds).toHaveLength(4);
    expect(large.count).toBe(10);
    expect(large.capped).toBe(true);
  });

  it("returns no buckets for a clean drive", () => {
    expect(computeCleanupBuckets([{ id: "a", name: "a", size: 5, viewedByMeTime: daysAgo(1) }], { now: NOW })).toEqual([]);
  });
});
