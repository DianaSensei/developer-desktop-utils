// OpenAPI 3.x / Swagger 2.0 import.
//
// Turns a spec (JSON or YAML) into a Collection the same way postman.ts turns a
// Postman file into one, so both sources land in the identical model and share
// the whole downstream pipeline (send, runner, codegen, export).
//
// The mapping is deliberately conservative — a spec describes an API, not a set
// of saved calls, so the goal is a tree the user can send from immediately:
//
//   info.title            → collection name
//   servers[0]            → {{baseUrl}} collection variable, prefixing every URL
//   tags                  → folders (one per first tag; untagged sit at the root)
//   paths.<p>.<method>    → a request, named from summary / operationId / path
//   parameters            → query params (optional ones disabled), path params, headers
//   requestBody           → a JSON / urlencoded / multipart / raw body, from the
//                           spec's own example when it has one, else synthesized
//                           from the schema
//   securitySchemes       → collection-level auth (+ {{vars}} for the secrets),
//                           overridden per request where the operation differs
//
// References: https://spec.openapis.org/oas/v3.1.0
//             https://swagger.io/specification/v2/

import {
  type ApiRequest,
  type Auth,
  type Collection,
  type Folder,
  type HttpMethod,
  type KeyValue,
  type RequestBody,
  type TreeItem,
  HTTP_METHODS,
  newAuth,
  newKeyValue,
  newSettings,
  uid,
} from './types';

// ─── loose types for the incoming document ──────────────────────────────────
//
// Specs in the wild are only as valid as the tool that wrote them, so every
// field is optional and read defensively rather than trusted.

type Json = Record<string, unknown>;

