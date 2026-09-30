import { describe, expect, it } from "vitest";
import {
  buildCopyPlan,
  DEST_ROOT,
  detectDuplicates,
  fileSignature,
  parseDriveLink,
  parseDriveLinks,
  suffixName,
  summarizeImportTree,
  type ImportTree,
  type ScanFileLite,
} from "./driveImport.js";

describe("parseDriveLink", () => {
  it("parses a folder share URL", () => {
    expect(parseDriveLink("https://drive.google.com/drive/folders/1AbC_def-GHI")).toEqual({
      id: "1AbC_def-GHI",
      kind: "folder",
      raw: "https://drive.google.com/drive/folders/1AbC_def-GHI",
    });
  });

  it("parses a folder URL with a user index (/u/0/)", () => {
    const r = parseDriveLink("https://drive.google.com/drive/u/0/folders/FOLDER123456");
    expect(r).toMatchObject({ id: "FOLDER123456", kind: "folder" });
  });

  it("parses a /file/d/ID/view link as a file", () => {
    const r = parseDriveLink("https://drive.google.com/file/d/FILEID_98765/view?usp=sharing");
    expect(r).toMatchObject({ id: "FILEID_98765", kind: "file" });
  });

  it("parses native Google-doc URLs as files", () => {
    expect(parseDriveLink("https://docs.google.com/document/d/DOC_1234567/edit")).toMatchObject({ id: "DOC_1234567", kind: "file" });
    expect(parseDriveLink("https://docs.google.com/spreadsheets/d/SHEET_123456/edit#gid=0")).toMatchObject({ id: "SHEET_123456", kind: "file" });
    expect(parseDriveLink("https://docs.google.com/presentation/d/SLIDE_123456/edit")).toMatchObject({ id: "SLIDE_123456", kind: "file" });
  });

  it("parses open?id= and uc?id= as unknown-kind ids", () => {
    expect(parseDriveLink("https://drive.google.com/open?id=OPEN_1234567")).toMatchObject({ id: "OPEN_1234567", kind: "unknown" });
    expect(parseDriveLink("https://drive.google.com/uc?id=UC_12345678&export=download")).toMatchObject({ id: "UC_12345678", kind: "unknown" });
  });

  it("accepts a bare id (kind unknown)", () => {
    expect(parseDriveLink("1a2b3c4d5e6f7g")).toEqual({ id: "1a2b3c4d5e6f7g", kind: "unknown", raw: "1a2b3c4d5e6f7g" });
  });

  it("rejects non-Drive URLs and short/garbage tokens", () => {
    expect(parseDriveLink("https://example.com/file/d/abc/view")).toBeNull();
    expect(parseDriveLink("hello")).toBeNull();
    expect(parseDriveLink("")).toBeNull();
    expect(parseDriveLink("   ")).toBeNull();
  });

  it("salvages an id from a pasted path fragment without a protocol", () => {
    expect(parseDriveLink("drive/folders/FRAGMENT_1234")).toMatchObject({ id: "FRAGMENT_1234", kind: "folder" });
  });
});

describe("parseDriveLinks", () => {
  it("splits on newlines/commas/spaces and dedupes by id, preserving order", () => {
    const text = `
      https://drive.google.com/drive/folders/AAA_1234567
      https://drive.google.com/file/d/BBB_1234567/view , https://drive.google.com/open?id=AAA_1234567
      garbage-not-a-link
    `;
    const refs = parseDriveLinks(text);
    expect(refs.map((r) => r.id)).toEqual(["AAA_1234567", "BBB_1234567"]); // AAA seen once, garbage dropped
    expect(refs[0]!.kind).toBe("folder");
    expect(refs[1]!.kind).toBe("file");
  });

  it("returns [] for empty / all-garbage input", () => {
    expect(parseDriveLinks("")).toEqual([]);
    expect(parseDriveLinks("just some words here")).toEqual([]);
  });
});

