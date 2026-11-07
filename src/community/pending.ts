/** A card sent from the editor, waiting for the composer on the community page. */

let pending: Blob | null = null;

export function setPendingImage(blob: Blob): void {
  pending = blob;
}

export function takePendingImage(): Blob | null {
  const blob = pending;
  pending = null;
  return blob;
}
