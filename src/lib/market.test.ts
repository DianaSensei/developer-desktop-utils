import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  addCustomMarket,
  fetchMarketCatalog,
  getSelectedMarketId,
  listMarkets,
  removeCustomMarket,
  setSelectedMarketId,
} from '@/lib/market';
import { storageRemove } from '@/lib/persistentStore';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

beforeEach(() => {
  storageRemove('devtool-markets-custom');
  storageRemove('devtool-market-selected');
});

afterEach(() => {
  storageRemove('devtool-markets-custom');
  storageRemove('devtool-market-selected');
  vi.unstubAllGlobals();
});

describe('listMarkets', () => {
  it('luôn có market chính thức, kể cả chưa thêm gì', () => {
    const markets = listMarkets();
    expect(markets).toHaveLength(1);
    expect(markets[0].builtin).toBe(true);
  });

  it('market builtin đứng trước, market tự thêm theo sau', () => {
    addCustomMarket('Nội bộ', 'https://example.com/catalog.json');
    const markets = listMarkets();
    expect(markets).toHaveLength(2);
    expect(markets[0].builtin).toBe(true);
    expect(markets[1]).toMatchObject({ label: 'Nội bộ', catalogUrl: 'https://example.com/catalog.json', builtin: false });
  });
});

describe('addCustomMarket / removeCustomMarket', () => {
  it('mỗi market tự thêm có id riêng, xoá đúng market không đụng market khác', () => {
    const a = addCustomMarket('A', 'https://a.example.com/catalog.json');
    const b = addCustomMarket('B', 'https://b.example.com/catalog.json');
    expect(a.id).not.toBe(b.id);
    expect(listMarkets()).toHaveLength(3);

    removeCustomMarket(a.id);
    const remaining = listMarkets();
    expect(remaining).toHaveLength(2);
    expect(remaining.some((m) => m.id === b.id)).toBe(true);
  });

  it('xoá market builtin không có tác dụng (removeCustomMarket chỉ nhắm market tự thêm)', () => {
    const builtinId = listMarkets()[0].id;
    removeCustomMarket(builtinId);
    expect(listMarkets()).toHaveLength(1);
  });
});

describe('getSelectedMarketId / setSelectedMarketId', () => {
  it('chưa chọn gì thì rơi về market builtin đầu tiên', () => {
    expect(getSelectedMarketId()).toBe(listMarkets()[0].id);
  });

  it('nhớ đúng market đã chọn', () => {
    const custom = addCustomMarket('A', 'https://a.example.com/catalog.json');
    setSelectedMarketId(custom.id);
    expect(getSelectedMarketId()).toBe(custom.id);
  });

  it('market đã chọn bị xoá thì tự rơi về builtin thay vì trả về id không còn tồn tại', () => {
    const custom = addCustomMarket('A', 'https://a.example.com/catalog.json');
    setSelectedMarketId(custom.id);
    removeCustomMarket(custom.id);
    expect(getSelectedMarketId()).toBe(listMarkets()[0].id);
  });
});

describe('fetchMarketCatalog', () => {
  it('parse đúng mảng plugins hợp lệ', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          plugins: [
            {
              id: 'demo',
              label: 'Demo',
              description: 'A demo plugin',
              version: '1.0.0',
              keywords: ['demo'],
              pluginManifestUrl: 'https://example.com/demo-plugin.json',
              serviceManifestUrl: 'https://example.com/demo-service.json',
              targets: ['aarch64-apple-darwin'],
            },
          ],
        }),
      ),
    );

    const plugins = await fetchMarketCatalog('https://example.com/catalog.json');
    expect(plugins).toEqual([
      {
        id: 'demo',
        label: 'Demo',
        description: 'A demo plugin',
        version: '1.0.0',
        keywords: ['demo'],
        pluginManifestUrl: 'https://example.com/demo-plugin.json',
        serviceManifestUrl: 'https://example.com/demo-service.json',
        targets: ['aarch64-apple-darwin'],
      },
    ]);
  });

  it('bỏ qua từng mục sai hình dạng thay vì ném lỗi cho cả catalog', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse({
          plugins: [
            { id: 'ok', label: 'OK', description: 'd', version: '1.0.0', pluginManifestUrl: 'https://example.com/ok.json' },
            { id: 'broken' }, // thiếu label/description/version/pluginManifestUrl
          ],
        }),
      ),
    );

    const plugins = await fetchMarketCatalog('https://example.com/catalog.json');
    expect(plugins).toHaveLength(1);
    expect(plugins[0].id).toBe('ok');
  });

  it('ném lỗi rõ ràng khi HTTP lỗi', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, false, 404)));
    await expect(fetchMarketCatalog('https://example.com/catalog.json')).rejects.toThrow('HTTP 404');
  });

  it('ném lỗi rõ ràng khi JSON không có mảng "plugins"', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ notPlugins: [] })));
    await expect(fetchMarketCatalog('https://example.com/catalog.json')).rejects.toThrow('plugins');
  });
});