export interface OpenApiImport {
  collection: Collection;
  // Human-readable notes about anything that could not be mapped one-to-one
  // (unsupported auth, a body type with no equivalent). Shown after import so
  // the result is never silently lossy.
  warnings: string[];
}

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const obj = (v: unknown): Json => (isObj(v) ? v : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// Methods a path item may declare. `trace` has no equivalent in HTTP_METHODS,
// so it is reported as a warning rather than silently dropped.
const SPEC_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const;

// ─── detection ──────────────────────────────────────────────────────────────

// True when `doc` looks like an OpenAPI 3.x or Swagger 2.0 document. Used to
// pick an importer for a file the user chose without telling us its format.
export function isOpenApiDocument(doc: unknown): boolean {
  if (!isObj(doc)) return false;
  if (str(doc.openapi).startsWith('3.')) return true;
  if (str(doc.swagger).startsWith('2.')) return true;
  return false;
}

// Parse spec text that may be JSON or YAML. JSON is tried first (it is also
// valid YAML, but the native parser is faster and gives better errors); js-yaml
// is loaded lazily so a JSON-only import never pays for it.
export async function parseSpecText(text: string): Promise<unknown> {
  try {
    return JSON.parse(text);
  } catch {
    // fall through to YAML
  }
  try {
    const { load } = await import('js-yaml');
    return load(text);
  } catch (e) {
    throw new Error(`File is not valid JSON or YAML: ${(e as Error).message}`);
  }
}

// ─── $ref resolution ────────────────────────────────────────────────────────

// Resolves local `#/...` pointers against the root document. External refs
// (another file, a URL) are not followed — resolving them would mean reading
// files or making network calls behind the user's back, which this app never
// does on an import.
function makeResolver(root: Json) {
  // Guards against a schema that refs itself (a Node with a `children` array of
  // Nodes is common and would otherwise recurse forever).
  const resolve = (node: unknown, seen: ReadonlySet<string> = new Set()): unknown => {
    if (!isObj(node)) return node;
    const ref = str(node.$ref);
    if (!ref) return node;
    if (!ref.startsWith('#/') || seen.has(ref)) return {};
    let cur: unknown = root;
    for (const rawPart of ref.slice(2).split('/')) {
      const part = rawPart.replace(/~1/g, '/').replace(/~0/g, '~');
      if (!isObj(cur)) return {};
      cur = cur[part];
    }
    return resolve(cur, new Set([...seen, ref]));
  };
  return resolve;
}

type Resolver = ReturnType<typeof makeResolver>;

// ─── example synthesis ──────────────────────────────────────────────────────

const FORMAT_SAMPLES: Record<string, string> = {
  'date-time': '1970-01-01T00:00:00Z',
  date: '1970-01-01',
  time: '00:00:00',
  uuid: '00000000-0000-0000-0000-000000000000',
  email: 'user@example.com',
  hostname: 'example.com',
  ipv4: '127.0.0.1',
  ipv6: '::1',
  uri: 'https://example.com',
  url: 'https://example.com',
  password: 'password',
  byte: '',
  binary: '',
};

// Builds a placeholder value for a schema: the spec's own example or default
// when it has one, otherwise the emptiest value the declared type allows. The
// point is a body the user can edit, not realistic data.
function sampleFromSchema(
  schema: unknown,
  resolve: Resolver,
  depth = 0,
  seen: ReadonlySet<string> = new Set(),
): unknown {
  if (depth > 8) return null;
  // A schema that refs itself (a tree Node whose `child` is another Node) has no
  // finite sample; the cycle ends at null rather than nesting to the depth cap.
  const ref = isObj(schema) ? str(schema.$ref) : '';
  if (ref) {
    if (seen.has(ref)) return null;
    seen = new Set([...seen, ref]);
  }
  const s = obj(resolve(schema));

  if (s.example !== undefined) return s.example;
  if (s.default !== undefined) return s.default;
  const enumValues = arr(s.enum);
  if (enumValues.length) return enumValues[0];

  // Composition: allOf merges, oneOf/anyOf take the first branch — enough for a
  // starting body, and the user edits from there.
  const allOf = arr(s.allOf);
  if (allOf.length) {
    const merged: Json = {};
    for (const part of allOf) {
      const sub = sampleFromSchema(part, resolve, depth + 1, seen);
      if (isObj(sub)) Object.assign(merged, sub);
    }
    return merged;
  }
  const branch = arr(s.oneOf)[0] ?? arr(s.anyOf)[0];
  if (branch !== undefined) return sampleFromSchema(branch, resolve, depth + 1, seen);

  // OpenAPI 3.1 allows `type` to be an array (["string","null"]); take the
  // first non-null entry.
  const rawType = s.type;
  const type = Array.isArray(rawType)
    ? str(rawType.find((t) => t !== 'null'))
    : str(rawType);

  if (type === 'array') return [sampleFromSchema(s.items, resolve, depth + 1, seen)];
  if (type === 'object' || s.properties) {
    const out: Json = {};
    for (const [key, prop] of Object.entries(obj(s.properties))) {
      out[key] = sampleFromSchema(prop, resolve, depth + 1, seen);
    }
    return out;
  }
  if (type === 'integer' || type === 'number') return 0;
  if (type === 'boolean') return false;
  if (type === 'string') return FORMAT_SAMPLES[str(s.format)] ?? '';
  return null;
}

// A schema's sample rendered for a single-value slot (a query/header/form value),
// where an object or array has to collapse to text.
function sampleAsText(schema: unknown, resolve: Resolver): string {
  const v = sampleFromSchema(schema, resolve);
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ─── servers ────────────────────────────────────────────────────────────────

// The base URL every request is prefixed with, as a literal string. OpenAPI 3
// server URLs may carry `{var}` templates with declared defaults; Swagger 2
// spells the same thing as schemes + host + basePath.
function baseUrlOf(root: Json): string {
  const servers = arr(root.servers);
  if (servers.length) {
    const first = obj(servers[0]);
    let url = str(first.url);
    for (const [name, spec] of Object.entries(obj(first.variables))) {
      const def = obj(spec).default;
      if (def !== undefined) url = url.split(`{${name}}`).join(String(def));
    }
    return url.replace(/\/+$/, '');
  }
  // Swagger 2.0
  const host = str(root.host);
  if (host) {
    const scheme = str(arr(root.schemes)[0]) || 'https';
    return `${scheme}://${host}${str(root.basePath)}`.replace(/\/+$/, '');
  }
  return str(root.basePath).replace(/\/+$/, '');
}

// ─── security ───────────────────────────────────────────────────────────────

// A security scheme becomes an Auth plus the collection variables its secrets
// should come from — the spec never carries credentials, so the values are
// {{placeholders}} the user fills in once per environment.
interface AuthMapping {
  auth: Auth;
  vars: string[];       // collection variable names the auth references
  warning?: string;
}

function authFromScheme(scheme: Json, schemeName: string): AuthMapping | null {
  const base = newAuth();
  const type = str(scheme.type).toLowerCase();

  if (type === 'http') {
    const httpScheme = str(scheme.scheme).toLowerCase();
    if (httpScheme === 'bearer') {
      return { auth: { ...base, type: 'bearer', token: '{{bearerToken}}' }, vars: ['bearerToken'] };
    }
    if (httpScheme === 'basic') {
      return { auth: { ...base, type: 'basic', username: '{{username}}', password: '{{password}}' }, vars: ['username', 'password'] };
    }
    if (httpScheme === 'digest') {
      return { auth: { ...base, type: 'digest', username: '{{username}}', password: '{{password}}' }, vars: ['username', 'password'] };
    }
    return { auth: base, vars: [], warning: `Security scheme "${schemeName}" uses HTTP ${httpScheme || 'auth'}, which has no equivalent — set auth manually.` };
  }

  if (type === 'apikey') {
    const placement = str(scheme.in) === 'query' ? 'query' : 'header';
    if (str(scheme.in) === 'cookie') {
      return { auth: base, vars: [], warning: `Security scheme "${schemeName}" is a cookie API key — add it in the Cookie manager instead.` };
    }
    return {
      auth: { ...base, type: 'apikey', apiKey: { key: str(scheme.name), value: '{{apiKey}}', placement } },
      vars: ['apiKey'],
    };
  }

  if (type === 'oauth2') {
    // OpenAPI 3 nests the endpoints under `flows`; Swagger 2 puts them flat on
    // the scheme. Only the two grants this app can actually run are mapped.
    const flows = obj(scheme.flows);
    const clientCreds = obj(flows.clientCredentials);
    const password = obj(flows.password);
    const flat = str(scheme.flow);
    const tokenUrl = str(clientCreds.tokenUrl) || str(password.tokenUrl) || str(scheme.tokenUrl);
    const isPassword = Object.keys(password).length > 0 || flat === 'password';
    if (!tokenUrl) {
      return { auth: base, vars: [], warning: `Security scheme "${schemeName}" uses an OAuth2 flow with no token URL — set auth manually.` };
    }
    const scopes = Object.keys(obj(isPassword ? password.scopes : clientCreds.scopes ?? scheme.scopes));
    return {
      auth: {
        ...base,
        type: 'oauth2',
        oauth2: {
          ...base.oauth2,
          grantType: isPassword ? 'password' : 'client_credentials',
          tokenUrl,
          clientId: '{{clientId}}',
          clientSecret: '{{clientSecret}}',
          scope: scopes.join(' '),
          username: isPassword ? '{{username}}' : '',
          password: isPassword ? '{{password}}' : '',
        },
      },
      vars: isPassword
        ? ['clientId', 'clientSecret', 'username', 'password']
        : ['clientId', 'clientSecret'],
    };
  }

  return { auth: base, vars: [], warning: `Security scheme "${schemeName}" (${type || 'unknown type'}) has no equivalent — set auth manually.` };
}

// Picks the first requirement in a `security` list that maps to something we
// can send. `security: []` explicitly means "no auth" and returns 'none'.
function resolveSecurity(
  security: unknown,
  schemes: Json,
  collect: (m: AuthMapping) => void,
): Auth | null {
  if (!Array.isArray(security)) return null;
  if (security.length === 0) return newAuth();   // explicit opt-out
  for (const requirement of security) {
    for (const name of Object.keys(obj(requirement))) {
      const scheme = obj(schemes[name]);
      if (!Object.keys(scheme).length) continue;
      const mapped = authFromScheme(scheme, name);
      if (!mapped) continue;
      collect(mapped);
      if (mapped.auth.type !== 'none') return mapped.auth;
    }
  }
  return null;
}

// ─── parameters & bodies ────────────────────────────────────────────────────

interface SplitParams {
  query: KeyValue[];
  path: KeyValue[];
  headers: KeyValue[];
  // Swagger 2.0 only: `in: body` / `in: formData` parameters, which OpenAPI 3
  // replaced with requestBody.
  bodySchema?: unknown;
  formData: { param: Json; isFile: boolean }[];
}

// Content-Type headers are dropped: the body mode already sets one (see
// request.ts's headersFor), and a duplicate from the spec would win over it.
const isContentTypeParam = (name: string) => name.toLowerCase() === 'content-type';

function splitParameters(params: unknown[], resolve: Resolver): SplitParams {
  const out: SplitParams = { query: [], path: [], headers: [], formData: [] };
  for (const raw of params) {
    const p = obj(resolve(raw));
    const name = str(p.name);
    if (!name) continue;
    // Swagger 2 puts the schema on the parameter itself; OpenAPI 3 nests it.
    const schema = p.schema ?? p;
    const required = p.required === true;
    const value = sampleAsText(schema, resolve);
    const kv: KeyValue = { ...newKeyValue(name, value), enabled: required };
    switch (str(p.in)) {
      case 'query': out.query.push(kv); break;
      // Path params have no meaning disabled — the URL will not resolve without
      // them — so they are always enabled.
      case 'path': out.path.push({ ...kv, enabled: true }); break;
      case 'header': if (!isContentTypeParam(name)) out.headers.push(kv); break;
      case 'body': out.bodySchema = p.schema; break;
      case 'formData': out.formData.push({ param: p, isFile: str(p.type) === 'file' }); break;
      default: break;
    }
  }
  return out;
}

const emptyBody = (): RequestBody => ({ mode: 'none', raw: '', form: [] });

const prettyJson = (value: unknown): string => JSON.stringify(value, null, 2);

// The example a media-type object offers, preferring an explicit `example`,
// then the first entry of `examples`, then one synthesized from the schema.
function mediaTypeExample(media: Json, resolve: Resolver): unknown {
  if (media.example !== undefined) return media.example;
  const first = Object.values(obj(media.examples))[0];
  if (isObj(first) && first.value !== undefined) return first.value;
  if (media.schema !== undefined) return sampleFromSchema(media.schema, resolve);
  return undefined;
}

// Picks the media type to build a body from: JSON when the operation accepts it
// (the overwhelmingly common case), otherwise whatever it lists first.
function pickMediaType(content: Json): string {
  const types = Object.keys(content);
  return types.find((t) => t.includes('json')) ?? types[0] ?? '';
}

function bodyFromRequestBody(
  requestBody: unknown,
  resolve: Resolver,
  warn: (msg: string) => void,
  label: string,
): RequestBody {
  const rb = obj(resolve(requestBody));
  const content = obj(rb.content);
  const type = pickMediaType(content);
  if (!type) return emptyBody();
  const media = obj(content[type]);

  if (type.includes('json')) {
    const example = mediaTypeExample(media, resolve);
    return { mode: 'json', raw: example === undefined ? '' : prettyJson(example), form: [] };
  }
  if (type.includes('x-www-form-urlencoded')) {
    const schema = obj(resolve(media.schema));
    const form = Object.entries(obj(schema.properties)).map(([key, prop]) =>
      newKeyValue(key, sampleAsText(prop, resolve)));
    return { mode: 'urlencoded', raw: '', form };
  }
  if (type.includes('multipart/')) {
    const schema = obj(resolve(media.schema));
    const form = Object.entries(obj(schema.properties)).map(([key, prop]) => {
      const p = obj(resolve(prop));
      // A binary-format string is a file upload; the user picks the file after
      // import, since a spec cannot carry one.
      const isFile = str(p.format) === 'binary';
      const kv = newKeyValue(key, isFile ? '' : sampleAsText(p, resolve));
      return isFile ? { ...kv, kind: 'file' as const } : kv;
    });
    return { mode: 'multipart', raw: '', form };
  }
  if (type.includes('xml')) {
    const example = mediaTypeExample(media, resolve);
    return { mode: 'xml', raw: typeof example === 'string' ? example : '', form: [] };
  }
  if (type.startsWith('text/')) {
    const example = mediaTypeExample(media, resolve);
    return { mode: 'text', raw: typeof example === 'string' ? example : '', form: [] };
  }

  warn(`${label}: body type "${type}" was not imported — set the body manually.`);
  return emptyBody();
}

// Swagger 2.0 body: either a single `in: body` schema or a set of `in: formData`
// parameters. `consumes` decides which form encoding to use.
function bodyFromSwagger2(
  split: SplitParams,
  consumes: string[],
  resolve: Resolver,
): RequestBody {
  if (split.bodySchema !== undefined) {
    const type = consumes.find((c) => c.includes('json')) ?? consumes[0] ?? 'application/json';
    const sample = sampleFromSchema(split.bodySchema, resolve);
    if (type.includes('xml')) return { mode: 'xml', raw: typeof sample === 'string' ? sample : '', form: [] };
    return { mode: 'json', raw: sample === undefined ? '' : prettyJson(sample), form: [] };
  }
  if (split.formData.length) {
    const multipart = split.formData.some((f) => f.isFile)
      || consumes.some((c) => c.includes('multipart/'));
    const form = split.formData.map(({ param, isFile }) => {
      const kv = newKeyValue(str(param.name), isFile ? '' : sampleAsText(param, resolve));
      return isFile ? { ...kv, kind: 'file' as const } : kv;
    });
    return { mode: multipart ? 'multipart' : 'urlencoded', raw: '', form };
  }
  return emptyBody();
}

// ─── request assembly ───────────────────────────────────────────────────────

// `/pets/{petId}` → `/pets/:petId`, the only path-parameter syntax the engine
// understands. `{{var}}` tokens are left alone — they are ordinary variables,
// not path parameters — which is why this matches a single brace pair only.
export function pathToColonSyntax(path: string): string {
  if (!path.includes('{')) return path;
  return path.replace(/\{\{[^{}]*\}\}|\{([^{}/]+)\}/g, (match, name: string | undefined) =>
    (name === undefined ? match : `:${name}`));
}

// A readable request name. `summary` is what a spec author writes for humans;
// operationId is machine-ish but better than nothing; the method + path always
// works as a last resort.
function requestName(op: Json, method: string, path: string): string {
  return str(op.summary).trim() || str(op.operationId).trim() || `${method.toUpperCase()} ${path}`;
}

// Path parameters the URL uses but the spec never declared. Without a value
// here the `:name` placeholder would be sent literally, so they are surfaced as
// empty rows the user can fill in.
function backfillPathParams(path: string, declared: KeyValue[]): KeyValue[] {
  const have = new Set(declared.map((p) => p.key));
  const extra: KeyValue[] = [];
  // Masking `{{var}}` out first keeps an ordinary variable token from being read
  // as a path parameter (`{{v}}` would otherwise yield the inner `{v}`).
  const masked = path.replace(/\{\{[^{}]*\}\}/g, '');
  for (const m of masked.matchAll(/\{([^{}/]+)\}/g)) {
    const name = m[1];
    if (have.has(name)) continue;
    have.add(name);
    extra.push(newKeyValue(name, ''));
  }
  return [...declared, ...extra];
}

interface OperationCtx {
  resolve: Resolver;
  schemes: Json;
  swagger2: boolean;
  baseUrl: string;
  collectAuth: (m: AuthMapping) => void;
  warn: (msg: string) => void;
  // Set when the collection itself carries auth, so an operation that doesn't
  // override it can inherit instead of repeating the credentials.
  hasCollectionAuth: boolean;
  rootConsumes: string[];
}

function importOperation(
  path: string,
  method: string,
  op: Json,
  pathLevelParams: unknown[],
  ctx: OperationCtx,
): ApiRequest {
  const { resolve } = ctx;
  const name = requestName(op, method, path);

  // Path-level parameters apply to every operation under the path; an operation
  // may override one by re-declaring the same name + location.
  const merged = [...pathLevelParams, ...arr(op.parameters)];
  const seen = new Map<string, unknown>();
  for (const raw of merged) {
    const p = obj(resolve(raw));
    seen.set(`${str(p.in)}:${str(p.name)}`, raw);
  }
  const split = splitParameters([...seen.values()], resolve);

  const body = ctx.swagger2
    ? bodyFromSwagger2(split, [...ctx.rootConsumes, ...arr(op.consumes).map(str)], resolve)
    : bodyFromRequestBody(op.requestBody, resolve, ctx.warn, name);

  const opAuth = resolveSecurity(op.security, ctx.schemes, ctx.collectAuth);
  const auth: Auth = opAuth ?? (ctx.hasCollectionAuth ? { ...newAuth(), type: 'inherit' } : newAuth());

  const upper = method.toUpperCase();
  return {
    type: 'request',
    id: uid(),
    name,
    method: (HTTP_METHODS as readonly string[]).includes(upper) ? (upper as HttpMethod) : 'GET',
    url: `${ctx.baseUrl}${pathToColonSyntax(path)}`,
    params: split.query,
    pathParams: backfillPathParams(path, split.path),
    headers: split.headers,
    body,
    auth,
    script: { req: '', res: '' },
    assertions: [],
    tests: '',
    settings: newSettings(),
  };
}

// ─── import ─────────────────────────────────────────────────────────────────

// Parse an OpenAPI 3.x / Swagger 2.0 document (already parsed from JSON or
// YAML) into our Collection model. Throws when the shape clearly isn't a spec.
export function importOpenApi(doc: unknown): OpenApiImport {
  if (!isObj(doc)) throw new Error('Not an OpenAPI document (expected an object)');
  const root = doc;
  if (!isOpenApiDocument(root)) {
    throw new Error('Not an OpenAPI document (missing "openapi" or "swagger" version)');
  }
  const paths = obj(root.paths);
  if (!Object.keys(paths).length) {
    throw new Error('OpenAPI document has no paths to import');
  }

  const swagger2 = str(root.swagger).startsWith('2.');
  const resolve = makeResolver(root);
  const schemes = swagger2
    ? obj(root.securityDefinitions)
    : obj(obj(root.components).securitySchemes);

  const warnings: string[] = [];
  const warn = (msg: string) => { if (!warnings.includes(msg)) warnings.push(msg); };

  // Every {{var}} an imported auth references becomes an empty collection
  // variable, so the user sees exactly what needs filling in and where.
  const authVars = new Set<string>();
  const collectAuth = (m: AuthMapping) => {
    for (const v of m.vars) authVars.add(v);
    if (m.warning) warn(m.warning);
  };

  const collectionAuth = resolveSecurity(root.security, schemes, collectAuth);
  const baseUrl = baseUrlOf(root);

  const ctx: OperationCtx = {
    resolve,
    schemes,
    swagger2,
    baseUrl: baseUrl ? '{{baseUrl}}' : '',
    collectAuth,
    warn,
    hasCollectionAuth: !!collectionAuth && collectionAuth.type !== 'none',
    rootConsumes: arr(root.consumes).map(str),
  };

  // Operations are grouped by their first tag, mirroring how the spec's own
  // docs are organized. Insertion order is preserved so folders come out in the
  // order the paths declare them, with `tags` (when present) leading.
  const folders = new Map<string, TreeItem[]>();
  for (const tag of arr(root.tags)) {
    const tagName = str(obj(tag).name);
    if (tagName) folders.set(tagName, []);
  }
  const untagged: TreeItem[] = [];

  for (const [path, rawPathItem] of Object.entries(paths)) {
    const pathItem = obj(resolve(rawPathItem));
    const pathLevelParams = arr(pathItem.parameters);
    for (const method of SPEC_METHODS) {
      const op = pathItem[method];
      if (!isObj(op)) continue;
      if (method === 'trace') {
        warn(`TRACE ${path} was skipped — the client cannot send TRACE requests.`);
        continue;
      }
      const request = importOperation(path, method, op, pathLevelParams, ctx);
      const tag = str(arr(op.tags)[0]);
      if (!tag) { untagged.push(request); continue; }
      const bucket = folders.get(tag);
      if (bucket) bucket.push(request);
      else folders.set(tag, [request]);
    }
  }

  // A tag declared in `tags` but used by no operation would import as an empty
  // folder; drop those rather than clutter the tree.
  const items: TreeItem[] = [];
  for (const [name, children] of folders) {
    if (!children.length) continue;
    const folder: Folder = { type: 'folder', id: uid(), name, items: children };
    items.push(folder);
  }
  items.push(...untagged);

  const variables: KeyValue[] = [];
  if (baseUrl) variables.push(newKeyValue('baseUrl', baseUrl));
  for (const name of authVars) variables.push(newKeyValue(name, ''));

  const collection: Collection = {
    id: uid(),
    name: str(obj(root.info).title).trim() || 'Imported API',
    items,
    variables,
  };
  if (collectionAuth && collectionAuth.type !== 'none') collection.auth = collectionAuth;

  return { collection, warnings };
}
