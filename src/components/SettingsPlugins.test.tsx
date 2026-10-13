import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { SettingsPlugins } from '@/components/SettingsPlugins';
import { FeatureProvider } from '@/contexts/FeatureContext';
import { LocaleProvider } from '@/contexts/LocaleContext';
import { ExtensionUpdateProvider } from '@/contexts/ExtensionUpdateContext';
import { PLUGINS, createPluginSdk, pluginAudit } from '@/platform';
import { storageRemove } from '@/lib/persistentStore';

/**
 * The permissions shown must be the real manifest permissions, and denied
 * calls must appear. The audit log starts collapsed, so tests that read it
 * call `openAuditLog()` first.
 */

function renderPanel() {
  return render(
    <LocaleProvider>
      <FeatureProvider>
        <ExtensionUpdateProvider>
          <SettingsPlugins />
        </ExtensionUpdateProvider>
      </FeatureProvider>
    </LocaleProvider>,
  );
}

function openAuditLog() {
  fireEvent.click(screen.getByRole('button', { name: /Show activity log|Hiện nhật ký/ }));
}

beforeEach(() => {
  pluginAudit.clear();
});

afterEach(() => {
  cleanup();
  pluginAudit.clear();
  storageRemove('devtool-locale');
  storageRemove('devtool-features');
});

describe('Settings — Plugins', () => {
  it('liệt kê mọi plugin của registry, kèm id', () => {
    renderPanel();
    for (const p of PLUGINS) {
      expect(screen.getAllByText(p.id).length, p.id).toBeGreaterThan(0);
    }
  });

  it('quyền hiển thị lấy thẳng từ manifest, không phải bảng chép tay', () => {
    const { container } = renderPanel();
    const apiClient = PLUGINS.find((p) => p.id === 'api-client')!;
    // Select by `data-plugin`: several plugins have 'storage'.
    const row = container.querySelector<HTMLElement>('[data-plugin="api-client"]')!;
    expect(row).toBeTruthy();
    for (const perm of apiClient.permissions) {
      expect(within(row).getByText(perm), perm).toBeTruthy();
    }
    expect(within(row).getByText(/mcp_/)).toBeTruthy();
  });

  it('nhật ký hoạt động đóng theo mặc định', () => {
    renderPanel();
    expect(screen.queryByPlaceholderText(/Search by tool id|Tìm theo id tool/)).toBeNull();
    expect(screen.getByRole('button', { name: /Show activity log|Hiện nhật ký/ })).toBeTruthy();
  });

  it('bấm mở thì hiện ô tìm kiếm và danh sách; lời gọi bị từ chối hiện kèm quyền còn thiếu', () => {
    const sdk = createPluginSdk({ ...PLUGINS[0], permissions: [], commands: [] });
    expect(() => sdk.storage.get('k')).toThrow();

    renderPanel();
    openAuditLog();

    expect(screen.getByPlaceholderText(/Search by tool id|Tìm theo id tool/)).toBeTruthy();
    // The denied cell and its row both match; one must name the permission.
    const denied = screen.getAllByText(/denied|bị từ chối/);
    expect(denied.some((el) => el.textContent?.includes('storage'))).toBe(true);
  });

  it('nhật ký rỗng thì nói rõ là rỗng thay vì để khoảng trắng', () => {
    renderPanel();
    openAuditLog();
    expect(screen.getByText(/No calls yet|Chưa có lời gọi/)).toBeTruthy();
  });

  it('tìm theo id tool lọc đúng dòng, xoá ô tìm kiếm thì hiện lại đủ', () => {
    const first = createPluginSdk({ ...PLUGINS[0], permissions: [], commands: [] });
    const second = createPluginSdk({ ...PLUGINS[1], permissions: [], commands: [] });
    expect(() => first.storage.get('k')).toThrow();
    expect(() => second.storage.get('k')).toThrow();

    renderPanel();
    openAuditLog();
    // The id also appears in the permission table, so expect more than one.
    expect(screen.getAllByText(PLUGINS[0].id).length).toBeGreaterThan(1);
    expect(screen.getAllByText(PLUGINS[1].id).length).toBeGreaterThan(1);

    fireEvent.change(screen.getByPlaceholderText(/Search by tool id|Tìm theo id tool/), {
      target: { value: PLUGINS[0].id },
    });
    // After filtering, PLUGINS[1].id loses its audit row but stays in the
    // permission table, so compare counts instead of absence.
    expect(screen.getAllByText(PLUGINS[0].id).length).toBeGreaterThan(1);
    expect(screen.getAllByText(PLUGINS[1].id).length).toBe(1);
  });

  it('từ khoá không khớp gì thì nói rõ, không để trắng danh sách', () => {
    const sdk = createPluginSdk({ ...PLUGINS[0], permissions: [], commands: [] });
    expect(() => sdk.storage.get('k')).toThrow();

    renderPanel();
    openAuditLog();
    fireEvent.change(screen.getByPlaceholderText(/Search by tool id|Tìm theo id tool/), {
      target: { value: 'khong-ton-tai' },
    });

    expect(screen.getByText(/No calls match|Không có lời gọi nào khớp/)).toBeTruthy();
  });
});
