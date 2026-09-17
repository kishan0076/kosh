import { API_BASE, ApiError } from "./api";

/* ── typed client for the Kosh /drive API (management calls only) ── */

async function dreq<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
    ...init,
  });
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    let code: string | undefined;
    let details: unknown;
    try {
      const body = await res.json();
      message = body?.error?.message ?? message;
      code = body?.error?.code;
      details = body?.error?.details;
    } catch {
      /* ignore */
    }
    throw new ApiError(message, code, details, res.status);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface DriveAccount {
  id: string;
  email: string;
  name?: string;
  picture?: string;
  scope: string;
  createdAt: string;
  lastUsedAt?: string;
}
export interface DriveFolder {
  id: string;
  name: string;
  modifiedTime?: string;
}
export interface DriveQuota {
  limit?: number;
  usage: number;
  usageInDrive: number;
  usageInDriveTrash: number;
}
export interface DriveDuplicate {
  name: string;
  matches: { id: string; name: string; size?: number; modifiedTime?: string; md5Checksum?: string }[];
}
export interface DriveUploadRecord {
  id: string;
  accountId: string;
  fileName: string;
  mimeType: string;
  size: number;
  driveFileId?: string;
  folderId?: string;
  folderPath?: string;
  webViewLink?: string;
  status: "completed" | "failed";
  error?: string;
  createdAt: string;
}

export const driveApi = {
  /** A full-page redirect to this URL starts the Google consent flow. */
  connectUrl: () => `${API_BASE}/drive/auth`,
  config: () => dreq<{ configured: boolean; scope: string; fullAccess: boolean }>("/drive/config"),
  listAccounts: () => dreq<{ accounts: DriveAccount[]; configured: boolean }>("/drive/accounts"),
  deleteAccount: (id: string) => dreq<{ ok: boolean }>(`/drive/accounts/${id}`, { method: "DELETE" }),
  mintToken: (id: string) => dreq<{ accessToken: string; expiresIn: number }>(`/drive/accounts/${id}/token`, { method: "POST" }),
  about: (id: string) => dreq<{ quota: DriveQuota }>(`/drive/accounts/${id}/about`),
  listFolders: (id: string, parent = "root") => dreq<{ folders: DriveFolder[] }>(`/drive/accounts/${id}/folders?parent=${encodeURIComponent(parent)}`),
  createFolder: (id: string, name: string, parentId = "root") =>
    dreq<{ folder: DriveFolder }>(`/drive/accounts/${id}/folders`, { method: "POST", body: JSON.stringify({ name, parentId }) }),
  duplicates: (id: string, folderId: string, names: string[]) =>
    dreq<{ duplicates: DriveDuplicate[] }>(`/drive/accounts/${id}/duplicates`, { method: "POST", body: JSON.stringify({ folderId, names }) }),
  listUploads: () => dreq<{ uploads: DriveUploadRecord[] }>("/drive/uploads"),
  recordUpload: (input: Omit<DriveUploadRecord, "id" | "createdAt">) =>
    dreq<{ upload: DriveUploadRecord }>("/drive/uploads", { method: "POST", body: JSON.stringify(input) }),
};

/* ── resumable direct upload: browser → Google (bytes never touch the API) ── */

const UPLOAD_INIT = "https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,webViewLink,md5Checksum";
// Chunk size must be a multiple of 256 KiB (Google requirement). 8 MiB balances throughput vs retry cost.
const CHUNK = 8 * 1024 * 1024;
const MAX_CHUNK_RETRIES = 5;

/** Thrown when a caller pauses mid-upload; carries the state needed to resume later. */
export class PausedError extends Error {
  constructor(public sessionUri: string, public uploaded: number) {
    super("paused");
    this.name = "PausedError";
  }
}
/** Thrown when a caller cancels an in-flight upload. */
export class CanceledError extends Error {
  constructor() {
    super("canceled");
    this.name = "CanceledError";
  }
}

export interface ResumableControl {
  paused: boolean;
  canceled: boolean;
}
export interface ResumableResult {
  id: string;
  name: string;
  size?: number;
  webViewLink?: string;
  md5Checksum?: string;
}
export interface ResumableOpts {
  accessToken: string;
  file: Blob;
  name: string;
  mimeType: string;
  folderId: string;
  control: ResumableControl;
  onProgress: (uploadedBytes: number) => void;
  /** Re-mint an access token if the current one expires mid-upload (401). */
  getFreshToken?: () => Promise<string>;
  /** Resume an interrupted upload instead of creating a new session. */
  resumeFrom?: { sessionUri: string; uploaded: number };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Create a resumable session and return its URI (read from the Location response header). */
async function createSession(opts: ResumableOpts, accessToken: string): Promise<string> {
  const res = await fetch(UPLOAD_INIT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json; charset=UTF-8",
      "X-Upload-Content-Type": opts.mimeType,
      "X-Upload-Content-Length": String(opts.file.size),
    },
    body: JSON.stringify({ name: opts.name, mimeType: opts.mimeType, parents: [opts.folderId] }),
  });
  if (res.status === 401) throw new ApiError("Google session expired.", "TOKEN_EXPIRED", undefined, 401);
  if (!res.ok) throw new ApiError(`Couldn't start the upload (${res.status}).`, "SESSION_FAILED", undefined, res.status);
  const uri = res.headers.get("location");
  if (!uri) throw new ApiError("Google didn't return an upload session. Check CORS / scopes.", "NO_SESSION");
  return uri;
}

interface ChunkOutcome {
  status: number;
  responseText: string;
  rangeEnd: number | null; // last byte Google acknowledged (from the Range header), for 308
}

