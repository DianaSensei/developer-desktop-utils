import { describe, expect, it } from 'vitest';
import { importOpenApi, isOpenApiDocument, parseSpecText, pathToColonSyntax } from './openapi';
import type { ApiRequest, Folder, TreeItem } from './types';

// ─── helpers ────────────────────────────────────────────────────────────────

const asRequest = (item: TreeItem | undefined): ApiRequest => {
  if (!item || item.type !== 'request') throw new Error('expected a request');
  return item;
};
const asFolder = (item: TreeItem | undefined): Folder => {
  if (!item || item.type !== 'folder') throw new Error('expected a folder');
  return item;
};
// Depth-first lookup by name, so a test doesn't depend on tree positions.
function findRequest(items: TreeItem[], name: string): ApiRequest {
  for (const it of items) {
    if (it.type === 'request') { if (it.name === name) return it; continue; }
    const hit = it.items.find((c) => c.type === 'request' && c.name === name);
    if (hit) return asRequest(hit);
  }
  throw new Error(`no request named ${name}`);
}

const spec = (extra: Record<string, unknown>) => ({
  openapi: '3.0.3',
  info: { title: 'Pet API' },
  servers: [{ url: 'https://api.example.com/v1' }],
  paths: {},
  ...extra,
});

// ─── detection & parsing ────────────────────────────────────────────────────

describe('isOpenApiDocument', () => {
  it('recognizes OpenAPI 3.x and Swagger 2.0, and rejects everything else', () => {
    expect(isOpenApiDocument({ openapi: '3.1.0' })).toBe(true);
    expect(isOpenApiDocument({ swagger: '2.0' })).toBe(true);
    expect(isOpenApiDocument({ info: { name: 'x' }, item: [] })).toBe(false);   // Postman
    expect(isOpenApiDocument({ openapi: '4.0.0' })).toBe(false);
    expect(isOpenApiDocument(null)).toBe(false);
    expect(isOpenApiDocument('openapi: 3.0.0')).toBe(false);
  });
});

describe('parseSpecText', () => {
  it('parses JSON', async () => {
    expect(await parseSpecText('{"openapi":"3.0.0"}')).toEqual({ openapi: '3.0.0' });
  });

  it('falls back to YAML, which is how most specs are actually written', async () => {
    const doc = await parseSpecText('openapi: 3.0.0\ninfo:\n  title: Pet API\n');
    expect(doc).toEqual({ openapi: '3.0.0', info: { title: 'Pet API' } });
  });

  it('throws on text that is neither', async () => {
    await expect(parseSpecText('{ this: is: broken:')).rejects.toThrow(/not valid JSON or YAML/);
  });
});

describe('importOpenApi — rejection', () => {
  it('rejects a document that is not a spec', () => {
    expect(() => importOpenApi({ info: { name: 'x' }, item: [] })).toThrow(/Not an OpenAPI document/);
    expect(() => importOpenApi('nope')).toThrow(/Not an OpenAPI document/);
  });

  it('rejects a spec with no paths rather than importing an empty collection', () => {
    expect(() => importOpenApi(spec({ paths: {} }))).toThrow(/no paths/);
  });
});

// ─── structure ──────────────────────────────────────────────────────────────