describe("fileSignature", () => {
  it("uses md5 when present (name-independent content identity)", () => {
    const a: ScanFileLite = { id: "1", name: "a.png", md5Checksum: "deadbeef", size: 10 };
    const b: ScanFileLite = { id: "2", name: "renamed.png", md5Checksum: "deadbeef", size: 10 };
    expect(fileSignature(a)).toBe(fileSignature(b)); // same content, different name → same signature
    expect(fileSignature(a)).toBe("md5:deadbeef");
  });

  it("falls back to name|mime|size for native docs (no md5)", () => {
    const doc: ScanFileLite = { id: "3", name: "Plan", mimeType: "application/vnd.google-apps.document" };
    expect(fileSignature(doc)).toBe("nm:plan|application/vnd.google-apps.document|");
  });
});

describe("detectDuplicates", () => {
  const files: ScanFileLite[] = [
    { id: "f1", name: "keep.pdf", md5Checksum: "h1", size: 100 },
    { id: "f2", name: "already-have.pdf", md5Checksum: "hDEST", size: 200 },
    { id: "f3", name: "dup-of-f1.pdf", md5Checksum: "h1", size: 100 }, // same content as f1 → dupInSource
    { id: "f4", name: "Notes", mimeType: "application/vnd.google-apps.document" }, // native doc, no md5
  ];

  it("classifies dest duplicates, intra-source duplicates, and new files", () => {
    const dest = new Set(["md5:hDEST"]);
    const r = detectDuplicates(files, dest);
    expect(r.statusById).toEqual({ f1: "new", f2: "dupInDest", f3: "dupInSource", f4: "new" });
    expect(r.counts).toEqual({ new: 2, dupInDest: 1, dupInSource: 1 });
    expect(r.bytes).toEqual({ new: 100, dupInDest: 200, dupInSource: 100 });
  });

  it("dest match takes precedence over an intra-source repeat", () => {
    const dupInBoth: ScanFileLite[] = [
      { id: "a", name: "x", md5Checksum: "hX", size: 1 },
      { id: "b", name: "x", md5Checksum: "hX", size: 1 },
    ];
    const r = detectDuplicates(dupInBoth, ["md5:hX"]);
    expect(r.statusById).toEqual({ a: "dupInDest", b: "dupInDest" }); // both in dest, neither dupInSource
  });

  it("accepts a plain iterable of signatures (not just a Set)", () => {
    const r = detectDuplicates([{ id: "z", name: "z", md5Checksum: "hZ" }], ["md5:hZ"]);
    expect(r.statusById.z).toBe("dupInDest");
  });
});

describe("suffixName", () => {
  it("inserts the suffix before the extension", () => {
    expect(suffixName("report.pdf")).toBe("report (copy).pdf");
    expect(suffixName("archive.tar.gz")).toBe("archive.tar (copy).gz");
  });
  it("appends when there is no extension", () => {
    expect(suffixName("Notes")).toBe("Notes (copy)");
    expect(suffixName(".gitignore")).toBe(".gitignore (copy)"); // leading dot isn't an extension
  });
});