/** PUT one chunk (or an offset query when body is empty) via XHR so we get upload progress. */
function putChunk(sessionUri: string, body: Blob | null, contentRange: string, onProgress: (loaded: number) => void, control: ResumableControl): Promise<ChunkOutcome> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", sessionUri);
    xhr.setRequestHeader("Content-Range", contentRange);
    if (body) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded); };
    xhr.onload = () => {
      const range = xhr.getResponseHeader("Range"); // e.g. "bytes=0-262143"
      const m = range?.match(/bytes=\d+-(\d+)/);
      resolve({ status: xhr.status, responseText: xhr.responseText, rangeEnd: m ? Number(m[1]) : null });
    };
    xhr.onerror = () => reject(new ApiError("Network error during upload."));
    xhr.ontimeout = () => reject(new ApiError("Upload timed out."));
    // Interrupt cleanly when paused/canceled between progress ticks.
    const iv = setInterval(() => {
      if (control.canceled || control.paused) {
        clearInterval(iv);
        xhr.abort();
        reject(control.canceled ? new CanceledError() : new ApiError("paused-abort", "PAUSED_ABORT"));
      }
    }, 200);
    xhr.onloadend = () => clearInterval(iv);
    xhr.send(body);
  });
}

/** Query how many bytes Google already has for a session (used on resume / after a retry). */
async function queryOffset(sessionUri: string, total: number, control: ResumableControl): Promise<{ done: boolean; result?: ResumableResult; uploaded: number }> {
  const out = await putChunk(sessionUri, null, `bytes */${total}`, () => {}, control);
  if (out.status === 200 || out.status === 201) return { done: true, result: JSON.parse(out.responseText) as ResumableResult, uploaded: total };
  if (out.status === 308) return { done: false, uploaded: out.rangeEnd != null ? out.rangeEnd + 1 : 0 };
  throw new ApiError(`Couldn't resume the upload (${out.status}).`, "RESUME_FAILED", undefined, out.status);
}

/**
 * Upload one file to Google Drive via the resumable protocol, reporting byte progress and honoring
 * pause/cancel between chunks. Retries transient failures (5xx/429/network) with backoff.
 */
export async function resumableUpload(opts: ResumableOpts): Promise<ResumableResult> {
  let accessToken = opts.accessToken;
  const total = opts.file.size;

  let sessionUri: string;
  let uploaded: number;
  if (opts.resumeFrom) {
    sessionUri = opts.resumeFrom.sessionUri;
    const q = await queryOffset(sessionUri, total, opts.control);
    if (q.done && q.result) return q.result;
    uploaded = q.uploaded;
  } else {
    sessionUri = await createSession(opts, accessToken);
    uploaded = 0;
  }
  opts.onProgress(uploaded);

  // Zero-byte files: finalize with a single empty PUT.
  if (total === 0) {
    const out = await putChunk(sessionUri, new Blob([]), "bytes */0", () => {}, opts.control);
    if (out.status === 200 || out.status === 201) return JSON.parse(out.responseText) as ResumableResult;
    throw new ApiError(`Upload failed (${out.status}).`, "UPLOAD_FAILED", undefined, out.status);
  }

  while (uploaded < total) {
    if (opts.control.canceled) throw new CanceledError();
    if (opts.control.paused) throw new PausedError(sessionUri, uploaded);

    const end = Math.min(uploaded + CHUNK, total);
    const chunk = opts.file.slice(uploaded, end);
    const range = `bytes ${uploaded}-${end - 1}/${total}`;
    const chunkStart = uploaded;

    let attempt = 0;
    for (;;) {
      try {
        const out = await putChunk(sessionUri, chunk, range, (loaded) => opts.onProgress(chunkStart + loaded), opts.control);
        if (out.status === 200 || out.status === 201) return JSON.parse(out.responseText) as ResumableResult;
        if (out.status === 308) {
          uploaded = out.rangeEnd != null ? out.rangeEnd + 1 : end;
          opts.onProgress(uploaded);
          break; // chunk accepted; move to the next one
        }
        if (out.status === 401 && opts.getFreshToken) {
          accessToken = await opts.getFreshToken(); // token expired mid-upload; refresh and re-query offset
          const q = await queryOffset(sessionUri, total, opts.control);
          if (q.done && q.result) return q.result;
          uploaded = q.uploaded;
          break;
        }
        if ((out.status === 429 || out.status >= 500) && attempt < MAX_CHUNK_RETRIES) {
          attempt++;
          await sleep(Math.min(1000 * 2 ** attempt, 16000));
          const q = await queryOffset(sessionUri, total, opts.control); // re-sync offset before retrying
          if (q.done && q.result) return q.result;
          uploaded = q.uploaded;
          break;
        }
        throw new ApiError(`Upload failed (${out.status}).`, "UPLOAD_FAILED", undefined, out.status);
      } catch (err) {
        if (err instanceof PausedError || err instanceof CanceledError) throw err;
        if (err instanceof ApiError && err.code === "PAUSED_ABORT") throw new PausedError(sessionUri, uploaded);
        if (attempt >= MAX_CHUNK_RETRIES) throw err;
        attempt++;
        await sleep(Math.min(1000 * 2 ** attempt, 16000));
        try {
          const q = await queryOffset(sessionUri, total, opts.control);
          if (q.done && q.result) return q.result;
          uploaded = q.uploaded;
          break;
        } catch (probe) {
          if (probe instanceof CanceledError || probe instanceof PausedError) throw probe;
          // fall through to retry the same chunk
        }
      }
    }
  }
  // Loop exited because uploaded === total but no 200 body was seen — confirm completion.
  const final = await queryOffset(sessionUri, total, opts.control);
  if (final.done && final.result) return final.result;
  throw new ApiError("Upload didn't finalize.", "UPLOAD_FAILED");
}
