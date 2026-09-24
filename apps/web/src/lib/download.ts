import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { isNative } from "@/lib/native";

/** Save a Blob to the user's device.
 *  Web: a transient object URL + anchor click (the browser's download UI).
 *  Native app: WebViews can't download `blob:` URLs, so write the bytes to the app's cache and hand
 *  them to the OS share sheet (Save to Files / Downloads / any app) instead. */
export function saveBlob(blob: Blob, filename: string): void {
  if (isNative) {
    void saveBlobNative(blob, filename || "download");
    return;
  }
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

async function saveBlobNative(blob: Blob, filename: string): Promise<void> {
  const data = await blobToBase64(blob);
  const { uri } = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
  await Share.share({ title: filename, url: uri });
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
