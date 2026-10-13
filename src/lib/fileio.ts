// File import and export that works in Tauri and on the web: desktop uses
// the OS dialogs through `sdk.files`; the web falls back to
// `<input type=file>` and Blob downloads.
//
// Shared by several plugins (API Client, Data Converter, Generator, Color
// Picker, 2FA), so it lives in lib/. Every function takes the calling
// plugin's `sdk` so file access is checked and audited against that plugin,
// except `pickDataFile`, which uses the webview file input in every build
// and is neither permission-checked nor audited.

import { isTauri } from '@/lib/platform';
import type { PluginSdk } from '@/platform';


// Open a picker and return the chosen file's text contents, or null if cancelled.
export async function pickJsonFile(sdk: PluginSdk): Promise<string | null> {
  if (isTauri) {
    const picked = await sdk.files.pickOpen({ filters: [{ name: 'JSON', extensions: ['json'] }] });
    const path = picked?.[0];
    if (!path) return null;
    return sdk.files.readText(path);
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

// Picks a collection file: a Postman export (JSON), an OpenAPI/Swagger spec
// (often YAML), or a Bruno request (.bru). Returns its name and text, or
// null if cancelled.
export async function pickCollectionFile(sdk: PluginSdk): Promise<{ name: string; text: string } | null> {
  if (isTauri) {
    const picked = await sdk.files.pickOpen({
      filters: [{ name: 'Collection, OpenAPI spec, or Bruno request', extensions: ['json', 'yaml', 'yml', 'bru'] }],
    });
    const path = picked?.[0];
    if (!path) return null;
    return { name: path.split(/[\\/]/).pop() ?? path, text: await sdk.files.readText(path) };
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
    // A cancelled dialog fires no reliable event; the picker is just abandoned.
    input.click();
  });
}

// Save `text` to a .json file chosen by the user.
export async function saveJsonFile(sdk: PluginSdk, suggestedName: string, text: string): Promise<void> {
  if (isTauri) {
    const path = await sdk.files.pickSave({
      defaultPath: suggestedName,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (!path) return;
    await sdk.files.writeText(path, text);
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
export async function saveTextFile(sdk: PluginSdk, suggestedName: string, text: string): Promise<void> {
  if (isTauri) {
    const path = await sdk.files.pickSave({ defaultPath: suggestedName });
    if (!path) return;
    await sdk.files.writeText(path, text);
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

// Writes a file produced in chunks without holding it as one string (a
// Runner export can be hundreds of MB). Chunks are buffered up to
// FLUSH_BYTES and appended, so memory stays flat.
//
// Returns false if the picker was cancelled. `onProgress` reports bytes
// written.
const FLUSH_BYTES = 4 * 1024 * 1024;

export async function saveStreamedTextFile(
  sdk: PluginSdk,
  suggestedName: string,
  chunks: Iterable<string>,
  opts: { extensions?: string[]; filterName?: string; onProgress?: (bytes: number) => void } = {},
): Promise<boolean> {
  const { extensions, filterName = 'File', onProgress } = opts;

  if (isTauri) {
    const path = await sdk.files.pickSave({
      defaultPath: suggestedName,
      filters: extensions ? [{ name: filterName, extensions }] : undefined,
    });
    if (!path) return false;

    let buffer: string[] = [];
    let buffered = 0;
    let written = 0;
    let started = false;
    // The first write truncates and later ones append. Batched because
    // each write is an IPC round trip.
    const flush = async () => {
      if (!buffered) return;
      const text = buffer.join('');
      buffer = [];
      buffered = 0;
      await sdk.files.writeText(path, text, started ? { append: true } : undefined);
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
    if (!started) await sdk.files.writeText(path, '');
    return true;
  }

  // Web: a Blob accepts the pieces directly, so no giant string is built.
  const parts: string[] = [];
  let written = 0;
  for (const chunk of chunks) {
    parts.push(chunk);
    written += chunk.length;
    // Yield periodically so a large export does not freeze the UI.
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

// Saves bytes (given as base64) for binary responses such as images, PDFs
// and archives.
export async function saveBinaryFile(sdk: PluginSdk, suggestedName: string, base64: string): Promise<void> {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);

  if (isTauri) {
    const path = await sdk.files.pickSave({ defaultPath: suggestedName });
    if (!path) return;
    await sdk.files.writeBytes(path, bytes);
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
