import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * `MCP_TOOL_IDS` includes tools that are now optional plugins. Settings → MCP
 * must only list tools in the registry (`TOOL_DEFS`); with no plugins
 * installed here, `TOOL_DEFS` holds only the built-in tools.
 *
 * The MCP section only lists tools when `isTauri` is true, and `isTauri` is
 * read at module load, so Settings is imported dynamically after setting
 * `__TAURI_INTERNALS__`.
 */

async function renderMcpSection() {
  vi.resetModules();
  (window as unknown as { __TAURI_INTERNALS__: unknown }).__TAURI_INTERNALS__ = {};
  const { MemoryRouter } = await import('react-router-dom');
  const { AppConfigProvider } = await import('@/contexts/AppConfigContext');
  const { LocaleProvider } = await import('@/contexts/LocaleContext');
  const { FeatureProvider } = await import('@/contexts/FeatureContext');
  const { OnboardingProvider } = await import('@/contexts/OnboardingContext');
  const { UpdateProvider } = await import('@/contexts/UpdateContext');
  const { ExtensionUpdateProvider } = await import('@/contexts/ExtensionUpdateContext');
  const { Settings } = await import('@/components/Settings');
  return render(
    <MemoryRouter initialEntries={[{ pathname: '/settings', state: { section: 'mcp' } }]}>
      <AppConfigProvider>
        <LocaleProvider>
          <FeatureProvider>
            <OnboardingProvider>
              <UpdateProvider>
                <ExtensionUpdateProvider>
                  <Settings />
                </ExtensionUpdateProvider>
              </UpdateProvider>
            </OnboardingProvider>
          </FeatureProvider>
        </LocaleProvider>
      </AppConfigProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  delete (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  vi.resetModules();
});

describe('Settings — MCP — danh sách bật/tắt theo tool CHỈ hiện tool đã đăng ký', () => {
  it('không hiện công tắc cho kafka-explorer/redis-client/rabbit-client/container-manager khi chưa cài', async () => {
    await renderMcpSection();

    // Not installed, so not in TOOL_DEFS; its row would fall back to the bare
    // id, which must not appear.
    expect(screen.queryByText('kafka-explorer')).toBeNull();
    expect(screen.queryByText('redis-client')).toBeNull();
    expect(screen.queryByText('rabbit-client')).toBeNull();
    expect(screen.queryByText('container-manager')).toBeNull();
  });

  it('vẫn hiện công tắc cho tool biên dịch sẵn (vd JSON Formatter, có mặt trong MCP_TOOL_IDS)', async () => {
    await renderMcpSection();

    expect(screen.getByText('JSON Formatter')).toBeTruthy();
  });
});
