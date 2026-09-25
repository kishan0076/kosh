import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the OAuth refresh so the cache can be exercised without hitting Google. The specifier resolves to
// the same module driveTokenCache imports ("./googleDrive.js" from src/integrations).
const refreshMock = vi.fn<(rt: string) => Promise<{ accessToken: string; expiresIn: number }>>();
vi.mock("./integrations/googleDrive.js", () => ({ refreshAccessToken: (rt: string) => refreshMock(rt) }));

const { accessTokenFor, invalidateAccessToken } = await import("./integrations/driveTokenCache.js");

afterEach(() => refreshMock.mockReset());

describe("driveTokenCache", () => {
  it("caches a minted token and reuses it across calls (one refresh)", async () => {
    refreshMock.mockResolvedValue({ accessToken: "tok-a", expiresIn: 3600 });
    expect(await accessTokenFor("acc-cache", "refresh-1")).toBe("tok-a");
    expect(await accessTokenFor("acc-cache", "refresh-1")).toBe("tok-a");
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("single-flights concurrent misses into a single refresh (no storm)", async () => {
    let resolve!: (v: { accessToken: string; expiresIn: number }) => void;
    refreshMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    const calls = [accessTokenFor("acc-sf", "r"), accessTokenFor("acc-sf", "r"), accessTokenFor("acc-sf", "r")];
    resolve({ accessToken: "tok-sf", expiresIn: 3600 });
    expect(await Promise.all(calls)).toEqual(["tok-sf", "tok-sf", "tok-sf"]);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("re-mints after invalidateAccessToken — the stale-token retry path", async () => {
    refreshMock
      .mockResolvedValueOnce({ accessToken: "tok-1", expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: "tok-2", expiresIn: 3600 });
    expect(await accessTokenFor("acc-inv", "r")).toBe("tok-1");
    invalidateAccessToken("acc-inv"); // what driveCall does on a stale-token 401 before retrying
    expect(await accessTokenFor("acc-inv", "r")).toBe("tok-2");
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("re-mints when the refresh token changes (account reconnected)", async () => {
    refreshMock
      .mockResolvedValueOnce({ accessToken: "old", expiresIn: 3600 })
      .mockResolvedValueOnce({ accessToken: "new", expiresIn: 3600 });
    expect(await accessTokenFor("acc-fp", "refresh-old")).toBe("old");
    expect(await accessTokenFor("acc-fp", "refresh-new")).toBe("new");
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });

  it("never caches a failed refresh — the next call retries", async () => {
    refreshMock
      .mockRejectedValueOnce(new Error("invalid_grant"))
      .mockResolvedValueOnce({ accessToken: "recovered", expiresIn: 3600 });
    await expect(accessTokenFor("acc-fail", "r")).rejects.toThrow(/invalid_grant/);
    expect(await accessTokenFor("acc-fail", "r")).toBe("recovered");
    expect(refreshMock).toHaveBeenCalledTimes(2);
  });
});
