import { describe, expect, it } from "vitest";
import {
  decryptFile,
  decryptedName,
  deriveFileKey,
  encryptFile,
  encryptedName,
  ENCRYPTED_EXT,
  isEncryptedFile,
  randomFileSalt,
} from "./filecrypt.js";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

describe("filecrypt", () => {
  it("round-trips plaintext through the KENC container", async () => {
    const salt = randomFileSalt();
    const key = await deriveFileKey("correct horse battery staple", salt);
    const plain = bytes("the treasure is buried under the old oak");
    const enc = await encryptFile(key, plain);

    expect(isEncryptedFile(enc)).toBe(true);
    expect(text(enc.subarray(0, 4))).toBe("KENC");
    // Ciphertext must not leak plaintext.
    expect(text(enc)).not.toContain("treasure");

    const back = await decryptFile(key, enc);
    expect(text(back)).toBe("the treasure is buried under the old oak");
  });

  it("handles empty files", async () => {
    const key = await deriveFileKey("pw", randomFileSalt());
    const enc = await encryptFile(key, new Uint8Array(0));
    expect(isEncryptedFile(enc)).toBe(true);
    expect((await decryptFile(key, enc)).length).toBe(0);
  });

  it("produces a fresh IV each time (distinct ciphertext for the same input)", async () => {
    const key = await deriveFileKey("pw", randomFileSalt());
    const plain = bytes("same input");
    const a = await encryptFile(key, plain);
    const b = await encryptFile(key, plain);
    expect(text(a)).not.toBe(text(b));
  });

  it("rejects the wrong key (GCM auth tag fails)", async () => {
    const salt = randomFileSalt();
    const good = await deriveFileKey("right", salt);
    const bad = await deriveFileKey("wrong", salt);
    const enc = await encryptFile(good, bytes("secret"));
    await expect(decryptFile(bad, enc)).rejects.toThrow();
  });

  it("rejects a different salt (different derived key)", async () => {
    const key1 = await deriveFileKey("pw", randomFileSalt());
    const key2 = await deriveFileKey("pw", randomFileSalt());
    const enc = await encryptFile(key1, bytes("secret"));
    await expect(decryptFile(key2, enc)).rejects.toThrow();
  });

  it("isEncryptedFile is false for plain bytes and refuses to decrypt them", async () => {
    const key = await deriveFileKey("pw", randomFileSalt());
    const notEnc = bytes("just a normal text file");
    expect(isEncryptedFile(notEnc)).toBe(false);
    expect(isEncryptedFile(new Uint8Array(3))).toBe(false); // too short for a header
    await expect(decryptFile(key, notEnc)).rejects.toThrow(/Not a Kosh-encrypted file/);
  });

  it("randomFileSalt yields distinct base64 salts", () => {
    const a = randomFileSalt();
    const b = randomFileSalt();
    expect(a).not.toBe(b);
    expect(() => atob(a)).not.toThrow();
  });

  it("name helpers add/strip the .kenc suffix idempotently", () => {
    expect(ENCRYPTED_EXT).toBe(".kenc");
    expect(encryptedName("report.pdf")).toBe("report.pdf.kenc");
    expect(encryptedName("report.pdf.kenc")).toBe("report.pdf.kenc"); // idempotent
    expect(decryptedName("report.pdf.kenc")).toBe("report.pdf");
    expect(decryptedName("report.pdf")).toBe("report.pdf"); // no-op when not encrypted
    expect(decryptedName(encryptedName("a.txt"))).toBe("a.txt"); // round-trip
  });
});