describe('importOpenApi — structure', () => {
  const doc = spec({
    tags: [{ name: 'pets' }, { name: 'unused' }],
    paths: {
      '/pets': {
        get: { tags: ['pets'], summary: 'List pets' },
        post: { tags: ['pets'], operationId: 'createPet' },
      },
      '/health': { get: {} },
    },
  });

  it('names the collection from info.title and groups operations into folders by tag', () => {
    const { collection } = importOpenApi(doc);
    expect(collection.name).toBe('Pet API');
    const folder = asFolder(collection.items[0]);
    expect(folder.name).toBe('pets');
    expect(folder.items.map((i) => i.name)).toEqual(['List pets', 'createPet']);
  });

  it('drops a declared tag no operation uses, and leaves untagged operations at the root', () => {
    const { collection } = importOpenApi(doc);
    expect(collection.items.filter((i) => i.type === 'folder').map((i) => i.name)).toEqual(['pets']);
    expect(asRequest(collection.items[1]).name).toBe('GET /health');
  });

  it('prefixes every URL with a {{baseUrl}} variable taken from servers[0]', () => {
    const { collection } = importOpenApi(doc);
    expect(collection.variables).toEqual([
      expect.objectContaining({ key: 'baseUrl', value: 'https://api.example.com/v1' }),
    ]);
    expect(findRequest(collection.items, 'List pets').url).toBe('{{baseUrl}}/pets');
  });

  it('substitutes server variable defaults and trims a trailing slash', () => {
    const { collection } = importOpenApi(spec({
      servers: [{ url: 'https://{region}.example.com/{version}/', variables: { region: { default: 'eu' }, version: { default: 'v2' } } }],
      paths: { '/pets': { get: {} } },
    }));
    expect(collection.variables?.[0].value).toBe('https://eu.example.com/v2');
  });

  it('emits no baseUrl variable when the spec declares no server', () => {
    const { collection } = importOpenApi({ openapi: '3.0.0', paths: { '/pets': { get: {} } } });
    expect(collection.variables).toEqual([]);
    expect(asRequest(collection.items[0]).url).toBe('/pets');
  });

  it('skips TRACE, which the client cannot send, and says so', () => {
    const { collection, warnings } = importOpenApi(spec({ paths: { '/pets': { get: {}, trace: {} } } }));
    expect(collection.items).toHaveLength(1);
    expect(warnings.join()).toMatch(/TRACE \/pets was skipped/);
  });
});

// ─── parameters ─────────────────────────────────────────────────────────────

describe('pathToColonSyntax', () => {
  it('rewrites {name} to :name, the only syntax the engine resolves', () => {
    expect(pathToColonSyntax('/pets/{petId}/toys/{toyId}')).toBe('/pets/:petId/toys/:toyId');
  });

  it('leaves {{var}} tokens alone — those are ordinary variables', () => {
    expect(pathToColonSyntax('/{{tenant}}/pets/{petId}')).toBe('/{{tenant}}/pets/:petId');
  });
});

describe('importOpenApi — parameters', () => {
  const doc = spec({
    paths: {
      '/pets/{petId}': {
        parameters: [
          { name: 'petId', in: 'path', required: true, schema: { type: 'integer' } },
          { name: 'trace', in: 'query', schema: { type: 'boolean' } },
        ],
        get: {
          summary: 'Get pet',
          parameters: [
            { name: 'limit', in: 'query', required: true, schema: { type: 'integer', default: 10 } },
            { name: 'fields', in: 'query', schema: { type: 'string' } },
            { name: 'X-Request-Id', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } },
            { name: 'Content-Type', in: 'header', schema: { type: 'string' } },
          ],
        },
      },
    },
  });

  it('enables required query params and leaves optional ones off, ready to toggle', () => {
    const req = findRequest(importOpenApi(doc).collection.items, 'Get pet');
    expect(req.params).toEqual([
      expect.objectContaining({ key: 'trace', value: 'false', enabled: false }),
      expect.objectContaining({ key: 'limit', value: '10', enabled: true }),
      expect.objectContaining({ key: 'fields', value: '', enabled: false }),
    ]);
  });

  it('merges path-level parameters into every operation under the path', () => {
    const req = findRequest(importOpenApi(doc).collection.items, 'Get pet');
    expect(req.url).toBe('{{baseUrl}}/pets/:petId');
    expect(req.pathParams).toEqual([expect.objectContaining({ key: 'petId', value: '0', enabled: true })]);
  });

  it('imports header params but drops Content-Type, which the body mode owns', () => {
    const req = findRequest(importOpenApi(doc).collection.items, 'Get pet');
    expect(req.headers.map((h) => h.key)).toEqual(['X-Request-Id']);
    expect(req.headers[0].value).toBe('00000000-0000-0000-0000-000000000000');
  });

  it('lets an operation parameter override the path-level one of the same name', () => {
    const { collection } = importOpenApi(spec({
      paths: {
        '/pets': {
          parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }],
          get: { summary: 'List', parameters: [{ name: 'limit', in: 'query', required: true, schema: { type: 'integer', default: 99 } }] },
        },
      },
    }));
    const req = findRequest(collection.items, 'List');
    expect(req.params).toEqual([expect.objectContaining({ key: 'limit', value: '99', enabled: true })]);
  });

  it('backfills a path placeholder the spec never declared, so it is visible and fillable', () => {
    const { collection } = importOpenApi(spec({ paths: { '/pets/{petId}': { get: { summary: 'Get' } } } }));
    const req = findRequest(collection.items, 'Get');
    expect(req.pathParams).toEqual([expect.objectContaining({ key: 'petId', value: '' })]);
  });
});

