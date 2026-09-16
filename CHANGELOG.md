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
