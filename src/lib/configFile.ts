// File dialogs for settings backup (configTransfer.ts). Shell code, not a
// plugin, so it calls the dialog and fs plugins directly instead of going
// through a plugin SDK (fileio.ts does the same thing for plugins, with their
// permission checks). A path the user picks in the dialog is added to the fs
// scope by the dialog plugin, so no wider fs permission is needed.
// On the web: a Blob download and an <input type=file>.

import { isTauri } from '@/lib/platform';

/** Asks where to save and writes `text`; false when the user cancelled. */
export async function saveConfigText(suggestedName: string, text: string): Promise<boolean> {
  if (isTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: suggestedName, filters: [{ name: 'DevTool settings', extensions: ['json'] }] });
    if (!path) return false;
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, text);
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = suggestedName;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

/** Lets the user pick a settings file; its name and text, or null. */
export async function pickConfigText(): Promise<{ name: string; text: string } | null> {
  if (isTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: false, filters: [{ name: 'DevTool settings', extensions: ['json'] }] });
    const path = Array.isArray(picked) ? picked[0] : picked;
    if (!path) return null;
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return { name: path.split(/[\\/]/).pop() ?? path, text: await readTextFile(path) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.onchange = () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? '') });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}
