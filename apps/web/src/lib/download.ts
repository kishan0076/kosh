/** Save a Blob to the user's device via a transient object URL + anchor click. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the click has started the download before the URL is torn down.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
