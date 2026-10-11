import { describe, expect, it } from 'vitest';
import { ensureVendorUi } from '@/platform/installer';

describe('ensureVendorUi', () => {
  it('attaches the host UI kit to the vendor object once, before a plugin bundle runs', async () => {
    const vendor = {} as Window['__DEVTOOL_VENDOR__'];
    window.__DEVTOOL_VENDOR__ = vendor;
    await ensureVendorUi();
    const ui = vendor.ui!;
    // Design-system components + the UX hooks a plugin must not re-implement.
    expect(typeof ui.Button).toBe('object');
    expect(typeof ui.useQuickPaste).toBe('function');
    expect(typeof ui.useInputHistory).toBe('function');
    expect(typeof ui.useLocale).toBe('function');
    expect(typeof ui.cn).toBe('function');

    await ensureVendorUi();
    expect(vendor.ui).toBe(ui);
  });
});
