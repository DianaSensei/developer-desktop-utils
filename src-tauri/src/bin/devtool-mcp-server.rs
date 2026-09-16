// devtool-mcp-server — MCP stdio server bundled with the DevTool app as a
// Tauri sidecar (see tauri.conf.json's bundle.externalBin), so someone who
// installed DevTool from a binary (dmg/msi/deb/AppImage) can point their MCP
// client straight at it — no Node.js / npm install needed.
//
// It never runs inside the app itself. The app's Tauri backend
// (mcp_bridge.rs) starts a small loopback HTTP control server on launch and
// writes its port + auth token to `<app_data_dir>/mcp-bridge.json` for this
// process to read.
//
// This process has NO compiled-in tool catalogue — every tool it advertises
// is fetched at query time from `GET /tools` on that bridge (see
// `fetch_registered_tools()` below), which is whatever tools' own frontend
// bridges have registered themselves (`mcp_register_tools`) since the app
// last launched: API Client and Mock Server register from inside the main
// app, Kafka Explorer from its own plugin, and any Tier-B plugin installed
// from developer-desktop-util-plugin (Redis/RabbitMQ/Container Manager, or
// a future one) registers the same way once its own bridge mounts. A tool
// call is forwarded as a `POST /call`, which the app hands to the running
// webview to answer — so it only succeeds while DevTool is open and, by
// default, with that specific tool's screen open, unless the user has
// turned on Settings → MCP → Background MCP bridge, which drops that
// "on screen" requirement entirely (get_scripting_reference is the one
// exception either way — answered locally, see its own comment below). See
// src-tauri/src/mcp_bridge.rs for the full design, and any tool's own
// `mcpBridge.ts` for what it actually does and which tool schemas it
// registers.
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
use std::time::Duration;

use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, ContentBlock, ErrorData as McpError,
    Implementation, ListToolsResult, PaginatedRequestParams, ServerCapabilities, ServerConfig, Tool,
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
    let request = format!(
        "POST /call HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nContent-Type: application/json\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        payload.len(),
    );
    let json = http_request(port, request.as_bytes(), Some(&payload)).await?;
    if let Some(err) = json.get("error").and_then(|e| e.as_str()) {
        return Err(err.to_string());
    }
    Ok(json.get("result").cloned().unwrap_or(Value::Null))
}

// GET counterpart of `http_post_json` — no request body, and the response is
// the plain JSON value itself rather than a `{result}`/`{error}` envelope
// (used by `fetch_registered_tools()` to read the dynamic tool catalogue from
// `GET /tools`, which returns a bare JSON array).
async fn http_get_json(port: u16, token: &str, path: &str) -> Result<Value, String> {
    let request = format!(
        "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nConnection: close\r\n\r\n",
    );
    http_request(port, request.as_bytes(), None).await
}

async fn http_request(port: u16, head: &[u8], body: Option<&[u8]>) -> Result<Value, String> {
    let mut stream = tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(("127.0.0.1", port)))
        .await
        .map_err(|_| format!("Timed out connecting to DevTool on 127.0.0.1:{port}."))?
        .map_err(|e| format!("Could not reach DevTool on 127.0.0.1:{port} ({e}). Is the app open?"))?;

    stream.write_all(head).await.map_err(|e| e.to_string())?;
    if let Some(payload) = body {
        stream.write_all(payload).await.map_err(|e| e.to_string())?;
    }

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
    Ok(json)
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
            CallToolResult::success(vec![ContentBlock::text(text)])
        }
        Err(e) => CallToolResult::error(vec![ContentBlock::text(e)]),
    }
}

