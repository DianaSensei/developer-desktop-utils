// JSON file import/export that works in both the Tauri desktop app and the web
// build. Desktop uses the dialog + fs plugins (native pickers); the web build
// falls back to an <input type=file> read and a Blob download.

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

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
