import { describe, expect, it } from 'vitest';
import { importBru, isBrunoFile } from './bruno';

describe('isBrunoFile', () => {
  it('matches .bru case-insensitively', () => {
    expect(isBrunoFile('Get Users.bru')).toBe(true);
    expect(isBrunoFile('Get Users.BRU')).toBe(true);
    expect(isBrunoFile('collection.json')).toBe(false);
  });
});

describe('importBru', () => {
  it('parses a minimal GET request', () => {
    const bru = `
meta {
  name: List Users
  type: http
  seq: 1
}

get {
  url: {{baseUrl}}/users
  body: none
  auth: none
}
`;
    const { collection, warnings } = importBru(bru, 'list-users.bru');
    expect(warnings).toEqual([]);
    expect(collection.name).toBe('List Users');
    expect(collection.items).toHaveLength(1);
    const req = collection.items[0];
    expect(req.type).toBe('request');
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.method).toBe('GET');
    expect(req.url).toBe('{{baseUrl}}/users');
    expect(req.body).toEqual({ mode: 'none', raw: '', form: [] });
    expect(req.auth.type).toBe('none');
  });

  it('falls back to the file name when meta.name is absent', () => {
    const { collection } = importBru('get {\n  url: /ping\n}', 'Ping Check.bru');
    expect(collection.name).toBe('Ping Check');
  });

  it('throws when no http-method block is present', () => {
    expect(() => importBru('meta {\n  name: Nope\n}', 'nope.bru')).toThrow(
      /doesn't look like a Bruno request file/,
    );
  });

  it('parses headers and query params, honoring ~ as disabled', () => {
    const bru = `
get {
  url: /users
  body: none
  auth: none
}

headers {
  Accept: application/json
  ~X-Debug: true
}

query {
  page: 1
  ~limit: 10
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.headers).toEqual([
      { id: expect.any(String), key: 'Accept', value: 'application/json', enabled: true },
      { id: expect.any(String), key: 'X-Debug', value: 'true', enabled: false },
    ]);
    expect(req.params).toEqual([
      { id: expect.any(String), key: 'page', value: '1', enabled: true },
      { id: expect.any(String), key: 'limit', value: '10', enabled: false },
    ]);
  });

  it('parses a path-params block, keyed to match :placeholders in the url', () => {
    const bru = `
get {
  url: /users/:id
  body: none
  auth: none
}

params:path {
  id: 42
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.pathParams).toEqual([{ id: expect.any(String), key: 'id', value: '42', enabled: true }]);
  });

  it('parses a JSON body, tolerating braces inside it', () => {
    const bru = `
post {
  url: /users
  body: json
  auth: none
}

body:json {
  {
    "name": "Ada",
    "meta": { "role": "admin" }
  }
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.body.mode).toBe('json');
    expect(JSON.parse(req.body.raw)).toEqual({ name: 'Ada', meta: { role: 'admin' } });
  });

  it('parses a graphql body (query + separate vars block)', () => {
    const bru = `
post {
  url: /graphql
  body: graphql
  auth: none
}

body:graphql {
  query { me { id } }
}

body:graphql:vars {
  { "id": 1 }
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.body.mode).toBe('graphql');
    expect(req.body.graphql?.query.trim()).toBe('query { me { id } }');
    expect(req.body.graphql?.variables.trim()).toBe('{ "id": 1 }');
  });

  it('parses a form-urlencoded body', () => {
    const bru = `
post {
  url: /login
  body: form-urlencoded
  auth: none
}

body:form-urlencoded {
  username: ada
  password: secret
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.body.mode).toBe('urlencoded');
    expect(req.body.form).toEqual([
      { id: expect.any(String), key: 'username', value: 'ada', enabled: true },
      { id: expect.any(String), key: 'password', value: 'secret', enabled: true },
    ]);
  });

  it('parses a multipart-form body, flagging @file(...) fields for manual re-attach', () => {
    const bru = `
post {
  url: /upload
  body: multipart-form
  auth: none
}

body:multipart-form {
  note: hello
  avatar: @file(./avatar.png)
}
`;
    const { collection, warnings } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.body.mode).toBe('multipart');
    expect(req.body.form).toEqual([
      { id: expect.any(String), key: 'note', value: 'hello', enabled: true, kind: 'text' },
      { id: expect.any(String), key: 'avatar', value: '', enabled: true, kind: 'file', fileName: './avatar.png' },
    ]);
    expect(warnings.some((w) => w.includes('avatar'))).toBe(true);
  });

  it('warns and drops the body for an unsupported body type', () => {
    const bru = 'post {\n  url: /x\n  body: sparql-not-real\n  auth: none\n}';
    const { collection, warnings } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.body).toEqual({ mode: 'none', raw: '', form: [] });
    expect(warnings.some((w) => w.includes('sparql-not-real'))).toBe(true);
  });

  it('parses bearer auth', () => {
    const bru = `
get {
  url: /me
  body: none
  auth: bearer
}

auth:bearer {
  token: {{token}}
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.auth).toMatchObject({ type: 'bearer', token: '{{token}}' });
  });

  it('parses basic auth', () => {
    const bru = `
get {
  url: /me
  body: none
  auth: basic
}

auth:basic {
  username: ada
  password: secret
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.auth).toMatchObject({ type: 'basic', username: 'ada', password: 'secret' });
  });

  it('parses apikey auth, defaulting placement to header', () => {
    const bru = `
get {
  url: /me
  body: none
  auth: apikey
}

auth:apikey {
  key: X-Api-Key
  value: {{apiKey}}
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.auth).toMatchObject({ type: 'apikey', apiKey: { key: 'X-Api-Key', value: '{{apiKey}}', placement: 'header' } });
  });

  it('parses oauth2 auth (client_credentials grant)', () => {
    const bru = `
get {
  url: /me
  body: none
  auth: oauth2
}

auth:oauth2 {
  grant_type: client_credentials
  token_url: https://auth.example.com/token
  client_id: abc
  client_secret: xyz
  scope: read
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.auth).toMatchObject({
      type: 'oauth2',
      oauth2: { grantType: 'client_credentials', tokenUrl: 'https://auth.example.com/token', clientId: 'abc', clientSecret: 'xyz', scope: 'read' },
    });
  });

  it('records inherit auth as-is, with no warning', () => {
    const { collection, warnings } = importBru('get {\n  url: /x\n  body: none\n  auth: inherit\n}', 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.auth.type).toBe('inherit');
    expect(warnings).toEqual([]);
  });

  it('warns and falls back to No Auth for an unsupported auth type', () => {
    const bru = 'get {\n  url: /x\n  body: none\n  auth: awsv4\n}';
    const { collection, warnings } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.auth.type).toBe('none');
    expect(warnings.some((w) => w.includes('awsv4'))).toBe(true);
  });

  it('parses pre-request and post-response scripts, and the tests block', () => {
    const bru = `
get {
  url: /x
  body: none
  auth: none
}

script:pre-request {
  bru.setVar("x", 1);
}

script:post-response {
  console.log(res.body);
}

tests {
  test("status ok", function () {
    expect(res.status).to.equal(200);
  });
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.script.req).toBe('bru.setVar("x", 1);');
    expect(req.script.res).toBe('console.log(res.body);');
    expect(req.tests).toContain('expect(res.status).to.equal(200);');
  });

  it('parses assert lines into Assertions, mapping bru\'s eq/neq to this app\'s vocabulary', () => {
    const bru = `
get {
  url: /x
  body: none
  auth: none
}

assert {
  res.status: eq 200
  res.body.count: gt 0
  ~res.body.ok: isTruthy
}
`;
    const { collection } = importBru(bru, 'x.bru');
    const req = collection.items[0];
    if (req.type !== 'request') throw new Error('expected a request');
    expect(req.assertions).toEqual([
      { id: expect.any(String), expr: 'res.status', operator: 'equals', value: '200', enabled: true },
      { id: expect.any(String), expr: 'res.body.count', operator: 'gt', value: '0', enabled: true },
      { id: expect.any(String), expr: 'res.body.ok', operator: 'isTruthy', value: '', enabled: false },
    ]);
  });

  it('warns (without throwing) when vars blocks are present, since they are not modeled', () => {
    const bru = `
get {
  url: /x
  body: none
  auth: none
}

vars:pre-request {
  foo: bar
}
`;
    const { warnings } = importBru(bru, 'x.bru');
    expect(warnings.some((w) => w.includes('vars'))).toBe(true);
  });
});
