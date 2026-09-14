import { describe, expect, it } from 'vitest';
import { FileJson } from 'lucide-react';
import { definePlugin, satisfiesSdk, validateManifest } from '@/platform/manifest';
import { SDK_VERSION, type PluginManifest } from '@/platform/types';

const base: PluginManifest = definePlugin({
  id: 'demo',
  label: 'Demo',
  icon: FileJson,
  description: 'Plugin giả lập dùng cho test.',
  route: '/demo',
  order: 10,
  defaultEnabled: true,
  sdk: '^1.0.0',
  load: async () => () => null,
});

describe('satisfiesSdk', () => {
  it('chấp nhận khi SDK mới hơn trong cùng major', () => {
    expect(satisfiesSdk('^1.0.0', '1.0.0')).toBe(true);
    expect(satisfiesSdk('^1.0.0', '1.2.0')).toBe(true);
    expect(satisfiesSdk('^1.1.0', '1.1.5')).toBe(true);
  });

  it('từ chối khi SDK cũ hơn dải plugin yêu cầu', () => {
    expect(satisfiesSdk('^1.2.0', '1.1.9')).toBe(false);
    expect(satisfiesSdk('^1.0.1', '1.0.0')).toBe(false);
  });

  it('từ chối khác major — đó là ý nghĩa của caret', () => {
    expect(satisfiesSdk('^1.0.0', '2.0.0')).toBe(false);
    expect(satisfiesSdk('^2.0.0', '1.9.9')).toBe(false);
  });

  it('trong 0.x thì minor cũng phải khớp: trước 1.0 mỗi minor là một breaking change', () => {
    expect(satisfiesSdk('^0.3.0', '0.3.2')).toBe(true);
    expect(satisfiesSdk('^0.3.0', '0.4.0')).toBe(false);
  });

  it('từ chối dải không phải caret thay vì đoán ý', () => {
    for (const range of ['1.0.0', '>=1.0.0', '~1.0.0', '^1.0', 'latest', '']) {
      expect(satisfiesSdk(range), range).toBe(false);
    }
  });

  it('mọi manifest trong repo khai dải hợp lệ với SDK hiện tại', () => {
    expect(satisfiesSdk('^1.0.0', SDK_VERSION)).toBe(true);
  });
});

describe('validateManifest', () => {
  it('manifest hợp lệ không có lỗi nào', () => {
    expect(validateManifest(base)).toEqual([]);
  });

  it('id phải là kebab-case — nó vừa là khoá bật/tắt vừa là namespace storage', () => {
    for (const id of ['Demo', 'demo_tool', 'demo tool', '-demo', 'demo-', '']) {
      expect(validateManifest({ ...base, id }).join(), id).toMatch(/kebab-case/);
    }
    expect(validateManifest({ ...base, id: '2fa' })).toEqual([]);
  });

  it('route phải tuyệt đối', () => {
    expect(validateManifest({ ...base, route: 'demo' }).join()).toMatch(/tuyệt đối/);
  });

  it('bắt các trường bắt buộc bị thiếu', () => {
    expect(validateManifest({ ...base, label: '' }).join()).toMatch(/label/);
    expect(validateManifest({ ...base, description: '' }).join()).toMatch(/description/);
    expect(validateManifest({ ...base, order: 1.5 }).join()).toMatch(/order/);
    expect(validateManifest({ ...base, load: undefined as never }).join()).toMatch(/load/);
  });

  it('từ chối dải sdk không tương thích, kèm version hiện tại trong thông báo', () => {
    const errs = validateManifest({ ...base, sdk: '^99.0.0' });
    expect(errs.join()).toMatch(/không tương thích/);
    expect(errs.join()).toContain(SDK_VERSION);
  });

  it('từ chối quyền lạ', () => {
    expect(validateManifest({ ...base, permissions: ['filesystem' as never] }).join()).toMatch(/không hợp lệ/);
  });

  it('"native" và allowlist lệnh phải đi cùng nhau — quyền native không kèm allowlist là quyền vô hạn', () => {
    expect(validateManifest({ ...base, permissions: ['native'] }).join()).toMatch(/allowlist/);
    expect(validateManifest({ ...base, commands: ['redis_'] }).join()).toMatch(/thiếu quyền "native"/);
    expect(validateManifest({ ...base, permissions: ['native'], commands: ['redis_'] })).toEqual([]);
  });

  it('không ném với dữ liệu rác — registry cần loại plugin hỏng, không làm sập app', () => {
    expect(validateManifest(null).length).toBeGreaterThan(0);
    expect(validateManifest('nope').length).toBeGreaterThan(0);
    expect(validateManifest({}).length).toBeGreaterThan(0);
  });
});
