// devtool-mcp-server — MCP stdio server bundled with the DevTool app as a
// Tauri sidecar (see tauri.conf.json's bundle.externalBin), so someone who
// installed DevTool from a binary (dmg/msi/deb/AppImage) can point their MCP
// client straight at it — no Node.js / npm install needed.
//
// It never runs inside the app itself. The app's Tauri backend
// (mcp_bridge.rs) starts a small loopback HTTP control server on launch and
// writes its port + auth token to `<app_data_dir>/mcp-bridge.json` for this
// process to read. Every MCP tool call this process receives over stdio is
// forwarded there as a `POST /call`, which the app hands to the running
// webview to answer — so an API Client tool call (list_collections,
// get_request, etc.) only succeeds while DevTool is open with the API Client
// tool on screen, and a `mock_*` call only while it's open with the Mock
// Server tool on screen (get_scripting_reference is the one exception —
// answered locally, see its own comment below). See
// src-tauri/src/mcp_bridge.rs for the full design, and
// src/components/tools/apiclient/mcpBridge.ts /
// src/components/tools/mockserver/mcpBridge.ts for what each tool actually does.
//
// Built on rmcp (the official Rust MCP SDK) for the protocol itself —
// JSON-RPC framing, capability negotiation, tool routing all come from the
// crate rather than being hand-rolled. What IS hand-rolled: talking to
// mcp_bridge.rs. That's a single localhost POST, so a minimal async
// HTTP/1.1 client over a raw `tokio::net::TcpStream` (tokio is already a
// dependency of rmcp itself, and of the main app) is less risk than pulling
// in a full HTTP client crate for one call shape.

use std::future::Future;
use std::path::PathBuf;
use std::pin::Pin;
use std::time::Duration;

use rmcp::handler::server::router::tool::{ToolRoute, ToolRouter};
use rmcp::handler::server::tool::ToolCallContext;
use rmcp::model::{
    CallToolRequestParams, CallToolResult, Content, ErrorData as McpError, Implementation,
    ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerInfo, Tool,
};
use rmcp::service::RequestContext;
use rmcp::transport::io::stdio;
use rmcp::{RoleServer, ServerHandler, ServiceExt};

use serde::Deserialize;
use serde_json::{json, Value};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

// Must match `identifier` in tauri.conf.json — Tauri's app_data_dir is keyed
// off it, and mcp_bridge.rs writes its discovery file there.
const APP_IDENTIFIER: &str = "com.desktop-devtool-app";
// How long to wait for a reply from the bridge — matches CALL_TIMEOUT in
// mcp_bridge.rs (30s) plus slack for the local round-trip.
const CALL_TIMEOUT: Duration = Duration::from_secs(35);

// ── locating the running app ─────────────────────────────────────────────

// Tauri's app_data_dir() resolution, per platform — mirrors what
// mcp_bridge.rs's write_discovery_file() actually resolves to at runtime
// (this binary has no AppHandle of its own to ask, since it's a separate
// process the MCP client spawns directly).
fn app_data_dir() -> PathBuf {
    #[cfg(target_os = "macos")]
    {
        let home = std::env::var("HOME").unwrap_or_default();
        PathBuf::from(home).join("Library/Application Support").join(APP_IDENTIFIER)
    }
    #[cfg(target_os = "windows")]
    {
        let appdata = std::env::var("APPDATA").unwrap_or_default();
        PathBuf::from(appdata).join(APP_IDENTIFIER)
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = std::env::var("XDG_DATA_HOME").unwrap_or_else(|_| {
            let home = std::env::var("HOME").unwrap_or_default();
            format!("{home}/.local/share")
        });
        PathBuf::from(base).join(APP_IDENTIFIER)
    }
}

#[derive(Deserialize)]
struct BridgeInfo {
    port: u16,
    token: String,
}

fn read_bridge_info() -> Result<BridgeInfo, String> {
    let path = app_data_dir().join("mcp-bridge.json");
    let text = std::fs::read_to_string(&path).map_err(|_| {
        format!(
            "DevTool doesn't seem to have started its MCP bridge yet (no file at {}). Open the DevTool app and try again.",
            path.display()
        )
    })?;
    serde_json::from_str(&text)
        .map_err(|_| "DevTool's MCP bridge file is malformed — restart the app.".to_string())
}

// Decodes an HTTP/1.1 chunked body: repeated `<hex size>\r\n<data>\r\n`,
// terminated by a zero-size chunk. Malformed input just stops decoding at
// whatever chunk it can't parse, rather than panicking — the caller's JSON
// parse of the (possibly incomplete) result surfaces that as an error.
fn dechunk(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    let mut pos = 0;
    while pos < input.len() {
        let Some(line_end) = input[pos..].windows(2).position(|w| w == b"\r\n") else { break };
        let size_line = String::from_utf8_lossy(&input[pos..pos + line_end]);
        let Ok(size) = usize::from_str_radix(size_line.trim(), 16) else { break };
        pos += line_end + 2;
        if size == 0 {
            break;
        }
        if pos + size > input.len() {
            break;
        }
        out.extend_from_slice(&input[pos..pos + size]);
        pos += size + 2; // skip the chunk's trailing \r\n
    }
    out
}

