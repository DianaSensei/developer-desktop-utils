# Changelog

All notable user-facing changes to DevTool are documented here. Internal/dev-facing
implementation notes live under `docs/changelog/`; this file is for people upgrading
the app.

## Unreleased

### ⚠️ Breaking: Redis, RabbitMQ, Container Manager, and Kafka Explorer are now optional plugins

These four tools used to ship built into the app. As of this release they've been
extracted into a separate, optional-install repo
([`developer-desktop-miniapp`](https://github.com/DianaSensei/developer-desktop-miniapp)),
so the base app installer stays small and you only download what you actually use.

**If you used any of these tools before upgrading:**

- After updating, they will no longer appear in the sidebar — this is expected, not a bug.
- Install the ones you need from **Settings → Extensions**, or from the plugins page:
  **https://dianasensei.github.io/starlight-site/plugins**
- Saved connections for these tools are **not migrated automatically** — Tier A
  data for each tool now lives in its own isolated plugin storage location
  instead of the app's shared store. You'll need to re-enter your connection
  details once after installing the plugin. See
  `docs/decisions/architecture/platform-plugin-architecture.md` for why this
  isolation was worth the one-time re-entry cost.
- Nothing else about the app changed — every other tool (API Client, Mock
  Server, Port Scanner, JWT/Base64/Hash utilities, etc.) is still built in as
  before.

Relevant commits: `1b59500` (Redis/RabbitMQ/Container Manager), `5ad6ba2` (Kafka
Explorer), and the Rust-side sidecar cutovers `9a76337`/`d777bb0`/`8566311`.

### JWT Debugger now verifies and signs

The tool decoded a token and stopped there. It now answers the two questions
people actually open it with — is this signature real, and can I mint one like
it — across every algorithm the app's webview can perform: **HS256/384/512,
RS256/384/512, PS256/384/512, ES256/384/512, EdDSA**, plus unsigned `none` for
testing how a server reacts to one.

- **Verify** takes the shared secret for `HS*`, or a PEM public key, an X.509
  certificate, a JWK, or a whole JWK Set (the right key is picked by the
  token's own `kid`).
- **Sign** takes a PKCS#8 private key or private JWK, an expiry like `1h` /
  `7d`, and an optional `kid`. **Generate pair** creates a fresh key pair and
  fills the public half in for the Verify side.
- **Decode** gained a claims table: `exp` / `nbf` / `iat` as real times with
  "in 3 minutes" / "12 days ago", and an expired token says so.
- HMAC secrets carry an explicit encoding (plain text / base64 / base64url /
  hex), because a secret from `openssl rand -base64 32` is *bytes* — signing
  with its printed characters instead produces a token the real service
  rejects.
- Verification never takes the algorithm from the token's own `alg` header
  (that is the algorithm-confusion attack): you pick the algorithm you expect,
  and a token that disagrees is reported as a mismatch. Expired or
  wrong-audience results are shown as such rather than as a bad signature.

Everything runs locally through the OS webview's own Web Crypto — no token,
key or claim leaves the machine — and tokens and keys are held in the OS
secret store rather than ordinary app storage. Over MCP, `jwt_sign` and
`jwt_verify` join `jwt_decode`.
