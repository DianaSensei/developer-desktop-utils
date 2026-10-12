import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  typeName, rcodeName, queryDns, queryAllRecords, checkPropagation, checkDnssec,
  lookupIp, getLocalNetworkInfo, listListeningPorts, localNetworkInfo,
  DOH_PROVIDERS, ALL_RECORD_TYPES,
} from '@/lib/network';

/**
 * Tests result handling rather than the requests: merging records, stable
 * ordering, provider fallback, and when everything counts as failed.
 */

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as Response;
}

describe('typeName / rcodeName', () => {
  it('ánh xạ mã số RR quen thuộc, và trả lại chính mã số cho mã lạ', () => {
    expect(typeName(1)).toBe('A');
    expect(typeName(28)).toBe('AAAA');
    expect(typeName(257)).toBe('CAA');
    expect(typeName(9999)).toBe('9999');
  });

  it('ánh xạ RCODE quen thuộc, và gắn nhãn "RCODE N" cho mã lạ', () => {
    expect(rcodeName(0)).toBe('NOERROR');
    expect(rcodeName(3)).toBe('NXDOMAIN');
    expect(rcodeName(99)).toBe('RCODE 99');
  });
});

describe('queryDns', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('map Answer/Authority thô sang DnsAnswer có typeName, và cờ AD', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      Status: 0,
      AD: true,
      Answer: [{ name: 'example.com.', type: 1, TTL: 300, data: '93.184.216.34' }],
      Authority: [{ name: 'example.com.', type: 2, TTL: 3600, data: 'a.iana-servers.net.' }],
    }));
    const result = await queryDns('example.com', 'A');
    expect(result).toEqual({
      status: 0,
      statusName: 'NOERROR',
      ad: true,
      answers: [{ name: 'example.com.', type: 1, typeName: 'A', ttl: 300, data: '93.184.216.34' }],
      authority: [{ name: 'example.com.', type: 2, typeName: 'NS', ttl: 3600, data: 'a.iana-servers.net.' }],
    });
  });

  it('thiếu Answer/Authority thì trả mảng rỗng, không throw', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ Status: 3 }));
    const result = await queryDns('nope.example', 'A');
    expect(result.answers).toEqual([]);
    expect(result.authority).toEqual([]);
    expect(result.statusName).toBe('NXDOMAIN');
  });

  it('HTTP lỗi thì throw kèm tên provider, không lặng lẽ trả JSON rỗng', async () => {
    fetchMock.mockResolvedValue(jsonResponse({}, false, 503));
    await expect(queryDns('example.com', 'A', DOH_PROVIDERS[0])).rejects.toThrow('503');
  });

  it('build URL đúng provider, đúng name/type, và kèm do=1 khi bật DNSSEC', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ Status: 0 }));
    await queryDns('Example.com ', 'TXT', DOH_PROVIDERS[0], true);
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('cloudflare-dns.com');
    // The name is trimmed and encoded into the query string.
    expect(url).toContain('name=Example.com');
    expect(url).toContain('type=TXT');
    expect(url).toContain('do=1');
  });
});

describe('queryAllRecords', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('gộp bản ghi từ mọi loại truy vấn thành công, sắp theo typeName rồi data', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const type = new URL(url).searchParams.get('type');
      if (type === 'A') {
        return jsonResponse({ Status: 0, Answer: [{ name: 'x', type: 1, TTL: 1, data: '1.1.1.1' }] });
      }
      if (type === 'MX') {
        return jsonResponse({ Status: 0, Answer: [{ name: 'x', type: 15, TTL: 1, data: 'mail.x' }] });
      }
      return jsonResponse({ Status: 0 }); // các type khác: không bản ghi
    });
    const result = await queryAllRecords('example.com');
    expect(result.status).toBe(0);
    // Sorted by type name, regardless of the order the mocks resolve in.
    expect(result.answers.map((a) => a.typeName)).toEqual(['A', 'MX']);
  });

  it('tất cả truy vấn đều fail (reject) thì throw, không trả kết quả rỗng ngầm', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    await expect(queryAllRecords('example.com')).rejects.toThrow('All record queries failed');
  });

  it('không loại nào có bản ghi nhưng ít nhất một truy vấn thành công: coi là NOERROR rỗng, không throw', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ Status: 0 }));
    const result = await queryAllRecords('example.com');
    expect(result.answers).toEqual([]);
    expect(result.status).toBe(0);
  });
});

describe('checkPropagation', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('trả một dòng cho MỖI provider, kể cả provider bị reject', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('cloudflare')) {
        return jsonResponse({ Status: 0, Answer: [{ name: 'x', type: 1, TTL: 1, data: '2.2.2.2' }] });
      }
      throw new Error('timeout');
    });
    const rows = await checkPropagation('example.com', 'A');
    expect(rows).toHaveLength(DOH_PROVIDERS.length);
    const ok = rows.find((r) => r.provider.id === 'cloudflare')!;
    expect(ok).toMatchObject({ ok: true, records: ['2.2.2.2'] });
    const failed = rows.find((r) => r.provider.id !== 'cloudflare')!;
    expect(failed).toMatchObject({ ok: false, records: [], error: 'timeout' });
  });

  it('chỉ đếm bản ghi ĐÚNG loại đang so sánh — lẫn loại khác thì kết quả sai lệch mà không ai biết', async () => {
    fetchMock.mockResolvedValue(jsonResponse({
      Status: 0,
      Answer: [
        { name: 'x', type: 1, TTL: 1, data: 'A-record' },
        { name: 'x', type: 5, TTL: 1, data: 'CNAME-record' },
      ],
    }));
    const rows = await checkPropagation('example.com', 'A');
    for (const r of rows) expect(r.records).toEqual(['A-record']);
  });
});