describe("buildCopyPlan", () => {
  // tree: root file r.txt (root-level) + folder A > (a.txt, folder B > b.txt)
  const tree: ImportTree = {
    folders: [
      { id: "B", name: "B", parentId: "A" },
      { id: "A", name: "A" }, // root-level folder (no parentId)
    ],
    files: [
      { id: "b", name: "b.txt", parentId: "B", md5Checksum: "hb", size: 3 },
      { id: "a", name: "a.txt", parentId: "A", md5Checksum: "ha", size: 2 },
      { id: "r", name: "r.txt", md5Checksum: "hr", size: 1 }, // root-level file
    ],
  };

  it("orders folders parents-before-children and maps parent refs", () => {
    const dedup = detectDuplicates(tree.files, []);
    const plan = buildCopyPlan({ tree, dedup, strategy: "skip" });
    // A (depth 0) before B (depth 1)
    expect(plan.folders.map((f) => f.sourceId)).toEqual(["A", "B"]);
    const A = plan.folders.find((f) => f.sourceId === "A")!;
    const B = plan.folders.find((f) => f.sourceId === "B")!;
    expect(A.parentRef).toBe(DEST_ROOT); // root-level folder attaches to the destination
    expect(B.parentRef).toBe(A.ref); // nested folder attaches to A's placeholder ref
  });

  it("places files under the right parent ref (root-level → DEST_ROOT)", () => {
    const dedup = detectDuplicates(tree.files, []);
    const plan = buildCopyPlan({ tree, dedup, strategy: "skip" });
    const byId = Object.fromEntries(plan.copies.map((c) => [c.sourceId, c]));
    expect(byId.r!.parentRef).toBe(DEST_ROOT);
    expect(byId.a!.parentRef).toBe("f:A");
    expect(byId.b!.parentRef).toBe("f:B");
    expect(plan.stats).toEqual({ foldersToCreate: 2, filesToCopy: 3, filesSkipped: 0, bytesToCopy: 6 });
  });

  it("skips destination duplicates under the 'skip' strategy and prunes now-empty folders", () => {
    // b.txt already in dest → its folder B has no surviving files → B is pruned.
    const dedup = detectDuplicates(tree.files, ["md5:hb"]);
    const plan = buildCopyPlan({ tree, dedup, strategy: "skip" });
    expect(plan.copies.find((c) => c.sourceId === "b")!.skipped).toBe(true);
    expect(plan.folders.map((f) => f.sourceId)).toEqual(["A"]); // B pruned, A kept (still has a.txt)
    expect(plan.stats).toEqual({ foldersToCreate: 1, filesToCopy: 2, filesSkipped: 1, bytesToCopy: 3 });
  });

  it("keeps empty folders when pruneEmptyFolders is false", () => {
    const dedup = detectDuplicates(tree.files, ["md5:hb"]);
    const plan = buildCopyPlan({ tree, dedup, strategy: "skip", pruneEmptyFolders: false });
    expect(plan.folders.map((f) => f.sourceId)).toEqual(["A", "B"]);
  });

  it("'copy' strategy copies duplicates with the same name", () => {
    const dedup = detectDuplicates(tree.files, ["md5:hb"]);
    const plan = buildCopyPlan({ tree, dedup, strategy: "copy" });
    const b = plan.copies.find((c) => c.sourceId === "b")!;
    expect(b.skipped).toBe(false);
    expect(b.name).toBe("b.txt"); // same name preserved
    expect(plan.stats.filesToCopy).toBe(3);
  });

  it("'rename' strategy keeps both by suffixing the duplicate's name", () => {
    const dedup = detectDuplicates(tree.files, ["md5:hb"]);
    const plan = buildCopyPlan({ tree, dedup, strategy: "rename" });
    const b = plan.copies.find((c) => c.sourceId === "b")!;
    expect(b.skipped).toBe(false);
    expect(b.name).toBe("b (copy).txt");
  });

  it("per-file overrides win over the strategy", () => {
    const dedup = detectDuplicates(tree.files, ["md5:hb", "md5:ha"]); // a and b both dups
    const plan = buildCopyPlan({ tree, dedup, strategy: "skip", overrides: { a: "copy" } });
    expect(plan.copies.find((c) => c.sourceId === "a")!.skipped).toBe(false); // overridden to copy
    expect(plan.copies.find((c) => c.sourceId === "b")!.skipped).toBe(true); // strategy default
  });

  it("is stable against a folder-parent cycle (never loops)", () => {
    const cyclic: ImportTree = {
      folders: [
        { id: "X", name: "X", parentId: "Y" },
        { id: "Y", name: "Y", parentId: "X" },
      ],
      files: [{ id: "fx", name: "fx", parentId: "X", md5Checksum: "hx" }],
    };
    const dedup = detectDuplicates(cyclic.files, []);
    const plan = buildCopyPlan({ tree: cyclic, dedup, strategy: "skip" });
    expect(plan.folders).toHaveLength(2); // both retained, no infinite loop
    expect(plan.copies).toHaveLength(1);
  });
});

describe("summarizeImportTree", () => {
  it("rolls up folder/file counts and total bytes", () => {
    const tree: ImportTree = {
      folders: [{ id: "A", name: "A" }],
      files: [
        { id: "a", name: "a", size: 10 },
        { id: "b", name: "b", size: 5 },
        { id: "c", name: "c" }, // no size
      ],
    };
    expect(summarizeImportTree(tree)).toEqual({ folderCount: 1, fileCount: 3, totalBytes: 15 });
  });
});