// ─── bodies ─────────────────────────────────────────────────────────────────

describe('importOpenApi — request bodies', () => {
  it('synthesizes a JSON body from the schema, resolving $refs', () => {
    const { collection } = importOpenApi(spec({
      paths: {
        '/pets': {
          post: {
            summary: 'Create pet',
            requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } } },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              status: { type: 'string', enum: ['available', 'sold'] },
              tags: { type: 'array', items: { type: 'string' } },
              born: { type: 'string', format: 'date-time' },
            },
          },
        },
      },
    }));
    const req = findRequest(collection.items, 'Create pet');
    expect(req.body.mode).toBe('json');
    expect(JSON.parse(req.body.raw)).toEqual({
      id: 0, name: '', status: 'available', tags: [''], born: '1970-01-01T00:00:00Z',
    });
  });

  it("prefers the spec's own example over a synthesized one", () => {
    const { collection } = importOpenApi(spec({
      paths: {
        '/pets': {
          post: {
            summary: 'Create pet',
            requestBody: { content: { 'application/json': { schema: { type: 'object' }, example: { name: 'Rex' } } } },
          },
        },
      },
    }));
    expect(JSON.parse(findRequest(collection.items, 'Create pet').body.raw)).toEqual({ name: 'Rex' });
  });

  it('takes the first entry of `examples` when there is no single `example`', () => {
    const { collection } = importOpenApi(spec({
      paths: {
        '/pets': {
          post: {
            summary: 'Create pet',
            requestBody: { content: { 'application/json': { examples: { rex: { value: { name: 'Rex' } } } } } },
          },
        },
      },
    }));
    expect(JSON.parse(findRequest(collection.items, 'Create pet').body.raw)).toEqual({ name: 'Rex' });
  });

  it('merges allOf and takes the first branch of oneOf', () => {
    const { collection } = importOpenApi(spec({
      paths: {
        '/pets': {
          post: {
            summary: 'Create pet',
            requestBody: {
              content: {
                'application/json': {
                  schema: {
                    allOf: [
                      { type: 'object', properties: { id: { type: 'integer' } } },
                      { type: 'object', properties: { kind: { oneOf: [{ type: 'string' }, { type: 'integer' }] } } },
                    ],
                  },
                },
              },
            },
          },
        },
      },
    }));
    expect(JSON.parse(findRequest(collection.items, 'Create pet').body.raw)).toEqual({ id: 0, kind: '' });
  });

  it('survives a self-referencing schema instead of recursing forever', () => {
    const { collection } = importOpenApi(spec({
      paths: {
        '/nodes': {
          post: { summary: 'Add node', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } } } },
        },
      },
      components: {
        schemas: {
          Node: { type: 'object', properties: { name: { type: 'string' }, child: { $ref: '#/components/schemas/Node' } } },
        },
      },
    }));
    expect(JSON.parse(findRequest(collection.items, 'Add node').body.raw)).toEqual({ name: '', child: null });
  });

  it('maps urlencoded and multipart bodies to form rows, marking binary fields as files', () => {
    const { collection } = importOpenApi(spec({
      paths: {
        '/form': {
          post: {
            summary: 'Form',
            requestBody: { content: { 'application/x-www-form-urlencoded': { schema: { type: 'object', properties: { name: { type: 'string' }, age: { type: 'integer' } } } } } },
          },
        },
        '/upload': {
          post: {
            summary: 'Upload',
            requestBody: { content: { 'multipart/form-data': { schema: { type: 'object', properties: { note: { type: 'string' }, file: { type: 'string', format: 'binary' } } } } } },
          },
        },
      },
    }));
    const form = findRequest(collection.items, 'Form');
    expect(form.body.mode).toBe('urlencoded');
    expect(form.body.form.map((f) => [f.key, f.value])).toEqual([['name', ''], ['age', '0']]);

    const upload = findRequest(collection.items, 'Upload');
    expect(upload.body.mode).toBe('multipart');
    expect(upload.body.form.map((f) => [f.key, f.kind])).toEqual([['note', undefined], ['file', 'file']]);
  });

  it('warns instead of silently dropping a body type it cannot represent', () => {
    const { collection, warnings } = importOpenApi(spec({
      paths: { '/blob': { post: { summary: 'Blob', requestBody: { content: { 'application/octet-stream': {} } } } } },
    }));
    expect(findRequest(collection.items, 'Blob').body.mode).toBe('none');
    expect(warnings.join()).toMatch(/application\/octet-stream/);
  });

  it('prefers JSON when an operation accepts several media types', () => {
    const { collection } = importOpenApi(spec({
      paths: {
        '/pets': {
          post: {
            summary: 'Create pet',
            requestBody: { content: { 'application/xml': { schema: { type: 'string' } }, 'application/json': { example: { ok: true } } } },
          },
        },
      },
    }));
    const req = findRequest(collection.items, 'Create pet');
    expect(req.body.mode).toBe('json');
    expect(JSON.parse(req.body.raw)).toEqual({ ok: true });
  });
});