describe('checkDnssec', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('validated = true nếu BẤT KỲ trong ba truy vấn (A/DNSKEY/DS) có cờ AD', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const type = new URL(url).searchParams.get('type');
      if (type === 'DS') return jsonResponse({ Status: 0, AD: true, Answer: [{ name: 'x', type: 43, TTL: 1, data: 'ds' }] });
      return jsonResponse({ Status: 0, AD: false });
    });
    const result = await checkDnssec('example.com');
    expect(result.validated).toBe(true);
    expect(result.ds).toHaveLength(1);
    expect(result.dnskey).toEqual([]);
  });

  it('RRSIG được gom từ CẢ HAI nhánh DS và DNSKEY, không chỉ một', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      const type = new URL(url).searchParams.get('type');
      if (type === 'DS') {
        return jsonResponse({ Status: 0, Answer: [{ name: 'x', type: 46, TTL: 1, data: 'rrsig-for-ds' }] });
      }
      if (type === 'DNSKEY') {
        return jsonResponse({ Status: 0, Answer: [{ name: 'x', type: 46, TTL: 1, data: 'rrsig-for-dnskey' }] });
      }
      return jsonResponse({ Status: 0 });
    });
    const result = await checkDnssec('example.com');
    expect(result.rrsig.map((r) => r.data).sort()).toEqual(['rrsig-for-dnskey', 'rrsig-for-ds']);
  });
});

describe('lookupIp', () => {
  const fetchMock = vi.fn();
  beforeEach(() => { vi.stubGlobal('fetch', fetchMock); fetchMock.mockReset(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('provider đầu tiên trả HTTP lỗi → rơi xuống provider kế tiếp, không throw', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('ipapi.co')) return jsonResponse({}, false, 429);
      if (url.includes('ipwho.is')) {
        return jsonResponse({
          ip: '8.8.8.8', type: 'IPv4', city: 'Mountain View', region: 'California',
          country: 'United States', country_code: 'US', latitude: 37, longitude: -122,
          timezone: { id: 'America/Los_Angeles' }, connection: { asn: 15169, org: 'Google', isp: 'Google' },
        });
      }
      throw new Error('unreachable in this test');
    });
    const info = await lookupIp();
    expect(info).toMatchObject({ ip: '8.8.8.8', countryCode: 'US', asn: 'AS15169', flag: '🇺🇸' });
  });

  it('lỗi ứng dụng nằm TRONG JSON (không phải HTTP lỗi) cũng phải rơi xuống provider kế tiếp', async () => {
    // Match by hostname: "freeipapi.com" contains the substring "ipapi.co".
    fetchMock.mockImplementation(async (url: string) => {
      const host = new URL(url).hostname;
      if (host === 'ipapi.co') return jsonResponse({ error: true, reason: 'rate limited' });
      if (host === 'ipwho.is') return jsonResponse({ success: false, message: 'quota exceeded' });
      return jsonResponse({
        ipAddress: '1.2.3.4', ipVersion: 4, cityName: 'Hanoi', regionName: 'HN',
        countryName: 'Vietnam', countryCode: 'VN', latitude: 21, longitude: 105, timeZone: 'Asia/Ho_Chi_Minh',
      });
    });
    const info = await lookupIp();
    expect(info.ip).toBe('1.2.3.4');
    expect(info.flag).toBe('🇻🇳');
  });

  it('AbortError không được nuốt để thử provider khác — phải ném ra ngay', async () => {
    const abortError = new Error('aborted');
    abortError.name = 'AbortError';
    fetchMock.mockRejectedValue(abortError);
    await expect(lookupIp()).rejects.toThrow('aborted');
    // Only the first provider is called before aborting.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('mọi provider đều fail thì gộp lý do lỗi cuối cùng vào thông báo', async () => {
    fetchMock.mockRejectedValue(new Error('boom'));
    await expect(lookupIp()).rejects.toThrow('All IP services failed (boom)');
  });
});

describe('Chỉ khả dụng trong desktop app (Tauri)', () => {
  // jsdom has no `__TAURI_INTERNALS__`, so `isTauri` is false: these
  // functions must refuse rather than call a missing `invoke`.
  it('getLocalNetworkInfo báo lỗi rõ ràng thay vì gọi invoke trên nền web', async () => {
    await expect(getLocalNetworkInfo()).rejects.toThrow('desktop app');
  });

  it('listListeningPorts báo lỗi rõ ràng thay vì gọi invoke trên nền web', async () => {
    await expect(listListeningPorts()).rejects.toThrow('desktop app');
  });

  it('localNetworkInfo trả null (không throw) trên nền web — API "mềm" hơn getLocalNetworkInfo', async () => {
    await expect(localNetworkInfo()).resolves.toBeNull();
  });
});

describe('ALL_RECORD_TYPES', () => {
  it('không bao gồm PTR — tra ngược cần định dạng tên khác (in-addr.arpa), không hợp với truy vấn "ALL" thông thường', () => {
    expect(ALL_RECORD_TYPES).not.toContain('PTR');
  });
});