async fn http_post_json(port: u16, token: &str, body: &Value) -> Result<Value, String> {
    let payload = serde_json::to_vec(body).map_err(|e| e.to_string())?;
    let mut stream = tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(("127.0.0.1", port)))
        .await
        .map_err(|_| format!("Timed out connecting to DevTool on 127.0.0.1:{port}."))?
        .map_err(|e| format!("Could not reach DevTool on 127.0.0.1:{port} ({e}). Is the app open?"))?;

    let request = format!(
        "POST /call HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len(),
    );
    stream.write_all(request.as_bytes()).await.map_err(|e| e.to_string())?;
    stream.write_all(&payload).await.map_err(|e| e.to_string())?;

    let mut raw = Vec::new();
    tokio::time::timeout(CALL_TIMEOUT, stream.read_to_end(&mut raw))
        .await
        .map_err(|_| "Timed out waiting for DevTool's response.".to_string())?
        .map_err(|e| e.to_string())?;

    let split_at = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| "Malformed HTTP response from DevTool's MCP bridge.".to_string())?;
    let (head, rest) = raw.split_at(split_at);
    let raw_body = &rest[4..];
    let head_str = String::from_utf8_lossy(head);
    let status: u16 = head_str
        .lines()
        .next()
        .unwrap_or("")
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .unwrap_or(0);
    // axum's `Json` responses always send Content-Length (verified against a
    // real axum server, not chunked), but decode chunked too just in case —
    // cheap insurance for a binary that ships to every install of the app.
    let is_chunked = head_str
        .lines()
        .any(|l| l.to_ascii_lowercase().starts_with("transfer-encoding") && l.to_ascii_lowercase().contains("chunked"));
    let body_bytes = if is_chunked { dechunk(raw_body) } else { raw_body.to_vec() };

    let json: Value = serde_json::from_slice(&body_bytes)
        .map_err(|_| format!("DevTool's MCP bridge returned a non-JSON response (HTTP {status})."))?;

    if !(200..300).contains(&status) {
        let msg = json.get("error").and_then(|e| e.as_str()).unwrap_or("");
        return Err(if msg.is_empty() {
            format!("DevTool's MCP bridge returned HTTP {status}.")
        } else {
            msg.to_string()
        });
    }
    if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
        return Err(err.to_string());
    }
    Ok(json.get("result").cloned().unwrap_or(Value::Null))
}

async fn call_bridge(tool: &str, args: Value) -> Result<Value, String> {
    let info = read_bridge_info()?;
    http_post_json(info.port, &info.token, &json!({ "tool": tool, "args": args })).await
}

// Static reference for BOTH tools' scripting engines and the field shapes
// their patch-style tools expect — see `src/components/tools/apiclient/
// runtime.ts` (dt/req/res/pm/expect/assert) and `types.ts` (Auth/
// RequestBody/RequestSettings/KeyValue) for the API Client half, and
// `src-tauri/src/mockserver.rs` (`req_to_rhai`/`run_script`) and
// `src/components/tools/mockserver/types.ts` (Stub/Matcher/MockConfig) for
// the Mock Server half, as the source of truth. Answered locally (no bridge
// round-trip, no running app required) since it's static content, not live
// app state — and served on demand as its own tool rather than folded into
// every other tool's description, so its size is only spent when a caller
// actually needs it instead of on every tool listing.
const SCRIPTING_REFERENCE: &str = r#"# DevTool API Client — scripting & field-shape reference

Pre/post-request scripts are plain JS (Bruno-shaped API, own naming — see
"Naming: dt, not bru" below), run sandboxed. A request's own script/auth/
headers live on the request itself (patch via update_request); a
collection/folder's inherited script/auth/headers are set via
set_node_script/set_node_auth/set_node_headers (nodeId=null = collection
root, nodeId=<folderId> = that folder). A request's own header/auth of the
same name overrides what it inherits; auth.type="inherit" pulls from the
nearest ancestor's auth.

## Naming: dt, not bru
This engine's variable/flow-control global is `dt` — same shape as Bruno's
own `bru` (getCollectionVar, setEnvVar, interpolate, setNextRequest, sleep,
...), different name, so it reads as this app's own primitive rather than
something borrowed from another app. A script written against real Bruno
that calls `bru.*` will NOT work here — there is no `bru` compatibility
alias, only `dt`. Postman's `pm.*`/`postman.*` shim is unaffected by this
and still uses Postman's own real names, for import compatibility with
scripts written against Postman.

