import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor, within } from '@testing-library/react';
import { storageRemove } from '@/lib/persistentStore';

/** A deep link that would replace an installed plugin must say so, show
 *  where the new copy comes from, and need an explicit acknowledgement for a
 *  downgrade or a different source. */

const invokeMock = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...args: unknown[]) => invokeMock(...args) }));
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }));

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'plugin', id: 'demo', version: '1.0.0', sdk: '^1.0.0', entry: 'https://evil.example/b.mjs',
    integrity: 'a'.repeat(64), label: 'Demo', description: 'd', icon: 'puzzle', keywords: [], route: '/demo',
    permissions: ['clipboard:read'], commands: [], hosts: ['api.evil.example'], ...overrides,
  };
}

async function renderDialog(urls: string[]) {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  const { LocaleProvider } = await import('@/contexts/LocaleContext');
  const { ExtensionInstallDialog } = await import('@/components/ExtensionInstallDialog');
  return render(
    <LocaleProvider>
      <ExtensionInstallDialog urls={urls} open onOpenChange={() => {}} />
    </LocaleProvider>,
  );
}

afterEach(() => {
  cleanup();
  invokeMock.mockReset();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  storageRemove('devtool-locale');
});

describe('ExtensionInstallDialog — replacing an installed plugin', () => {
  it('shows the source and hosts, flags a downgrade from another source, and needs acknowledgement', async () => {
    const installed = {
      kind: 'plugin',
      manifest: manifest({ version: '2.5.0', entry: 'https://good.example/b.mjs', hosts: [] }),
      source_url: 'https://good.example/p.json',
      bundle_path: '/tmp/demo/2.5.0/bundle.mjs',
      installed_at: 0,
    };
    invokeMock.mockImplementation((command: string) => {
      switch (command) {
        case 'artifact_installer_fetch_manifest':
          return Promise.resolve(manifest());
        case 'artifact_installer_list':
          return Promise.resolve([installed]);
        default:
          return Promise.resolve(undefined);
      }
    });

    await renderDialog(['https://evil.example/p.json']);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText(/Source: evil\.example|Nguồn: evil\.example/)).toBeTruthy());
    expect(within(dialog).getByText(/Replaces the installed 2\.5\.0 \(from good\.example\)|Sẽ thay bản 2\.5\.0/)).toBeTruthy();
    expect(within(dialog).getByText(/OLDER version|CŨ HƠN/)).toBeTruthy();
    expect(within(dialog).getByText(/DIFFERENT source|nguồn KHÁC/)).toBeTruthy();
    expect(within(dialog).getByText(/^api\.evil\.example/).textContent).toMatch(/new|mới/);

    const install = within(dialog).getByRole('button', { name: /^Install$|^Cài đặt$/ }) as HTMLButtonElement;
    expect(install.disabled).toBe(true);
    fireEvent.click(within(dialog).getByRole('checkbox'));
    expect(install.disabled).toBe(false);
  });

  it('a first install needs no acknowledgement', async () => {
    invokeMock.mockImplementation((command: string) =>
      Promise.resolve(command === 'artifact_installer_fetch_manifest' ? manifest() : command === 'artifact_installer_list' ? [] : undefined),
    );
    await renderDialog(['https://evil.example/p.json']);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByText(/Source: evil\.example|Nguồn: evil\.example/)).toBeTruthy());
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect((within(dialog).getByRole('button', { name: /^Install$|^Cài đặt$/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
