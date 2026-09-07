// JSON file import/export that works in both the Tauri desktop app and the web
// build. Desktop uses the dialog + fs plugins (native pickers); the web build
// falls back to an <input type=file> read and a Blob download.

import { isTauri } from '@/lib/platform';


// Open a picker and return the chosen file's text contents, or null if cancelled.
export async function pickJsonFile(): Promise<string | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      multiple: false,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path || typeof path !== 'string') return null;
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(path);
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result ?? ''));
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

// Open a picker for a collection file — a Postman export (JSON), an OpenAPI /
// Swagger spec (just as often YAML), or a single Bruno request (.bru). Returns
// the file's text contents and its name (the extension is a hint the importer
// uses), or null if cancelled.
export async function pickCollectionFile(): Promise<{ name: string; text: string } | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({
      multiple: false,
      filters: [{ name: 'Collection, OpenAPI spec, or Bruno request', extensions: ['json', 'yaml', 'yml', 'bru'] }],
    });
    if (!path || typeof path !== 'string') return null;
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return { name: path.split(/[\\/]/).pop() ?? path, text: await readTextFile(path) };
  }

  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json,.yaml,.yml,application/yaml,text/yaml,.bru';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? '') });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

// Pick a CSV or JSON data file (for data-driven runs); returns its name + text.
// Reads through the webview's FileReader in both web and Tauri — unlike the fs
// plugin, this needs no path-scope permission, so any file the user picks works.
export function pickDataFile(): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.json,text/csv,application/json';
    input.style.display = 'none';
    document.body.appendChild(input);
    const cleanup = () => { input.remove(); };
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) { cleanup(); return resolve(null); }
      const reader = new FileReader();
      reader.onload = () => { cleanup(); resolve({ name: file.name, text: String(reader.result ?? '') }); };
      reader.onerror = () => { cleanup(); reject(new Error(`Could not read ${file.name}`)); };
      reader.readAsText(file);
    };
    // If the user cancels the dialog, there's no reliable event; the picker is
    // simply abandoned (the element is cleaned up on the next successful pick).
    input.click();
  });
}

// Save `text` to a .json file chosen by the user.
export async function saveJsonFile(suggestedName: string, text: string): Promise<void> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, text);
    return;
  }

  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
}

// Save arbitrary text to a file the user picks (no extension lock-in). Used to
// export a raw response body.
export async function saveTextFile(suggestedName: string, text: string): Promise<void> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: suggestedName });
    if (!path) return;
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, text);
    return;
  }

  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
}

// Write a file the caller produces in pieces, without ever holding the whole
// thing as one string. A Runner export over a 100k-row data file is hundreds
// of MB; `saveTextFile(name, chunks.join(''))` would need that entire result
// contiguous in memory (plus the pieces it was built from) before writing a
// single byte. Here the pieces are buffered only up to FLUSH_BYTES and then
// appended, so peak memory stays flat regardless of run size.
//
// Returns false when the user cancelled the picker, true once written.
// `onProgress` reports bytes written so a long export can show progress.
const FLUSH_BYTES = 4 * 1024 * 1024;

export async function saveStreamedTextFile(
  suggestedName: string,
  chunks: Iterable<string>,
  opts: { extensions?: string[]; filterName?: string; onProgress?: (bytes: number) => void } = {},
): Promise<boolean> {
  const { extensions, filterName = 'File', onProgress } = opts;

  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({
      defaultPath: suggestedName,
      filters: extensions ? [{ name: filterName, extensions }] : undefined,
    });
    if (!path) return false;
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');

    let buffer: string[] = [];
    let buffered = 0;
    let written = 0;
    let started = false;
    // The first write truncates; every later one appends. Batched at
    // FLUSH_BYTES rather than per chunk because each write is a Tauri IPC
    // round-trip — a few dozen large writes, not thousands of small ones.
    const flush = async () => {
      if (!buffered) return;
      const text = buffer.join('');
      buffer = [];
      buffered = 0;
      await writeTextFile(path, text, started ? { append: true } : undefined);
      started = true;
      written += text.length;
      onProgress?.(written);
    };

    for (const chunk of chunks) {
      buffer.push(chunk);
      buffered += chunk.length;
      if (buffered >= FLUSH_BYTES) await flush();
    }
    await flush();
    // An export with no chunks at all still has to create the file.
    if (!started) await writeTextFile(path, '');
    return true;
  }

  // Web: a Blob takes the array of pieces directly, so the browser
  // concatenates them itself instead of us building one giant JS string.
  const parts: string[] = [];
  let written = 0;
  for (const chunk of chunks) {
    parts.push(chunk);
    written += chunk.length;
    // Yield to the event loop periodically so building a very large export
    // doesn't lock the UI for its whole duration.
    if (parts.length % 500 === 0) {
      onProgress?.(written);
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  onProgress?.(written);
  const blob = new Blob(parts, { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

// Save raw bytes (given as base64) to a file the user picks. Used for binary
// responses — images, PDFs, archives — where the text path would corrupt them.
export async function saveBinaryFile(suggestedName: string, base64: string): Promise<void> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: suggestedName });
    if (!path) return;
    const { writeFile } = await import('@tauri-apps/plugin-fs');
    await writeFile(path, bytes);
    return;
  }

  const blob = new Blob([bytes], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
}