## Execution order (one send)
inherited pre-request scripts (collection, then folder, outer to inner) ->
the request's own pre-request script -> the HTTP send -> the request's own
post-response script -> inherited post-response scripts -> the test script
-> declarative assertions. A pre-request failure stops the send entirely (a
request built by a script that threw is not worth sending); a
post-response/test/assertion failure is recorded and everything after it
still runs.

## Variable precedence (both {{var}} substitution and dt.getVars())
collectionVar < globalEnv < collectionEnv < data-file row
(Vault is intentionally excluded from this whole MCP surface.)

## dt.* — variables & flow control (available in both req/res scripts)
- getCollectionVar(k) / setCollectionVar(k, v) / hasCollectionVar(k) / deleteCollectionVar(k)
- getEnvVar(k, scope?) / setEnvVar(k, v, scope='collection') / hasEnvVar(k, scope?) / deleteEnvVar(k, scope='collection')
  scope is 'collection' | 'global'; a read with no scope falls through collection -> global.
- getEnvName(scope?)  — active environment's name
- getIterationData(k) — current data-file row (data-driven runs only)
- interpolate(text)   — expands {{tokens}} exactly like the send pipeline
- getVars()           — merged VarMap at current precedence
- setNextRequest(name | null) — Runner flow control (ignored for a single Send)
- sleep(ms)           — pauses the script; rejects if the send is cancelled

## req.* — pre-request script only (mutates the outgoing request draft)
url / method (getters), getName(), getUrl()/setUrl(url), getMethod()/setMethod(m),
getHeaders()/getHeader(name)/setHeader(name, value)/deleteHeader(name),
getParams()/getParam(name)/setParam(name, value)/deleteParam(name),
getTimeout()/setTimeout(ms), setMaxRedirects(n), disableRedirects(),
getBody() (parses JSON body mode), setBody(data) (object -> JSON body, else text body)

## res.* — post-response script / test / assert only
status, statusText, headers, body (getters); responseTime;
getStatus()/getStatusText()/getHeader(name)/getHeaders()/getBody()/setBody(v)/
getResponseTime()/getSize()/getContentType()/getUrl()/isOk()

## test(name, fn) + expect(actual, message?) — Chai-style BDD subset
Chains (no-ops): to/be/been/is/that/which/and/has/have/with/of/at/itself/deep/own/nested/any/all, .not (negates)
Terminal matchers: .equal(v) .eql(v) .a(type)/.an(type) .above(n) .least(n) .below(n) .most(n)
.include(v)/.contain(v) .match(re) .lengthOf(n) .property(name, value?) .keys(...names)
.oneOf(list) .closeTo(n, delta)/.approximately(n, delta) .greaterThan(n)/.lessThan(n)
.instanceOf(ctor) .throw(expected?)/.throws(expected?)
Getters: .ok .true .false .null .undefined .exist .NaN .finite .empty

## assert.* — Chai `assert` style (callable: assert(cond, msg))
ok/isOk, isNotOk, fail, equal, notEqual, strictEqual, notStrictEqual, deepEqual,
notDeepEqual, isTrue, isFalse, isNull, isNotNull, isUndefined, isDefined, exists,
isArray, isString, isNumber, isBoolean, isObject, isFunction, include, match,
lengthOf, typeOf

## pm.* / postman.* — Postman-compatibility shim (for imported Postman scripts)
pm.test, pm.expect — same as test()/expect() above
pm.environment.{get,set,has,unset,name,replaceIn(text)} — collection-scoped env
pm.collectionVariables.{get,set,has,unset}
pm.globals.{get,set,has,unset} — global env
pm.iterationData.get(k)
pm.request — same as req.* (post-response scripts only)
pm.execution.setNextRequest(name)  |  postman.setNextRequest(name) (legacy form)
pm.response — code, status, responseTime, responseSize, json(), text(), size(),
  headers.get(name)/has(name), to.have.status(n|text)/header(name, value?)/body(text?)/jsonBody(),
  to.be.ok/success/redirection/clientError/serverError/error/accepted/badRequest/unauthorized/forbidden/notFound

console.log/info/warn/error/debug/trace/dir/table(v) are all available and captured as script logs.

## require(name) — curated bundled modules (never require(anything))
'crypto-js', 'uuid', 'nanoid', 'lodash', 'jwt-decode' ({ jwtDecode }), 'dayjs', 'jose',
'jsonwebtoken', 'ajv', 'xml2js', 'cheerio' — the same set Postman's and Bruno's own
script sandboxes bundle.

'jose' is exposed with its native API (SignJWT, jwtVerify, importPKCS8, importSPKI,
generateKeyPair, ...) — see https://github.com/panva/jose for the full surface.

