# Changelog

All notable user-facing changes to DevTool are documented here. Internal/dev-facing
implementation notes live under `docs/changelog/`; this file is for people upgrading
the app.

## Unreleased

### Claude Manager: Compare shows plan usage only, and reads it more reliably

- **Compare is now one table of plan usage**: each account's 5-hour and weekly use with
  reset times, per-model limits as small badges, sorted with the most room first. The
  local token comparison is gone from this tab (per-account token counts stay in Usage).
- **Status line readings no longer mix accounts.** When accounts share one settings.json
  (common with account managers), every account ran the same script, which saved its
  reading next to itself — so one account's numbers could show up under another. The
  script now saves the reading in the folder of the account that is running, and
  accounts that turned it on earlier get the new script automatically.
- **Out-of-date numbers are marked.** A reading older than 15 minutes says so, and for the
  status line explains that it only moves while that account has a session open. The
  API source refreshes when the tab opens and can be refreshed for all accounts at once.
- **The API source shows which sign-in answered** (the Keychain item or
  `.credentials.json`), so numbers fetched with the wrong account's sign-in can be spotted.

### Claude Manager: compare accounts

- **Plan usage for every account at a glance.** The Compare tab opens with one card per
  account showing how much of the 5-hour and weekly limits (and per-model limits, when
  Anthropic reports them) is used and when each resets, coloured green / amber / red,
  and names the account with the most room left. Two sources, each turned on per
  account:
  - **Status line** — DevTool adds a small script as the account's Claude Code status
    line (your existing status line keeps working; turning it off restores it). Claude
    Code hands it the plan usage; no token is read and nothing goes over the network.
    The numbers update while that account has a session open.
  - **API** — DevTool reads the account's sign-in token and asks Anthropic, at most every
    5 minutes while the Compare tab is open. Always current, but the endpoint is not
    published by Anthropic and may change or refuse, and using a personal plan's token
    from another tool may not fit its terms. The token is never stored or shown.
- **A Compare tab puts every account side by side** — usage in the last 5 hours, today,
  7 and 30 days (tokens or cost), running sessions, last activity, main model and a
  7-day cost chart — and points out the account that used the least in the last 5
  hours, so picking the account for your next session is one look.
- **Shared sessions are split by who ran them.** When several accounts share one
  sessions folder (account managers such as Orca do this), a session is now credited to
  the account seen running it, or whose `.claude.json` names it as a project's last
  session. What cannot be attributed shows in its own "Shared (unknown)" column instead
  of being added to the first account.

### Claude Manager: rename accounts

- **Give an account any name.** Hover an account in the Accounts tab and click the pencil
  to rename it — handy for profiles that other tools create with names like `home` or a
  long folder path. Enter saves, Escape cancels; only the name shown in DevTool changes,
  never the folder.
- The **Add account** button is gone from the toolbar; adding an account stays at the
  top of the Accounts tab.

### Fixes

- **In-app updates no longer fail with "403 Forbidden".** The update manifest pointed
  each download at GitHub's API, which refuses unauthenticated requests after 60 an hour
  per IP address — so on a shared office or VPN connection, **Install** failed. Updates
  now download from the release's public download link, which has no such limit.

### Claude Manager: delete an account, and accounts that share sessions

- **Delete an account from this computer.** Next to "stop tracking" (which only hides an
  account in DevTool), each account can now be deleted: its config directory — sessions,
  settings and stored sign-in — is moved to the Trash / Recycle Bin, so it can be
  restored. It is refused while a session of that account is running.
- **Accounts that share their sessions are no longer counted twice.** Account managers
  often link the sessions folder between profiles, which made two accounts show the same
  sessions, tokens and cost — and doubled the totals. Shared sessions are now counted
  once, and the other account says which one it shares with.

### Fixes

- **Claude Manager:** adding an account is easier to find and no longer waits for the
  scan. There is an **Add account** button in the toolbar, the path field and **Browse…**
  are at the top of the Accounts tab, and the Accounts and Config tabs open even while
  the first scan is still running or when it fails — which is when you most need them.

### New tool: Claude Manager

- **See every Claude Code session on this machine in one place** — which ones are
  working, which are waiting for you, which are idle — with the project, branch, model,
  subagent count and process id of each.
- **Usage:** tokens and an estimated cost for today, 7 days, 30 days or all time, broken
  down by account, model, project and day, plus the last five hours at a glance. Cost is
  an estimate at API list prices; it is not your remaining plan limit.
- **Several accounts, wherever they live:** each account is a Claude Code config
  directory. They are found automatically — in the standard locations, from Claude
  processes started by other tools (account switchers, agent orchestrators), and by a
  search of your home folder — and you can add any other path by typing it or browsing
  to it; a parent folder holding several accounts works too. See who is signed in to
  each, and copy the command that starts Claude with that account or reopens a session
  in it.
- **Read and search conversations:** click a session to read it (tool calls on request),
  or search what you and Claude wrote across every session and jump to the match.
- **Chart, budgets, export:** cost or tokens over time; a daily and a monthly budget with
  a system notification at 80% and when exceeded (while the tool is open in a tab); the
  selected range as CSV or JSON.
- **Config per account:** see an account's `settings.json`, `CLAUDE.md`, hooks, MCP
  servers, agents, commands and skills. `settings.json` and `CLAUDE.md` can be edited or
  copied to another account — the previous version is kept as `.devtool-bak`.
