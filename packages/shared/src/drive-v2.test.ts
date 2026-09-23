import { describe, it, expect } from "vitest";
import {
  driveKindOf,
  sortDriveNodes,
  parseDriveSearch,
  dedupeDriveActivity,
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