'jsonwebtoken' is a same-shaped shim over 'jose' (the real npm package is Node-only —
crypto/Buffer — and cannot run in this app's webview at all): { sign, verify, decode,
JsonWebTokenError, TokenExpiredError, NotBeforeError }. Two deliberate differences
from the real package:
- sign(payload, secretOrPrivateKeyPem, opts) and verify(token, secretOrPublicKeyPem, opts)
  are both async (await them) — Web Crypto has no synchronous signing API.
- verify() REQUIRES opts.algorithms (e.g. { algorithms: ['HS256'] }) — the token's own
  "alg" header is never trusted to pick the algorithm, since that is exactly how
  algorithm-confusion attacks work.
Supported algorithms: HS256/384/512 (secretOrPrivateKeyPem is a plain string/Uint8Array
secret), RS256/384/512 and PS256/384/512 and ES256/384/512 and EdDSA (secretOrPrivateKeyPem
must be a PEM string — PKCS8 "-----BEGIN PRIVATE KEY-----" to sign, SPKI
"-----BEGIN PUBLIC KEY-----" to verify). sign()'s numeric expiresIn/notBefore are seconds
from now (a duration), matching the real package — NOT an absolute Unix timestamp.

'ajv' is the class itself (const Ajv = require('ajv'); new Ajv().compile(schema)),
matching Postman/Bruno's own require('ajv') shape — use it to schema-validate a JSON
response body. 'xml2js' (parseString/parseStringPromise) parses an XML/SOAP response
into a plain object. 'cheerio' (require('cheerio').load(html)) queries/scrapes an HTML
response with a jQuery-like API. 'nanoid' is { nanoid, customAlphabet } — a second,
shorter/URL-safe id generator alongside 'uuid'.

## Declarative Assertions (the request's `assertions` array — NOT run as JS)
Each row: { expr, operator, value, enabled }. `expr` is a restricted expression
language over `res`/`req`/`dt` — property paths, indices, one level of method
calls, literals, arithmetic/comparison/logical operators (e.g. `res.status`,
`res.body.items[0].id`, `res.status === 200`) — no assignment, no arbitrary code.
operator is one of: equals, notEquals, gt, gte, lt, lte, in, notIn, contains,
notContains, length, matches, notMatches, startsWith, endsWith, between,
isEmpty, isNotEmpty, isNull, isUndefined, isDefined, isTruthy, isFalsy, isJson,
isNumber, isString, isBoolean, isArray (the isX/is*Empty/isTruthy/isFalsy family
and isDefined/isUndefined/isNull take no `value`).

## Field shapes for update_request's patch / set_node_auth / set_node_headers

KeyValue (params/headers/form rows, and env/collection variables):
{ id, key, value, enabled, kind?: 'text'|'file', contentType?, fileName?, fileType?, fileContent?(base64), secret? }
`secret: true` (env variables only) masks the value in the UI and keeps it out
of generated code/cURL/history — this is the UI's own scoping, unrelated to
and much weaker than the Vault, which this MCP surface never exposes at all.

RequestBody: { mode: 'none'|'json'|'xml'|'text'|'sparql'|'graphql'|'multipart'|'urlencoded'|'file',
  raw, form: KeyValue[], graphql?: { query, variables }, fileName?, fileType?, fileContent?(base64) }

Auth: { type: 'none'|'inherit'|'bearer'|'basic'|'digest'|'apikey'|'oauth2',
  token, username, password,
  apiKey: { key, value, placement: 'header'|'query' },
  oauth2: { grantType: 'client_credentials'|'password', tokenUrl, clientId, clientSecret, scope, username, password } }

RequestSettings: { encodeUrl, followRedirects, maxRedirects, timeout, tags: string[], verifyTls }

RequestScript: { req: string, res: string }  — pre-request / post-response JS source

---

# Mock Server — scripting & field-shape reference (separate engine from the API Client's)

A stub's response is either `mode: "static"` (fixed status/headers/body) or
`mode: "script"`, whose `script` is Rhai — NOT JavaScript, and NOT the same
sandbox/API as the API Client's dt/req/res above. Use mock_test_script to run
one against a sample request before saving it via mock_add_stub/mock_update_stub.

