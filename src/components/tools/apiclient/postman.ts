// Postman Collection v2.1 import / export.
//
// The internal model (types.ts) mirrors Postman's shape closely, so this is
// mostly field mapping plus a recursive walk of the `item` tree. Postman uses
// the same {{var}} token syntax we do, so variables survive a round-trip.
//
// Reference: https://schema.postman.com/json/collection/v2.1.0/collection.json

import {
  type ApiRequest,
  type Auth,
  type AuthType,
  type Collection,
  type Folder,
  type HttpMethod,
  type KeyValue,
  type RequestBody,
  type TreeItem,
  HTTP_METHODS,
  newAuth,
  newSettings,
  uid,
} from './types';

// ─── loose types for the incoming JSON ──────────────────────────────────────

interface PmKeyValue { key?: string; value?: string; disabled?: boolean }
interface PmUrl { raw?: string; query?: PmKeyValue[] }
interface PmBody {
  mode?: string;
  raw?: string;
  urlencoded?: PmKeyValue[];
  formdata?: PmKeyValue[];
  graphql?: { query?: string; variables?: string };
  options?: { raw?: { language?: string } };
}
interface PmAuth {
  type?: string;
  bearer?: PmKeyValue[];
  basic?: PmKeyValue[];
  digest?: PmKeyValue[];
  apikey?: PmKeyValue[];
  oauth2?: PmKeyValue[];
}
interface PmRequest {
  method?: string;
  header?: PmKeyValue[];
  url?: PmUrl | string;
  body?: PmBody;
  auth?: PmAuth;
}
interface PmEvent {
  listen?: string;        // 'prerequest' | 'test'
  script?: { exec?: string[] | string };
}
interface PmItem {
  name?: string;
  item?: PmItem[];        // present → folder
  request?: PmRequest;    // present → request
  auth?: PmAuth;
  event?: PmEvent[];
}
interface PmCollection {
  info?: { name?: string };
  item?: PmItem[];
  auth?: PmAuth;
}

// ─── import ─────────────────────────────────────────────────────────────────

const mapKv = (list?: PmKeyValue[]): KeyValue[] =>
  (list ?? []).map((p) => ({
    id: uid(),
    key: p.key ?? '',
    value: p.value ?? '',
    enabled: p.disabled !== true,
  }));

function findKv(list: PmKeyValue[] | undefined, key: string): string {
  return list?.find((p) => p.key === key)?.value ?? '';
}

function importAuth(auth?: PmAuth): Auth {
  const base = newAuth();
  if (!auth?.type) return base;
  const type = auth.type as AuthType;
  if (type === 'bearer') return { ...base, type, token: findKv(auth.bearer, 'token') };
  if (type === 'basic') {
    return { ...base, type, username: findKv(auth.basic, 'username'), password: findKv(auth.basic, 'password') };
  }
  if (type === 'digest') {
    return { ...base, type, username: findKv(auth.digest, 'username'), password: findKv(auth.digest, 'password') };
  }
  if (type === 'apikey') {
    return {
      ...base, type,
      apiKey: {
        key: findKv(auth.apikey, 'key'),
        value: findKv(auth.apikey, 'value'),
        placement: findKv(auth.apikey, 'in') === 'query' ? 'query' : 'header',
      },
    };
  }
  if (type === 'oauth2') {
    return {
      ...base, type,
      oauth2: {
        ...base.oauth2,
        grantType: findKv(auth.oauth2, 'grant_type') === 'password_credentials' ? 'password' : 'client_credentials',
        tokenUrl: findKv(auth.oauth2, 'accessTokenUrl'),
        clientId: findKv(auth.oauth2, 'clientId'),
        clientSecret: findKv(auth.oauth2, 'clientSecret'),
        scope: findKv(auth.oauth2, 'scope'),
        username: findKv(auth.oauth2, 'username'),
        password: findKv(auth.oauth2, 'password'),
      },
    };
  }
  return base;
}

function importBody(body?: PmBody): RequestBody {
  if (!body?.mode) return { mode: 'none', raw: '', form: [] };
  if (body.mode === 'raw') {
    const lang = body.options?.raw?.language;
    const mode = lang === 'json' ? 'json' : lang === 'xml' ? 'xml' : 'text';
    return { mode, raw: body.raw ?? '', form: [] };
  }
  if (body.mode === 'urlencoded') return { mode: 'urlencoded', raw: '', form: mapKv(body.urlencoded) };
  if (body.mode === 'formdata') return { mode: 'multipart', raw: '', form: mapKv(body.formdata) };
  if (body.mode === 'graphql') {
    return { mode: 'graphql', raw: '', form: [], graphql: { query: body.graphql?.query ?? '', variables: body.graphql?.variables ?? '' } };
  }
  return { mode: 'none', raw: '', form: [] };
}

function rawUrl(url?: PmUrl | string): string {
  if (!url) return '';
  if (typeof url === 'string') return url;
  return url.raw ?? '';
}

const execText = (e?: PmEvent): string => {
  const exec = e?.script?.exec;
  if (!exec) return '';
  return Array.isArray(exec) ? exec.join('\n') : String(exec);
};

