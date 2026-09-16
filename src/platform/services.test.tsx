import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, renderHook } from '@testing-library/react';
import { AppConfigProvider } from '@/contexts/AppConfigContext';
import { useLiveConnections } from '@/lib/liveConnections';
import { createPluginSdk, getPlugin } from '@/platform';
import { useLiveConnection, usePluginConfig, usePluginMcpBridgeActive } from '@/platform/services';
import { storageRemove } from '@/lib/persistentStore';

const apiClient = createPluginSdk(getPlugin('api-client')!);
// 'qrcode' cố tình nằm ngoài MCP_TOOL_IDS — 'json' thì CÓ trong đó.
const qrcode = createPluginSdk(getPlugin('qrcode')!);

afterEach(() => {
  cleanup();
  storageRemove('devtool-mcp-background-bridge');
  storageRemove('devtool-mcp-tools');
});

describe('usePluginConfig', () => {
  it('trả về cấu hình app, chỉ đọc', () => {
    const { result } = renderHook(() => usePluginConfig(), {
      wrapper: ({ children }) => <AppConfigProvider>{children}</AppConfigProvider>,
    });
    expect(result.current.editor.historyDebounceMs).toBeTypeOf('number');
  });
});

describe('useLiveConnection', () => {
  it('lấy id từ SDK, không phải từ chuỗi viết tay', () => {
    function Probe({ connected }: { connected: boolean }) {
      useLiveConnection(apiClient, connected);
      return null;
    }
    function Readout() {
      return <span data-testid="live">{useLiveConnections().join(',')}</span>;
    }

    const { rerender, getByTestId } = render(
      <>
        <Probe connected />
        <Readout />
      </>,
    );
    expect(getByTestId('live').textContent).toContain('api-client');

    rerender(
      <>
        <Probe connected={false} />
        <Readout />
      </>,
    );
    expect(getByTestId('live').textContent).not.toContain('api-client');
  });

  it('KHÔNG tắt cờ khi unmount — kết nối sống ở phía Rust, không ở component', () => {
    function Probe() {
      useLiveConnection(apiClient, true);
      return null;
    }
    const view = render(<Probe />);
    view.unmount();

    const { result } = renderHook(() => useLiveConnections());
    expect(result.current).toContain('api-client');

    // dọn lại cho ca sau
    render(<ProbeOff />);
    function ProbeOff() {
      useLiveConnection(apiClient, false);
      return null;
    }
  });
});

describe('usePluginMcpBridgeActive', () => {
  it('plugin không có mặt trong danh sách MCP thì luôn false', () => {
    const { result } = renderHook(() => usePluginMcpBridgeActive(qrcode));
    expect(result.current).toBe(false);
  });

  it('tool có MCP thì mặc định bật, vì bridge nền mặc định tắt', () => {
    const { result } = renderHook(() => usePluginMcpBridgeActive(apiClient));
    expect(result.current).toBe(true);
  });
});