## The `req` object available to a script
#{ method, path, body, query: #{...}, headers: #{...}, params: #{...} }
(`params` = path placeholders matched from the stub's `path`, e.g. `/users/:id`.)
All values are strings; `query`/`headers`/`params` are Rhai maps (`#{...}`), so
read a key with `req.query["name"]` (bracket indexing, not dot-access, since
the key is data not a fixed identifier).

## Return value
Either a plain string (used as the response body, status 200), or a map:
#{ status: 201, headers: #{ "content-type": "application/json" }, body: "..." }
`status` defaults to 200 if omitted; `headers` and `body` are optional (body
defaults to empty). A script that throws/errors produces a 500 with the error
as the body — mock_test_script's `error` field surfaces this directly instead.

Rhai syntax notes for a JS-fluent caller: maps are `#{ key: value }` (not
`{}`), string interpolation is `` `${var}` `` inside backticks, and there is no
`===`/`!==` (`==`/`!=` only).

## Field shapes for mock_add_stub/mock_update_stub's patch, mock_set_fallback, mock_set_bind

Stub: { id, enabled, name, method: 'ANY'|'GET'|'POST'|'PUT'|'PATCH'|'DELETE'|'HEAD'|'OPTIONS',
  path, matchers: Matcher[], mode: 'static'|'script', status, headers: KeyValue[],
  body, bodyType: 'text'|'json'|'base64', fileName, script, delayMs }
`path` supports `:param` placeholders (e.g. `/users/:id`), readable from
scripts via `req.params` and matchable via a `path`-target Matcher. `bodyType`
only governs how `body` is interpreted/served in static mode (`base64` sets
Content-Disposition from `fileName`); it has no effect in script mode, where
the script's returned `body` is always sent as-is. `delayMs` artificially
delays the response (simulating latency).

Matcher: { id, target: 'query'|'header'|'body'|'path', op: 'equals'|'contains'|'regex'|'exists',
  key, value }. All of a stub's enabled matchers must pass for it to match; a
stub with none matches every request to its method+path. For a `body` target,
an empty `key` matches the whole body as text; a non-empty `key` is a dotted
JSON field path (e.g. `user.name`, `tags.1`) evaluated against the parsed
JSON body. `exists` ignores `value`.

MockConfig-level fields (mock_get_config / mock_set_fallback / mock_set_bind):
host, port (bind address — mock_set_bind, takes effect on the next mock_start),
notFoundStatus, notFoundBody, notFoundContentType (the fallback response for
when no stub matches — mock_set_fallback).
"#;

async fn call_tool(name: &str, args: Value) -> CallToolResult {
    match call_bridge(name, args).await {
        // Compact, not pretty-printed: indentation whitespace is pure token
        // overhead once this lands in Claude's context, and the JSON reads
        // fine compact for a model.
        Ok(v) => {
            let text = serde_json::to_string(&v).unwrap_or_else(|_| v.to_string());
            CallToolResult::success(vec![Content::text(text)])
        }
        Err(e) => CallToolResult::error(vec![Content::text(e)]),
    }
}

// ── tool catalogue ───────────────────────────────────────────────────────
// Kept in sync by hand with the actual handlers in
// src/components/tools/apiclient/mcpBridge.ts and
// src/components/tools/mockserver/mcpBridge.ts.

fn kv_array_schema() -> Value {
    json!({
        "type": "array",
        "items": {
            "type": "object",
            "properties": {
                "id": { "type": "string" },
                "key": { "type": "string" },
                "value": { "type": "string" },
                "enabled": { "type": "boolean" }
            },
            "required": ["id", "key", "value", "enabled"]
        }
    })
}

fn nullable_string() -> Value {
    json!({ "type": ["string", "null"] })
}

fn tool_definitions() -> Vec<Value> {
    let where_schema = json!({ "type": "string", "enum": ["before", "after", "inside"], "default": "inside" });

    vec![
        json!({
            "name": "list_collections",
            "description": "List every collection open in DevTool's API Client, with their folder/request tree (id, name, method, url — no bodies/scripts/secrets).",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "get_collection",
            "description": "Get one collection by id, including its own script/auth/headers/variables (not its requests' bodies — use get_request for those).",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" } }, "required": ["collectionId"] }
        }),
        json!({
            "name": "get_request",
            "description": "Get the full definition of one request by id: method, url, params, headers, body, auth, pre/post-request script, tests, assertions, settings.",
            "inputSchema": { "type": "object", "properties": { "requestId": { "type": "string" } }, "required": ["requestId"] }
        }),
        json!({
            "name": "update_request",
            "description": "Patch a request in place. `patch` is a partial ApiRequest — only included fields change (e.g. { \"url\", \"method\", \"body\": { \"mode\", \"raw\", \"form\" } }). Set patch.script = { req, res } for its pre/post-request script.",
            "inputSchema": {
                "type": "object",
                "properties": { "requestId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["requestId", "patch"]
            }
        }),
        json!({
            "name": "create_request",
            "description": "Create a new request in a collection (optionally inside a folder) and return it. `request` is a partial ApiRequest used as the initial values.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "folderId": { "type": "string" }, "request": { "type": "object" } },
                "required": ["collectionId"]
            }
        }),
        json!({
            "name": "run_request",
            "description": "Send a request through DevTool (same engine as Send): pre-request script → send → post-response script → tests/assertions → History. Returns response (body capped), tests, logs, and any error. Pass environmentId to override the active environment (null = \"No Environment\").",
            "inputSchema": {
                "type": "object",
                "properties": { "requestId": { "type": "string" }, "environmentId": nullable_string() },
                "required": ["requestId"]
            }
        }),
        json!({
            "name": "add_folder",
            "description": "Create a folder in a collection (optionally nested inside another folder) and return its id.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "name": { "type": "string" }, "parentId": { "type": "string" } },
                "required": ["collectionId"]
            }
        }),
        json!({
            "name": "rename_item",
            "description": "Rename a request or folder by id.",
            "inputSchema": { "type": "object", "properties": { "itemId": { "type": "string" }, "name": { "type": "string" } }, "required": ["itemId", "name"] }
        }),
        json!({
            "name": "delete_item",
            "description": "Delete a request or a folder (and everything inside it) by id.",
            "inputSchema": { "type": "object", "properties": { "itemId": { "type": "string" } }, "required": ["itemId"] }
        }),
        json!({
            "name": "clone_item",
            "description": "Duplicate a request or folder as a new sibling right after it.",
            "inputSchema": { "type": "object", "properties": { "itemId": { "type": "string" } }, "required": ["itemId"] }
        }),
        json!({
            "name": "move_item",
            "description": "Move (cut) a request or folder to a new spot. `targetId` may be a collection id (moves to its root), or a request/folder id combined with `where`: \"before\"/\"after\" that sibling, or \"inside\" it (folders only).",
            "inputSchema": {
                "type": "object",
                "properties": { "sourceId": { "type": "string" }, "targetId": { "type": "string" }, "where": where_schema.clone() },
                "required": ["sourceId", "targetId"]
            }
        }),
        json!({
            "name": "copy_item",
            "description": "Copy (not cut) a request or folder to a new spot — same targeting as move_item, but the source is left in place.",
            "inputSchema": {
                "type": "object",
                "properties": { "sourceId": { "type": "string" }, "targetId": { "type": "string" }, "where": where_schema },
                "required": ["sourceId", "targetId"]
            }
        }),
        json!({
            "name": "add_collection",
            "description": "Create a new, empty collection and return its id.",
            "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } } }
        }),
        json!({
            "name": "rename_collection",
            "description": "Rename a collection by id.",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" }, "name": { "type": "string" } }, "required": ["collectionId", "name"] }
        }),
        json!({
            "name": "delete_collection",
            "description": "Delete a collection (and everything inside it) by id. Also drops any environments scoped to it.",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" } }, "required": ["collectionId"] }
        }),
        json!({
            "name": "clone_collection",
            "description": "Duplicate a whole collection (deep copy, fresh ids for everything inside) right after the original.",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" } }, "required": ["collectionId"] }
        }),
        json!({
            "name": "set_collection_variables",
            "description": "Replace a collection's Collection Variables (shared defaults available to every request in it, regardless of active environment). Pass the full array you want it to end up with.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "variables": kv_array_schema() },
                "required": ["collectionId", "variables"]
            }
        }),
        json!({
            "name": "set_node_script",
            "description": "Set the pre/post-request script inherited by every request under a collection/folder. nodeId=null (or omitted) = collection root; a folder id = that folder. A request's own script is set via update_request's patch.script instead.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "collectionId": { "type": "string" },
                    "nodeId": nullable_string(),
                    "script": {
                        "type": "object",
                        "properties": { "req": { "type": "string" }, "res": { "type": "string" } },
                        "required": ["req", "res"]
                    }
                },
                "required": ["collectionId", "script"]
            }
        }),
        json!({
            "name": "set_node_auth",
            "description": "Set the auth inherited by requests with auth.type=\"inherit\" under a collection/folder. nodeId=null (or omitted) = collection root; a folder id = that folder. A request's own auth is set via update_request's patch.auth instead.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "nodeId": nullable_string(), "auth": { "type": "object" } },
                "required": ["collectionId", "auth"]
            }
        }),
        json!({
            "name": "set_node_headers",
            "description": "Set the headers added to every request under a collection/folder (a request's own header of the same name overrides it). nodeId=null (or omitted) = collection root; a folder id = that folder. A request's own headers are set via update_request's patch.headers instead.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "nodeId": nullable_string(), "headers": kv_array_schema() },
                "required": ["collectionId", "headers"]
            }
        }),
        json!({
            "name": "list_environments",
            "description": "List every environment (global and collection-scoped) with id, name, and owning collectionId (null = global).",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "get_environment",
            "description": "Get one environment by id, including its variables (values are returned as stored — a variable marked secret is not masked here, unlike the UI's quick-view).",
            "inputSchema": { "type": "object", "properties": { "environmentId": { "type": "string" } }, "required": ["environmentId"] }
        }),
        json!({
            "name": "update_environment",
            "description": "Patch an environment. `patch` is a partial Environment object, most commonly { \"variables\": [...] } — pass the full variables array you want it to end up with.",
            "inputSchema": {
                "type": "object",
                "properties": { "environmentId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["environmentId", "patch"]
            }
        }),
        json!({
            "name": "set_active_environment",
            "description": "Activate an environment. scope=\"global\" sets the active Global env; scope=\"collection\" (default) sets it for one collection (pass collectionId). environmentId=null clears it (\"No Environment\").",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["global", "collection"], "default": "collection" },
                    "collectionId": { "type": "string" },
                    "environmentId": nullable_string()
                },
                "required": ["environmentId"]
            }
        }),
        json!({
            "name": "add_environment",
            "description": "Create a new environment and return its id. Omit collectionId for a global environment; pass one to scope it to that collection.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "name": { "type": "string" }, "variables": kv_array_schema() }
            }
        }),
        json!({
            "name": "duplicate_environment",
            "description": "Clone an environment (same scope, \"<name> copy\", fresh ids for every variable row) and return the new id.",
            "inputSchema": { "type": "object", "properties": { "environmentId": { "type": "string" } }, "required": ["environmentId"] }
        }),
        json!({
            "name": "delete_environment",
            "description": "Delete an environment by id. Clears it from wherever it was the active choice.",
            "inputSchema": { "type": "object", "properties": { "environmentId": { "type": "string" } }, "required": ["environmentId"] }
        }),
        json!({
            "name": "get_scripting_reference",
            "description": "Read-only reference for both tools' scripting APIs and field shapes: API Client's dt/req/res/pm JS engine (variable precedence, assertions, Auth/RequestBody/KeyValue shapes) and Mock Server's Rhai response-script engine (a separate language — req shape, return shape, Stub/Matcher shapes). Call before writing/editing a script, auth, assertions, or a stub. Answered locally — works even if DevTool isn't open.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "import_environment",
            "description": "Create an environment with a name, scope, and full variable set in one call (e.g. importing one from another tool). Returns the new id.",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string" }, "collectionId": nullable_string(), "variables": kv_array_schema() },
                "required": ["name"]
            }
        }),

        // ── Mock Server ──────────────────────────────────────────────────
        // Only answers while DevTool is open with the Mock Server tool on
        // screen — same contract as the API Client tools above, for the same
        // reason (the stub list and bind config live in that mounted
        // component's state, not anywhere the sidecar can reach on its own).
        json!({
            "name": "mock_get_config",
            "description": "Get the mock server's bind (host/port), fallback response, running status, and a summarized stub list (id/enabled/name/method/path/mode/status — not matchers/headers/body/script). Use mock_get_stub for one stub's full definition.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "mock_get_stub",
            "description": "Get one stub's full definition: matchers, response mode, status, headers, body (or script for scripted responses), delay.",
            "inputSchema": { "type": "object", "properties": { "stubId": { "type": "string" } }, "required": ["stubId"] }
        }),
        json!({
            "name": "mock_add_stub",
            "description": "Add a new stub. `stub` is a partial Stub object for the initial values (defaults: enabled=true, method=GET, mode=static — see get_scripting_reference for field shapes). Returns the created stub, appended to the end; reorder with mock_move_stub since stub order matters (first match wins).",
            "inputSchema": { "type": "object", "properties": { "stub": { "type": "object" } } }
        }),
        json!({
            "name": "mock_update_stub",
            "description": "Patch a stub in place. `patch` is a partial Stub object — only the fields you include are changed.",
            "inputSchema": {
                "type": "object",
                "properties": { "stubId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["stubId", "patch"]
            }
        }),
        json!({
            "name": "mock_duplicate_stub",
            "description": "Duplicate a stub (fresh id, \"<name> copy\") as the next stub right after the original. Returns the new stub.",
            "inputSchema": { "type": "object", "properties": { "stubId": { "type": "string" } }, "required": ["stubId"] }
        }),
        json!({
            "name": "mock_delete_stub",
            "description": "Delete a stub by id.",
            "inputSchema": { "type": "object", "properties": { "stubId": { "type": "string" } }, "required": ["stubId"] }
        }),
        json!({
            "name": "mock_move_stub",
            "description": "Move a stub up or down one position relative to its siblings. Stub order matters — the first enabled stub whose matchers all pass wins — so this is how to reprioritize overlapping stubs.",
            "inputSchema": {
                "type": "object",
                "properties": { "stubId": { "type": "string" }, "direction": { "type": "string", "enum": ["up", "down"] } },
                "required": ["stubId", "direction"]
            }
        }),
        json!({
            "name": "mock_set_fallback",
            "description": "Patch the \"no stub matched\" response. `patch` may include any of notFoundStatus (number), notFoundBody (string), notFoundContentType (string).",
            "inputSchema": { "type": "object", "properties": { "patch": { "type": "object" } }, "required": ["patch"] }
        }),
        json!({
            "name": "mock_set_bind",
            "description": "Set the host and/or port the server binds to on the next mock_start. Does NOT hot-swap an already-running server (unlike stubs/fallback, which apply live) — call mock_stop then mock_start to rebind.",
            "inputSchema": { "type": "object", "properties": { "host": { "type": "string" }, "port": { "type": "number" } } }
        }),
        json!({
            "name": "mock_start",
            "description": "Start the mock server with the current config (stubs + bind address). Returns the resulting status (running/host/port). Errors if the port is already in use.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "mock_stop",
            "description": "Stop the mock server.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "mock_status",
            "description": "Get the mock server's current running status (running/host/port), without the config/stub list mock_get_config also returns.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "mock_test_script",
            "description": "Run a Rhai response script against a synthetic request, without saving it to a stub — for iterating before mock_add_stub/mock_update_stub. `sample` is { method, path, query, headers, params, body } (all optional, defaults to GET /); see get_scripting_reference for the req/return shape.",
            "inputSchema": {
                "type": "object",
                "properties": { "script": { "type": "string" }, "sample": { "type": "object" } },
                "required": ["script"]
            }
        }),
        json!({
            "name": "mock_get_request_log",
            "description": "Get the most recent requests the mock server handled (newest first, capped at `limit`, default 50), each with which stub matched (or null for the fallback), status, timing, and truncated request/response bodies.",
            "inputSchema": { "type": "object", "properties": { "limit": { "type": "number" } } }
        }),
        json!({
            "name": "mock_clear_request_log",
            "description": "Clear the mock server's request log.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
    ]
}

// ── rmcp server wiring ───────────────────────────────────────────────────
// Converts each raw `tool_definitions()` entry into a rmcp `Tool` + a
// dynamic route that forwards straight to `call_tool` — one generic
// dispatcher rather than a hand-written method per tool, since every tool
// here has the same shape (take a JSON args object, forward it to the
// bridge, return its result as text).

#[derive(Clone)]
struct DevToolServer {
    tool_router: ToolRouter<Self>,
}

fn build_router() -> ToolRouter<DevToolServer> {
    let mut router = ToolRouter::new();
    for def in tool_definitions() {
        let name = def.get("name").and_then(Value::as_str).unwrap_or("").to_string();
        let description = def.get("description").and_then(Value::as_str).unwrap_or("").to_string();
        let schema = match def.get("inputSchema").cloned().unwrap_or_else(|| json!({})) {
            Value::Object(m) => m,
            _ => Default::default(),
        };
        let tool = Tool::new(name.clone(), description, schema);
        // get_scripting_reference is static content, not live app state — answer
        // it locally instead of round-tripping through the bridge, so it works
        // even while DevTool is closed or on a different tool.
        if name == "get_scripting_reference" {
            router.add_route(ToolRoute::new_dyn(tool, |_context: ToolCallContext<'_, DevToolServer>| {
                Box::pin(async move { Ok(CallToolResult::success(vec![Content::text(SCRIPTING_REFERENCE)])) })
                    as Pin<Box<dyn Future<Output = Result<CallToolResult, McpError>> + Send>>
            }));
            continue;
        }
        router.add_route(ToolRoute::new_dyn(tool, move |context: ToolCallContext<'_, DevToolServer>| {
            let name = name.clone();
            let args = context.arguments.clone().map(Value::Object).unwrap_or_else(|| json!({}));
            Box::pin(async move { Ok(call_tool(&name, args).await) })
                as Pin<Box<dyn Future<Output = Result<CallToolResult, McpError>> + Send>>
        }));
    }
    router
}

impl ServerHandler for DevToolServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions(
                "Drives two DevTool tools. API Client: collections, requests, scripts, \
                 environments — and can actually send a request. Mock Server: stubs, \
                 matchers, the fallback response, and can start/stop the server and test a \
                 response script. Each tool's calls only answer while the DevTool desktop \
                 app is open with THAT tool on screen (mock_* needs Mock Server open, \
                 everything else needs API Client open) — call get_scripting_reference for \
                 the scripting API and field shapes shared by both.",
            )
            .with_server_info(Implementation::new("devtool-api-client", env!("CARGO_PKG_VERSION")))
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        std::future::ready(Ok(ListToolsResult { tools: self.tool_router.list_all(), ..Default::default() }))
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<CallToolResult, McpError>> + Send + '_ {
        self.tool_router.call(ToolCallContext::new(self, request, context))
    }
}

#[tokio::main]
async fn main() {
    let server = DevToolServer { tool_router: build_router() };
    match server.serve(stdio()).await {
        Ok(service) => {
            if let Err(e) = service.waiting().await {
                eprintln!("devtool-mcp-server: {e}");
            }
        }
        Err(e) => eprintln!("devtool-mcp-server: failed to start: {e}"),
    }
}