function importRequest(item: PmItem): ApiRequest {
  const r = item.request ?? {};
  const method = (r.method ?? 'GET').toUpperCase();
  const url = typeof r.url === 'object' ? r.url : undefined;
  // Postman scripts use the `pm.*` API; the text is preserved so it can be
  // adapted to Bruno's `bru`/`req`/`res` API after import.
  const preReq = execText(item.event?.find((e) => e.listen === 'prerequest'));
  const test = execText(item.event?.find((e) => e.listen === 'test'));
  return {
    type: 'request',
    id: uid(),
    name: item.name ?? 'Request',
    method: (HTTP_METHODS as readonly string[]).includes(method) ? (method as HttpMethod) : 'GET',
    url: rawUrl(r.url),
    params: mapKv(url?.query),
    pathParams: [],
    headers: mapKv(r.header),
    body: importBody(r.body),
    auth: importAuth(r.auth ?? item.auth),
    script: { req: preReq, res: '' },
    vars: { req: [], res: [] },
    assertions: [],
    tests: test,
    settings: newSettings(),
  };
}

function importItems(items: PmItem[] | undefined): TreeItem[] {
  return (items ?? []).map((item): TreeItem => {
    if (Array.isArray(item.item)) {
      const folder: Folder = {
        type: 'folder',
        id: uid(),
        name: item.name ?? 'Folder',
        items: importItems(item.item),
      };
      return folder;
    }
    return importRequest(item);
  });
}

// Parse a Postman collection JSON string into our Collection model. Throws on
// malformed JSON or a shape that clearly isn't a Postman collection.
export function importPostman(jsonText: string): Collection {
  let data: PmCollection;
  try {
    data = JSON.parse(jsonText) as PmCollection;
  } catch {
    throw new Error('File is not valid JSON');
  }
  if (!data || !Array.isArray(data.item)) {
    throw new Error('Not a Postman collection (missing "item" array)');
  }
  return {
    id: uid(),
    name: data.info?.name ?? 'Imported Collection',
    items: importItems(data.item),
  };
}

// ─── export ─────────────────────────────────────────────────────────────────

const exportKv = (list: KeyValue[]): PmKeyValue[] =>
  list.map((kv) => ({ key: kv.key, value: kv.value, ...(kv.enabled ? {} : { disabled: true }) }));

function exportAuth(auth: Auth): PmAuth | undefined {
  if (auth.type === 'bearer') return { type: 'bearer', bearer: [{ key: 'token', value: auth.token }] };
  if (auth.type === 'basic') {
    return {
      type: 'basic',
      basic: [
        { key: 'username', value: auth.username },
        { key: 'password', value: auth.password },
      ],
    };
  }
  if (auth.type === 'digest') {
    return {
      type: 'digest',
      digest: [
        { key: 'username', value: auth.username },
        { key: 'password', value: auth.password },
      ],
    };
  }
  if (auth.type === 'apikey') {
    return {
      type: 'apikey',
      apikey: [
        { key: 'key', value: auth.apiKey.key },
        { key: 'value', value: auth.apiKey.value },
        { key: 'in', value: auth.apiKey.placement },
      ],
    };
  }
  if (auth.type === 'oauth2') {
    return {
      type: 'oauth2',
      oauth2: [
        { key: 'grant_type', value: auth.oauth2.grantType === 'password' ? 'password_credentials' : 'client_credentials' },
        { key: 'accessTokenUrl', value: auth.oauth2.tokenUrl },
        { key: 'clientId', value: auth.oauth2.clientId },
        { key: 'clientSecret', value: auth.oauth2.clientSecret },
        { key: 'scope', value: auth.oauth2.scope },
        { key: 'username', value: auth.oauth2.username },
        { key: 'password', value: auth.oauth2.password },
      ],
    };
  }
  return undefined;
}

function exportBody(body: RequestBody): PmBody | undefined {
  switch (body.mode) {
    case 'json':
      return { mode: 'raw', raw: body.raw, options: { raw: { language: 'json' } } };
    case 'xml':
      return { mode: 'raw', raw: body.raw, options: { raw: { language: 'xml' } } };
    case 'text':
    case 'sparql':
      return { mode: 'raw', raw: body.raw };
    case 'urlencoded':
      return { mode: 'urlencoded', urlencoded: exportKv(body.form) };
    case 'multipart':
      return { mode: 'formdata', formdata: exportKv(body.form) };
    case 'graphql':
      return { mode: 'graphql', graphql: { query: body.graphql?.query ?? '', variables: body.graphql?.variables ?? '' } };
    default:
      return undefined;
  }
}

function exportEvents(req: ApiRequest): PmEvent[] | undefined {
  const events: PmEvent[] = [];
  if (req.script.req.trim()) events.push({ listen: 'prerequest', script: { exec: req.script.req.split('\n') } });
  const testText = [req.script.res, req.tests].filter((s) => s.trim()).join('\n\n');
  if (testText.trim()) events.push({ listen: 'test', script: { exec: testText.split('\n') } });
  return events.length ? events : undefined;
}

function exportRequest(req: ApiRequest): PmItem {
  const out: PmItem = {
    name: req.name,
    event: exportEvents(req),
    request: {
      method: req.method,
      header: exportKv(req.headers),
      url: { raw: req.url, query: req.params.length ? exportKv(req.params) : undefined },
      body: exportBody(req.body),
      auth: exportAuth(req.auth),
    },
  };
  return out;
}

function exportItems(items: TreeItem[]): PmItem[] {
  return items.map((item) =>
    item.type === 'folder'
      ? { name: item.name, item: exportItems(item.items) }
      : exportRequest(item),
  );
}

// Serialize our Collection back to a Postman v2.1 collection object.
export function exportPostman(collection: Collection): unknown {
  return {
    info: {
      name: collection.name,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    item: exportItems(collection.items),
  };
}