- Local only: it never opens the credentials file and sends nothing anywhere. The only
  files it changes are `settings.json` and `CLAUDE.md`, when you save them. Desktop app
  only.

### Fixes

- **Pasting very large text no longer freezes the app.** Pasting a few megabytes of
  single-line text (a minified JSON, a long Base64 string) into Text Counter, Text
  Transformer, Encode · Hash · Encrypt or Regex Tester while the cursor was in the field
  could hang the window for 15–45 seconds, and again each time you switched back to that
  tool. It now takes about a second.
- **Cron Generator:** the suggestions button next to each field shows its icon again
  (it was a blank square).
- **Text Editor:** the Timeline heading no longer overlaps the Local History switch in
  a narrow side bar. The switch's name is in its tooltip.
- **API Client:** the environment pickers show the full environment name on wide
  windows instead of cutting it to "No E…".

### Encode · Hash · Encrypt: JWT tab, key generator, a real pipeline

- **JWT Debugger is now the JWT tab** of Encode · Hash · Encrypt. Your token, keys and
  settings move over on first launch; old `/jwt` links and the ⌘K suggestion for a
  copied token open the tab. If you had JWT Debugger on or starred, Encode · Hash ·
  Encrypt is now.
- **Keys tab:** generate Ed25519, RSA 2048/3072/4096, EC P-256/384/521 and X25519 key
  pairs, or HMAC / AES / random secrets. Copy them as PEM, JWK / JWK Set, OpenSSH
  (`authorized_keys` line + private key + fingerprint) or WireGuard keys. Generated keys
  are never saved.
- **Pipeline:** every codec, hash, HMAC (hex / Base64 output, text / base64 / hex keys),
  encrypt / decrypt, JWT and JWS decode / sign / verify (including detached payloads),
  JSON path, regex and split extraction, regex replace and JSON pretty / minify.
  Save pipelines as **templates** (keys stay in the encrypted vault, never in the
  template or its export), or start from the built-in Apple Advanced Commerce,
  App Store Server Notification and payment-HMAC examples.
- **Apple signed payloads:** JWS verify can take the key from the token's `x5c` and
  checks the whole chain up to the pinned Apple Root CA - G3 (Apple's marker OIDs,
  validity at `signedDate`). Revocation is not checked.

### Diff shows exactly what changed

Long texts with a few edits no longer light up every line in between: the exact
characters that differ are highlighted, and Text mode lists every change with its
line:column on both sides — click one to select it in both panes.

### Workspaces: keep the tools you're working with one keystroke away

The tools you open now become tabs in the titlebar, and those tabs survive restarting
the app. Group them into named workspaces (up to 9 — e.g. "Backend debugging" with
API Client, JSON and JWT; "Daily" with Time Tracker and Date / Time) and switch between
them from the workspace menu, ⌘K, or ⌘⌥1–9. ⌘1–9 jumps to a tab, ⌘⇧[ / ⌘⇧] cycles
(Ctrl on Windows/Linux). The previous "open tools" strip only ever appeared in the web
build — on the desktop app it never showed. See `docs/decisions/ui/workspaces.md`.

### Every tool in Vietnamese and English

Choosing Tiếng Việt in Settings now translates every built-in tool, not just the
sidebar and Settings. Technical terms developers use as-is (token, header, payload…)
stay in English, as do raw engine errors (JSON parser, Web Crypto) so they can be
searched verbatim.

### Fixes from a UI/UX audit of every built-in tool

- **2FA:** removing an account now asks first — a deleted TOTP secret can't be
  recovered. **Export** opens the system Save dialog; on the desktop app it previously
  produced no file. Color Picker's **Download palette** had the same problem.
- **Markdown** and **Meeting Notes:** the preview is styled again (headings, lists,
  code, tables, task lists), and clicking a link opens it in your browser instead of
  replacing the whole app window with the web page.
- **Text Transformer:** camelCase / snake_case / … convert each line on its own (a
  list of identifiers used to be merged into one), plus PascalCase, CONSTANT_CASE,
  kebab-case, Title Case and an "all cases at once" view.
- **Cron Generator:** shows the next five run times; Quartz mode no longer flags its
  own 6-field default and presets as invalid.
- **JSON Formatter:** large documents stay fast, the tree works from the keyboard, and
  search shows a match count with Enter / ⇧Enter to jump between matches.
- **Mock Server** stubs, **meeting notes** and **calendar entries** ask before deleting.
- **Lucky Wheel** draws with a cryptographically secure random source.

### For plugin authors: the app's UI kit (SDK 1.1.0)

URL-installed plugins can use DevTool's own components, UX hooks (⌘V quick paste, ⌘Z
history) and translation helpers via `window.__DEVTOOL_VENDOR__.ui` instead of bundling
their own copies. Declare `sdk: '^1.1.0'`. See `docs/plugin-sdk/05-external-install.md`.

### Plugins with a native helper no longer need a new app release

A plugin that ships a native helper program (a "sidecar") used to work only if its
name was hard-coded into the app. Now, the first time such a plugin runs its helper,
DevTool shows a native confirmation dialog with the program's path and SHA-256 and
asks whether to allow it. Your answer is remembered in the OS keychain for that exact
file — a different build of the helper asks again, and uninstalling the plugin forgets
the decision. Helpers bundled with DevTool itself (Redis, RabbitMQ, Container Manager,
Kafka Explorer) run without asking, as before. See
`docs/plugin-sdk/01-architecture.md`.

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
