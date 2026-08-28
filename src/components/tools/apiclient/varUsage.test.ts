import { describe, expect, it } from 'vitest';
import { collectVarTokens, mapColumns, missingColumns, requestVarTokens } from './varUsage';
import { newAuth, newKeyValue, newRequest, type ApiRequest } from './types';

const req = (over: Partial<ApiRequest> = {}) => newRequest(over);
const tokens = (r: ApiRequest) => [...requestVarTokens(r)].sort();

describe('requestVarTokens', () => {
  it('finds tokens in the URL', () => {
    expect(tokens(req({ url: 'https://{{host}}/users/{{id}}' }))).toEqual(['host', 'id']);
  });

  it('tolerates whitespace inside the braces', () => {
    expect(tokens(req({ url: 'https://{{ host }}/x' }))).toEqual(['host']);
  });

  it('finds tokens in query params and headers', () => {
    expect(tokens(req({
      params: [newKeyValue('q', '{{term}}')],
      headers: [newKeyValue('X-{{hk}}', '{{hv}}')],
    }))).toEqual(['hk', 'hv', 'term']);
  });

  it('ignores disabled rows, which are never sent', () => {
    expect(tokens(req({
      params: [{ ...newKeyValue('q', '{{used}}'), enabled: true }, { ...newKeyValue('z', '{{skipped}}'), enabled: false }],
    }))).toEqual(['used']);
  });

  it('finds tokens in a raw body', () => {
    expect(tokens(req({ body: { mode: 'json', raw: '{"id":"{{userId}}"}', form: [] } }))).toEqual(['userId']);
  });

  it('finds tokens in a GraphQL query and variables', () => {
    expect(tokens(req({
      body: { mode: 'graphql', raw: '', form: [], graphql: { query: 'query { u(id: "{{gid}}") }', variables: '{"v":"{{gv}}"}' } },
    }))).toEqual(['gid', 'gv']);
  });

  it('finds tokens in form bodies', () => {
    expect(tokens(req({
      body: { mode: 'urlencoded', raw: '', form: [newKeyValue('k', '{{fv}}')] },
    }))).toEqual(['fv']);
  });

  it('finds tokens in path params', () => {
    expect(tokens(req({ url: 'https://h/u/:id', pathParams: [newKeyValue('id', '{{pid}}')] }))).toEqual(['pid']);
  });

  it('finds tokens across each auth type', () => {
    expect(tokens(req({ auth: { ...newAuth(), type: 'bearer', token: '{{tok}}' } }))).toEqual(['tok']);
    expect(tokens(req({ auth: { ...newAuth(), type: 'basic', username: '{{u}}', password: '{{p}}' } }))).toEqual(['p', 'u']);
    expect(tokens(req({
      auth: { ...newAuth(), type: 'apikey', apiKey: { key: '{{ak}}', value: '{{av}}', placement: 'header' } },
    }))).toEqual(['ak', 'av']);
    expect(tokens(req({
      auth: {
        ...newAuth(), type: 'oauth2',
        oauth2: { grantType: 'client_credentials', tokenUrl: '{{turl}}', clientId: '{{cid}}', clientSecret: '', scope: '', username: '', password: '' },
      },
    }))).toEqual(['cid', 'turl']);
  });

  it('ignores auth fields belonging to an inactive auth type', () => {
    // A leftover bearer token must not count while Basic is selected.
    expect(tokens(req({
      auth: { ...newAuth(), type: 'basic', token: '{{stale}}', username: '{{u}}' },
    }))).toEqual(['u']);
  });

  it('does not scan scripts, which read data through bru.getEnvVar/getCollectionVar', () => {
    expect(tokens(req({
      script: { req: "bru.setCollectionVar('x', '{{notReallyUsed}}');", res: '' },
      tests: 'expect("{{alsoNot}}").to.exist;',
    }))).toEqual([]);
  });

  it('returns nothing for a bare request', () => {
    expect(tokens(req())).toEqual([]);
  });
});

describe('collectVarTokens', () => {
  it('unions across every request in the run', () => {
    const all = collectVarTokens([
      req({ url: 'https://{{host}}/a' }),
      req({ url: 'https://{{host}}/b', headers: [newKeyValue('X', '{{token}}')] }),
    ]);
    expect([...all].sort()).toEqual(['host', 'token']);
  });
});

describe('mapColumns', () => {
  const rows = [{ id: '', name: 'Ada' }, { id: '7', name: 'Grace' }];

  it('maps each column to its token', () => {
    const out = mapColumns(['id', 'name'], rows, new Set(['id']));
    expect(out.map((m) => m.token)).toEqual(['{{id}}', '{{name}}']);
  });

  it('samples the first non-empty value', () => {
    const out = mapColumns(['id', 'name'], rows, new Set());
    expect(out[0].sample).toBe('7');
    expect(out[1].sample).toBe('Ada');
  });

  it('flags columns nothing in the run references', () => {
    const out = mapColumns(['id', 'name'], rows, new Set(['id']));
    expect(out.map((m) => m.used)).toEqual([true, false]);
  });

  it('leaves the sample empty when the column has no values', () => {
    expect(mapColumns(['blank'], [{ blank: '' }], new Set())[0].sample).toBe('');
  });
});

describe('missingColumns', () => {
  it('reports variables the run needs that nothing supplies', () => {
    expect(missingColumns(new Set(['host', 'id', 'token']), ['id'], new Set(['host'])))
      .toEqual(['token']);
  });

  it('is empty when the file and environment cover everything', () => {
    expect(missingColumns(new Set(['a', 'b']), ['a'], new Set(['b']))).toEqual([]);
  });

  it('sorts the result for a stable display', () => {
    expect(missingColumns(new Set(['z', 'a', 'm']), [], new Set())).toEqual(['a', 'm', 'z']);
  });
});
