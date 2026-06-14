export async function copyToClipboard(text: string): Promise<void> {
  if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager');
    await writeText(text);
  } else {
    await navigator.clipboard.writeText(text);
  }
}
