/**
 * Writes text to the clipboard. In the Tauri desktop app this goes through the
 * Rust backend; in a plain browser it uses the Clipboard API.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (typeof window !== 'undefined' && '__TAURI_IPC__' in window) {
    const { writeText } = await import('@tauri-apps/api/clipboard');
    await writeText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}
