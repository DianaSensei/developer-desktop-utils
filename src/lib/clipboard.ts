export async function copyToClipboard(text: string): Promise<void> {
  if (isTauri()) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// ── Image clipboard ──────────────────────────────────────────────────────────
// The WebView clipboard only speaks plain text reliably across platforms, so
// image read/write is routed through the Tauri clipboard plugin in the desktop
// app and falls back to the async Clipboard API (ClipboardItem) on the web.

async function blobFromSource(source: Blob | string): Promise<Blob> {
  if (typeof source !== 'string') return source;
  return (await fetch(source)).blob(); // handles data: URLs and blob: URLs
}

/** Decode an image blob to raw RGBA pixels + dimensions via an offscreen canvas. */
async function rgbaFromBlob(blob: Blob): Promise<{ data: Uint8Array; width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height);
    return { data: new Uint8Array(data.buffer), width, height };
  } finally {
    bitmap.close?.();
  }
}

/** Re-encode any image blob to PNG (broadest clipboard support on the web). */
async function reencodeToPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    ctx.drawImage(bitmap, 0, 0);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob failed'))), 'image/png')
    );
  } finally {
    bitmap.close?.();
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Copy an image (Blob or data/blob URL) to the system clipboard. */
export async function copyImageToClipboard(source: Blob | string): Promise<void> {
  const blob = await blobFromSource(source);
  if (isTauri()) {
    const { writeImage } = await import('@tauri-apps/plugin-clipboard-manager');
    const { Image } = await import('@tauri-apps/api/image');
    const { data, width, height } = await rgbaFromBlob(blob);
    const image = await Image.new(data, width, height);
    await writeImage(image);
  } else {
    const png = await reencodeToPng(blob);
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  }
}

/**
 * Read an image from the system clipboard, returning a PNG data URL, or `null`
 * when the clipboard holds no image (or access was denied).
 */
export async function readImageFromClipboard(): Promise<string | null> {
  if (isTauri()) {
    try {
      const { readImage } = await import('@tauri-apps/plugin-clipboard-manager');
      const image = await readImage();
      const rgba = await image.rgba();
      const { width, height } = await image.size();
      if (!width || !height) return null;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
      return canvas.toDataURL('image/png');
    } catch {
      return null; // no image on the clipboard, or read unavailable
    }
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'));
      if (type) return await blobToDataUrl(await item.getType(type));
    }
  } catch {
    // clipboard read blocked, unsupported, or no image — fall through
  }
  return null;
}
