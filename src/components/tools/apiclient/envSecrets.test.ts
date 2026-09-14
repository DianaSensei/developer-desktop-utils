import { describe, expect, it } from 'vitest';
import {
  envSecretKey,
  hasInlineEnvSecrets,
  mergeEnvSecrets,
  splitEnvSecrets,
} from './envSecrets';
import type { Environment } from './types';

function env(id: string, vars: Array<{ id: string; key: string; value: string; secret?: boolean }>): Environment {
  return {
    id,
    name: id,
    variables: vars.map((v) => ({ id: v.id, key: v.key, value: v.value, enabled: true, secret: v.secret })),
  };
}

describe('splitEnvSecrets', () => {
  it('chỉ rút giá trị của biến secret, biến thường giữ nguyên', () => {
    const envs = [
      env('e1', [
        { id: 'v1', key: 'baseUrl', value: 'https://api.example.com' },
        { id: 'v2', key: 'token', value: 'abc123', secret: true },
      ]),
    ];

    const { stripped, secrets } = splitEnvSecrets(envs);

    expect(stripped[0].variables[0].value).toBe('https://api.example.com');
    expect(stripped[0].variables[1].value).toBe('');
    expect(secrets).toEqual({ [envSecretKey('e1', 'v2')]: 'abc123' });
  });

  it('ghép lại cho ra đúng tài liệu ban đầu', () => {
    const envs = [
      env('e1', [
        { id: 'v1', key: 'baseUrl', value: 'https://api.example.com' },
        { id: 'v2', key: 'token', value: 'abc123', secret: true },
      ]),
      env('e2', [{ id: 'v1', key: 'token', value: 'khac', secret: true }]),
    ];

    const { stripped, secrets } = splitEnvSecrets(envs);
    expect(mergeEnvSecrets(stripped, secrets)).toEqual(envs);
  });

  it('id biến chỉ duy nhất trong một môi trường, nên khoá phải gồm cả id môi trường', () => {
    const envs = [
      env('e1', [{ id: 'v1', key: 'token', value: 'cua-e1', secret: true }]),
      env('e2', [{ id: 'v1', key: 'token', value: 'cua-e2', secret: true }]),
    ];

    const { secrets } = splitEnvSecrets(envs);
    expect(Object.keys(secrets)).toHaveLength(2);
    expect(secrets[envSecretKey('e1', 'v1')]).toBe('cua-e1');
    expect(secrets[envSecretKey('e2', 'v1')]).toBe('cua-e2');
  });

  it('bản đồ trả về là ĐẦY ĐỦ, nên bỏ đánh dấu secret sẽ dọn luôn mục cũ', () => {
    const before = [env('e1', [{ id: 'v1', key: 'token', value: 'abc', secret: true }])];
    expect(splitEnvSecrets(before).secrets).not.toEqual({});

    const after = [env('e1', [{ id: 'v1', key: 'token', value: 'abc' }])];
    const split = splitEnvSecrets(after);
    expect(split.secrets).toEqual({});
    expect(split.stripped[0].variables[0].value).toBe('abc');
  });

  it('giá trị rỗng không tạo mục trong kho', () => {
    const envs = [env('e1', [{ id: 'v1', key: 'token', value: '', secret: true }])];
    expect(splitEnvSecrets(envs).secrets).toEqual({});
  });

  it('không đụng vào tài liệu gốc', () => {
    const envs = [env('e1', [{ id: 'v1', key: 'token', value: 'abc', secret: true }])];
    splitEnvSecrets(envs);
    expect(envs[0].variables[0].value).toBe('abc');
  });
});

describe('mergeEnvSecrets', () => {
  it('thiếu mục trong kho thì giữ giá trị đang có, không ghi đè bằng undefined', () => {
    const stripped = [env('e1', [{ id: 'v1', key: 'token', value: '', secret: true }])];
    expect(mergeEnvSecrets(stripped, {})[0].variables[0].value).toBe('');
  });
});

describe('hasInlineEnvSecrets', () => {
  it('nhận ra tàn dư của bản cũ và chỉ tàn dư', () => {
    expect(hasInlineEnvSecrets([env('e1', [{ id: 'v1', key: 't', value: 'abc', secret: true }])])).toBe(true);
    expect(hasInlineEnvSecrets([env('e1', [{ id: 'v1', key: 't', value: '', secret: true }])])).toBe(false);
    expect(hasInlineEnvSecrets([env('e1', [{ id: 'v1', key: 't', value: 'abc' }])])).toBe(false);
  });
});
