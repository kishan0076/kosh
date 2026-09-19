import type { DragEvent } from "react";

/** Custom MIME marking an INTERNAL Drive-node drag (distinct from an external OS file drag). */
export const DRIVE_DND_MIME = "application/x-kosh-drive-ids";

export function setDragIds(e: DragEvent, ids: string[]): void {
  try {
    e.dataTransfer.setData(DRIVE_DND_MIME, JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  } catch {
    /* ignore */
  }
}

/** True during dragover/drop when this is our internal node drag (types are readable; data isn't, mid-drag). */
export function hasDriveDrag(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes(DRIVE_DND_MIME);
}

/** True when the OS is dragging real files (external upload). */
export function hasExternalFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes("Files");
}

/** Read the dragged node ids (only available on drop). */
export function getDragIds(e: DragEvent): string[] | null {
  try {
    const raw = e.dataTransfer.getData(DRIVE_DND_MIME);
    if (!raw) return null;
    const ids = JSON.parse(raw);
    return Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}