// ─── security ───────────────────────────────────────────────────────────────

describe('importOpenApi — security', () => {
  const withSchemes = (schemes: Record<string, unknown>, extra: Record<string, unknown> = {}) => spec({
    components: { securitySchemes: schemes },
    paths: { '/pets': { get: { summary: 'List' } } },
    ...extra,
  });

  it('maps a bearer scheme to collection auth backed by a {{bearerToken}} variable', () => {
    const { collection } = importOpenApi(withSchemes(
      { bearerAuth: { type: 'http', scheme: 'bearer' } },
      { security: [{ bearerAuth: [] }] },
    ));
    expect(collection.auth).toMatchObject({ type: 'bearer', token: '{{bearerToken}}' });
    expect(collection.variables?.map((v) => v.key)).toEqual(['baseUrl', 'bearerToken']);
    // The request inherits rather than repeating the credential.
    expect(findRequest(collection.items, 'List').auth.type).toBe('inherit');
  });

  it('maps an API-key scheme, keeping its declared name and placement', () => {
    const { collection } = importOpenApi(withSchemes(
      { key: { type: 'apiKey', name: 'X-Api-Key', in: 'header' } },
      { security: [{ key: [] }] },
    ));
    expect(collection.auth).toMatchObject({
      type: 'apikey',
      apiKey: { key: 'X-Api-Key', value: '{{apiKey}}', placement: 'header' },
    });
  });

  it('maps an OAuth2 client-credentials flow, including its token URL and scopes', () => {
    const { collection } = importOpenApi(withSchemes(
      { oauth: { type: 'oauth2', flows: { clientCredentials: { tokenUrl: 'https://auth.test/token', scopes: { 'pets:read': '', 'pets:write': '' } } } } },
      { security: [{ oauth: [] }] },
    ));
    expect(collection.auth).toMatchObject({
      type: 'oauth2',
      oauth2: expect.objectContaining({ grantType: 'client_credentials', tokenUrl: 'https://auth.test/token', scope: 'pets:read pets:write' }),
    });
    expect(collection.variables?.map((v) => v.key)).toEqual(['baseUrl', 'clientId', 'clientSecret']);
  });

  it('lets an operation override the collection default, and honours an explicit opt-out', () => {
    const { collection } = importOpenApi(spec({
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' }, key: { type: 'apiKey', name: 'X-Api-Key', in: 'query' } } },
      security: [{ bearerAuth: [] }],
      paths: {
        '/pets': { get: { summary: 'List' } },
        '/login': { post: { summary: 'Login', security: [] } },
        '/admin': { get: { summary: 'Admin', security: [{ key: [] }] } },
      },
    }));
    expect(findRequest(collection.items, 'List').auth.type).toBe('inherit');
    expect(findRequest(collection.items, 'Login').auth.type).toBe('none');
    expect(findRequest(collection.items, 'Admin').auth).toMatchObject({ type: 'apikey', apiKey: { placement: 'query' } });
  });

  it('warns about a scheme it cannot map instead of importing broken auth', () => {
    const { collection, warnings } = importOpenApi(withSchemes(
      { openid: { type: 'openIdConnect', openIdConnectUrl: 'https://auth.test/.well-known' } },
      { security: [{ openid: [] }] },
    ));
    expect(collection.auth).toBeUndefined();
    expect(findRequest(collection.items, 'List').auth.type).toBe('none');
    expect(warnings.join()).toMatch(/openid/);
  });
});