// ── dynamic tool catalogue ───────────────────────────────────────────────
// This process has NO compiled-in knowledge of what tools exist. Every tool
// other than `get_scripting_reference` (below, answered locally since it's
// static reference content) is contributed at RUNTIME by whichever plugin
// bundles it: each tool's own frontend bridge (e.g.
// src/components/tools/apiclient/mcpBridge.ts,
// src/components/tools/kafka/mcpBridge.ts, or a plugin installed from
// developer-desktop-util-plugin) registers its own name/description/
// inputSchema with the running app's `mcp_bridge.rs` registry
// (`mcp_register_tools`) once on mount. `list_tools()` fetches the CURRENT
// registered set on every call — not once at process startup — so a plugin
// installed (or a tool whose bridge just mounted) after this process
// started still shows up without restarting it.
async fn fetch_registered_tools() -> Result<Vec<Tool>, String> {
    let info = read_bridge_info()?;
    let json = http_get_json(info.port, &info.token, "/tools").await?;
    let entries = json.as_array().cloned().unwrap_or_default();
    Ok(entries
        .into_iter()
        .filter_map(|def| {
            let name = def.get("name")?.as_str()?.to_string();
            let description = def.get("description").and_then(Value::as_str).unwrap_or("").to_string();
            let schema = match def.get("inputSchema").cloned().unwrap_or_else(|| json!({})) {
                Value::Object(m) => m,
                _ => Default::default(),
            };
            Some(Tool::new(name, description, schema))
        })
        .collect())
}

// `get_scripting_reference`'s own catalogue entry — the one tool this
// process still answers locally (see `SCRIPTING_REFERENCE` above for why),
// so it must still show up in `list_tools()` even when the bridge is
// unreachable (app closed).
fn scripting_reference_tool() -> Tool {
    Tool::new(
        "get_scripting_reference",
        "API Client pre/post-request scripting API (dt/req/res/pm/expect/assert) and Mock \
         Server response-script API (Rhai), plus the field shapes every patch-style tool in \
         both takes (KeyValue, RequestBody, Auth, RequestSettings, Stub, Matcher, ...). \
         Static reference — always answers, no running app or open tool required.",
        json!({ "type": "object", "properties": {} }).as_object().cloned().unwrap_or_default(),
    )
}

#[derive(Clone)]
struct DevToolServer;

impl ServerHandler for DevToolServer {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_instructions(
                "Drives every DevTool tool that has registered itself with the running app's \
                 MCP bridge — call list_tools for the current set, since it can grow (a plugin \
                 installed from Settings → Extensions) or shrink (a tool switched off in \
                 Settings → MCP → Per-tool MCP access) between calls. A handful of stateless \
                 utility tools (codec_*/hash_*/encrypt_text/decrypt_text, jwt_decode, json_*) \
                 are pure functions of their own arguments and always answer. Every other \
                 tool's calls only answer while the DevTool desktop app is open with THAT \
                 tool's own screen open (its bridge only registers/answers while mounted) — if \
                 a call times out, that is almost always why; call devtool_mcp_set_background \
                 with enabled:true to lift that requirement yourself (mirrors Settings → MCP → \
                 Background MCP bridge) instead of asking the user to switch tools or click it \
                 manually. A tool can also be switched off entirely (Settings → MCP → Per-tool \
                 MCP access) — devtool_mcp_status's toolsEnabled reports which; \
                 devtool_mcp_set_tool_enabled flips one, but only the user should ever choose \
                 to disable a tool. Call get_scripting_reference for the API Client/Mock \
                 Server scripting API and field shapes shared by those two.",
            )
            .with_server_info(Implementation::new("devtool-api-client", env!("CARGO_PKG_VERSION")))
    }

    fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<ListToolsResult, McpError>> + Send + '_ {
        async move {
            // A registration fetch failure (app not open) means "no tools
            // registered right now" — get_scripting_reference alone, not an
            // error surfaced to the MCP client. `call_tool` on a stale/missing
            // tool name still gets a clear per-call error from `call_bridge`.
            let mut tools = fetch_registered_tools().await.unwrap_or_default();
            tools.push(scripting_reference_tool());
            Ok(ListToolsResult { tools, ..Default::default() })
        }
    }

    fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> impl Future<Output = Result<CallToolResponse, McpError>> + Send + '_ {
        async move {
            if request.name.as_ref() == "get_scripting_reference" {
                return Ok(CallToolResult::success(vec![ContentBlock::text(SCRIPTING_REFERENCE)])
                    .into());
            }
            let args = request.arguments.clone().map(Value::Object).unwrap_or_else(|| json!({}));
            Ok(call_tool(request.name.as_ref(), args).await.into())
        }
    }
}

#[tokio::main]
async fn main() {
    let server = DevToolServer;
    match server.serve(stdio()).await {
        Ok(service) => {
            if let Err(e) = service.waiting().await {
                eprintln!("devtool-mcp-server: {e}");
            }
        }
        Err(e) => eprintln!("devtool-mcp-server: failed to start: {e}"),
    }
}
