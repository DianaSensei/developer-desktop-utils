import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

/**
 * `MCP_TOOL_IDS` (useMcpToolEnabled.ts) liệt kê Redis Client/Kafka Explorer/
 * RabbitMQ Client/Containers dù bốn tool này giờ là plugin CÀI THÊM, không
 * còn biên dịch sẵn — danh sách đó không tự biết cái nào ĐANG thật sự có mặt.
 * Không lọc theo registry (`TOOL_DEFS`) thì Settings → MCP hiện công tắc
 * bật/tắt cho một tool CHƯA cài, đổi công tắc đó không có tác dụng gì (không
 * có plugin nào để bật/tắt MCP access). Trong test này (không cài plugin nào
 * runtime) `TOOL_DEFS` chỉ chứa 26 tool biên dịch sẵn — đúng kịch bản người
 * dùng "chưa cài tool kafka" báo cáo.
 *
 * `isTauri` được đọc MỘT LẦN lúc `@/lib/platform` được nạp (mục MCP chỉ hiện
 * danh sách khi `isTauri` true, không phải bản web) — cùng cái bẫy đã ghi ở
 * `SettingsExtensionInstaller.test.tsx`. `vi.resetModules()` + gán
 * `__TAURI_INTERNALS__` TRƯỚC khi `import('@/components/Settings')` (qua
 * dynamic import, không phải import tĩnh ở đầu file — import tĩnh chạy
 * TRƯỚC cả thân test) là cách duy nhất để test này đọc đúng giá trị cần.
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

    // Chưa cài → không có trong TOOL_DEFS → nhãn hiển thị đáng ra sẽ rơi về
    // bare id (`?? id`) NẾU dòng đó vẫn hiện — khẳng định bare id đó không
    // xuất hiện ở đâu cả, tức dòng tương ứng không được render.
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