// ─── Swagger 2.0 ────────────────────────────────────────────────────────────

describe('importOpenApi — Swagger 2.0', () => {
  const doc = {
    swagger: '2.0',
    info: { title: 'Legacy API' },
    host: 'api.legacy.test',
    basePath: '/v2',
    schemes: ['https'],
    consumes: ['application/json'],
    securityDefinitions: { key: { type: 'apiKey', name: 'api_key', in: 'header' } },
    security: [{ key: [] }],
    paths: {
      '/pets/{petId}': {
        get: {
          tags: ['pet'],
          summary: 'Find pet',
          parameters: [
            { name: 'petId', in: 'path', required: true, type: 'integer' },
            { name: 'verbose', in: 'query', type: 'boolean' },
          ],
        },
        post: {
          tags: ['pet'],
          summary: 'Update pet',
          parameters: [{ name: 'body', in: 'body', schema: { $ref: '#/definitions/Pet' } }],
        },
      },
      '/pets/{petId}/image': {
        post: {
          summary: 'Upload image',
          consumes: ['multipart/form-data'],
          parameters: [
            { name: 'caption', in: 'formData', type: 'string' },
            { name: 'file', in: 'formData', type: 'file' },
          ],
        },
      },
    },
    definitions: { Pet: { type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } } } },
  };

  it('builds the base URL from schemes + host + basePath', () => {
    const { collection } = importOpenApi(doc);
    expect(collection.variables?.[0]).toMatchObject({ key: 'baseUrl', value: 'https://api.legacy.test/v2' });
    expect(findRequest(collection.items, 'Find pet').url).toBe('{{baseUrl}}/pets/:petId');
  });

  it('reads parameter types off the parameter itself, as Swagger 2 spells them', () => {
    const req = findRequest(importOpenApi(doc).collection.items, 'Find pet');
    expect(req.pathParams).toEqual([expect.objectContaining({ key: 'petId', value: '0' })]);
    expect(req.params).toEqual([expect.objectContaining({ key: 'verbose', value: 'false', enabled: false })]);
  });

  it('maps an `in: body` parameter to a JSON body, resolving #/definitions refs', () => {
    const req = findRequest(importOpenApi(doc).collection.items, 'Update pet');
    expect(req.body.mode).toBe('json');
    expect(JSON.parse(req.body.raw)).toEqual({ id: 0, name: '' });
  });

  it('maps `in: formData` with a file to a multipart body', () => {
    const req = findRequest(importOpenApi(doc).collection.items, 'Upload image');
    expect(req.body.mode).toBe('multipart');
    expect(req.body.form.map((f) => [f.key, f.kind])).toEqual([['caption', undefined], ['file', 'file']]);
  });

  it('reads security from securityDefinitions', () => {
    const { collection } = importOpenApi(doc);
    expect(collection.auth).toMatchObject({ type: 'apikey', apiKey: { key: 'api_key', placement: 'header' } });
  });
});
