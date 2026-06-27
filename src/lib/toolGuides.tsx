import type { ReactNode } from 'react';
import {
  Send, Braces, ShieldCheck, Code2, FolderTree, Keyboard,
  Play, Filter, FileCode2, Ban, ListChecks, Lightbulb, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// Per-tool "how to use" guides shown by the header help (?) button. Tools listed
// here get a hand-written guide; any tool not listed falls back to a generic
// guide built from its description plus the shared tool conventions.

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/i.test(navigator.userAgent);
const mod = isMac ? '⌘' : 'Ctrl';

export function GuideSection({
  icon: Icon, title, tone, children,
}: { icon: typeof Send; title: string; tone?: 'caveat'; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-foreground">
        <Icon className={cn('h-3.5 w-3.5', tone === 'caveat' ? 'text-amber-500' : 'text-primary')} />
        {title}
      </h3>
      <div className="space-y-1 pl-5 text-[12px] leading-relaxed text-muted-foreground">{children}</div>
    </section>
  );
}

function Key({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-foreground">{children}</kbd>;
}
function Tok({ children }: { children: ReactNode }) {
  return <code className="rounded bg-muted px-1 text-[11px] text-foreground">{children}</code>;
}
function Var({ children }: { children: ReactNode }) {
  return <code className="rounded bg-emerald-500/12 px-1 text-[11px] text-emerald-600 dark:text-emerald-400">{children}</code>;
}

// Compact bullet list under a section heading.
function List({ items, tone }: { items: ReactNode[]; tone?: 'caveat' }) {
  return (
    <ul className={cn('list-disc space-y-1 pl-4', tone === 'caveat' && 'marker:text-amber-500')}>
      {items.map((it, i) => <li key={i}>{it}</li>)}
    </ul>
  );
}

// Most tools follow the same shape: how to use, things to know, and heads-up.
function makeGuide(g: { use: ReactNode[]; know?: ReactNode[]; caveat?: ReactNode[] }): ReactNode {
  return (
    <>
      <GuideSection icon={ListChecks} title="How to use"><List items={g.use} /></GuideSection>
      {g.know && <GuideSection icon={Lightbulb} title="Good to know"><List items={g.know} /></GuideSection>}
      {g.caveat && <GuideSection icon={AlertTriangle} title="Heads up" tone="caveat"><List items={g.caveat} tone="caveat" /></GuideSection>}
    </>
  );
}

// Generic guide for tools without a dedicated entry: their own description plus
// the conventions shared across the app's tools.
export function GenericGuide({ description }: { description: string }) {
  return (
    <>
      {description && <p className="text-[12px] leading-relaxed text-muted-foreground">{description}</p>}
      <GuideSection icon={Lightbulb} title="Good to know">
        <List items={[
          'Most tools update their output live as you type — no “run” button needed.',
          <>Paste instantly with <Key>{mod}</Key>+<Key>V</Key>; undo / redo with <Key>{mod}</Key>+<Key>Z</Key> / <Key>{mod}</Key>+<Key>⇧</Key>+<Key>Z</Key>.</>,
          'Copy results with the copy button next to the output.',
          'Your input is saved locally and restored next time you open the tool.',
          'Everything runs on your device — nothing is sent anywhere unless a tool’s whole purpose is a network lookup.',
        ]} />
      </GuideSection>
    </>
  );
}

export const TOOL_GUIDES: Record<string, ReactNode> = {
  // ── Complex tools: richer multi-topic guides ────────────────────────────────
  'api-client': (
    <>
      <GuideSection icon={Send} title="Send a request">
        <p>Pick a method, type the URL, and click <strong className="text-foreground">Send</strong> (or <Key>{mod}</Key>+<Key>↵</Key>). The response — status, time, size, headers, and a pretty-printed body — shows on the right.</p>
        <p>In the desktop app requests go through Rust, so there’s no browser CORS restriction — you can call any API.</p>
      </GuideSection>
      <GuideSection icon={Braces} title="Variables">
        <p>Use <Var>{'{{name}}'}</Var> anywhere — URL, query, headers, body, or auth. A token turns <span className="text-emerald-600 dark:text-emerald-400">green</span> when it resolves in the current context and <span className="text-red-500">red</span> when it doesn’t; hover to see its value.</p>
        <p>Define variables in an <strong className="text-foreground">Environment</strong> (top-right dropdown) and select it to activate. Scripts can set session variables with <Tok>bru.setVar()</Tok>.</p>
      </GuideSection>
      <GuideSection icon={Code2} title="Body & auth">
        <p>Body modes: JSON, XML, text, form-urlencoded, multipart (file upload), GraphQL, or raw file. JSON can be pretty-printed.</p>
        <p>Auth: Bearer, Basic, Digest, API key, or OAuth2 — or <strong className="text-foreground">Inherit</strong> from the parent folder/collection.</p>
      </GuideSection>
      <GuideSection icon={ShieldCheck} title="Scripts, tests & cookies">
        <p>Each request has pre-request and post-response scripts plus tests/assertions (Bruno-style <Tok>bru</Tok>/<Tok>req</Tok>/<Tok>res</Tok> API, with a Postman <Tok>pm.*</Tok> shim). Collection/folder scripts are inherited.</p>
        <p>Set-Cookie responses are captured into a per-domain jar (toggle in the status bar) and re-sent automatically.</p>
      </GuideSection>
      <GuideSection icon={FolderTree} title="Organize, import & export">
        <p>Group requests into collections and folders in the left sidebar; open several in tabs. History records every send.</p>
        <p>Import a <strong className="text-foreground">Postman v2.1</strong> collection or a <strong className="text-foreground">cURL</strong> command; export the collection or generate a code snippet with the <Tok>{'</>'}</Tok> button.</p>
      </GuideSection>
      <GuideSection icon={Keyboard} title="Shortcuts">
        <p><Key>{mod}</Key>+<Key>↵</Key> send · <Key>{mod}</Key>+<Key>B</Key> new request · <Key>{mod}</Key>+<Key>E</Key> environments · <Key>{mod}</Key>+<Key>W</Key> close tab</p>
      </GuideSection>
    </>
  ),

  'mock-server': (
    <>
      <GuideSection icon={Play} title="Start the server">
        <p>Choose a host and port and click <strong className="text-foreground">Start</strong>. <strong className="text-foreground">Local</strong> binds both IPv4 and IPv6, so <Tok>http://localhost:&lt;port&gt;</Tok> works from any client (browser, curl, the API Client). Pick <Tok>0.0.0.0</Tok> to expose it to your LAN.</p>
        <p>Edits apply live while the server runs — no restart needed.</p>
      </GuideSection>
      <GuideSection icon={Filter} title="Define stubs">
        <p>Each stub matches on <strong className="text-foreground">method</strong> + <strong className="text-foreground">path</strong>. Paths support <Tok>:param</Tok> captures and <Tok>*</Tok> wildcards (e.g. <Tok>/users/:id</Tok>); method <Tok>ANY</Tok> matches every verb.</p>
        <p>Add <strong className="text-foreground">matchers</strong> to also require a query param, header, path param, or body — by <Tok>equals</Tok>, <Tok>contains</Tok>, <Tok>regex</Tok>, or <Tok>exists</Tok>. A body matcher can target the whole body or a JSON field path like <Tok>user.name</Tok>.</p>
        <p>Stubs are tried top to bottom — <strong className="text-foreground">first match wins</strong>, so order matters. Reorder with the ▲▼ buttons.</p>
      </GuideSection>
      <GuideSection icon={FileCode2} title="Responses">
        <p><strong className="text-foreground">Static</strong>: a status, headers, and body. Text/JSON bodies support templates like <Tok>{'{{path.id}}'}</Tok>, <Tok>{'{{request.query.x}}'}</Tok>, <Tok>{'{{uuid}}'}</Tok>, <Tok>{'{{now.iso}}'}</Tok>. Body type <strong className="text-foreground">File</strong> serves base64 bytes as a download.</p>
        <p><strong className="text-foreground">Script</strong>: a sandboxed Rhai script gets <Tok>req</Tok> and returns a string or <Tok>{'#{ status, headers, body }'}</Tok>. Preview it with <strong className="text-foreground">Test script</strong>.</p>
      </GuideSection>
      <GuideSection icon={Ban} title="No-match response">
        <p>The pinned entry at the bottom of the stub list edits the response returned when nothing matches (default <Tok>404</Tok>).</p>
      </GuideSection>
      <GuideSection icon={ListChecks} title="Request log">
        <p>Incoming requests are logged live (method, path, status, timing) — even from another tab or a browser. Click an entry to inspect it and jump to the stub it matched.</p>
      </GuideSection>
      <GuideSection icon={Lightbulb} title="Tips">
        <p>Duplicate and reorder stubs from the list; copy the whole config as JSON or import it back for backup/sharing. Drag the dividers to resize the panels.</p>
      </GuideSection>
    </>
  ),

  // ── Standard tools ──────────────────────────────────────────────────────────
  'cron-generator': makeGuide({
    use: [
      'Pick the scheduler dialect (Linux, Quartz, or Spring) at the top.',
      'Type a cron expression, or build it field-by-field with the per-field inputs and suggestions.',
      'Apply a preset (every minute, hourly, daily…) as a starting point.',
      'Read the plain-English explanation to confirm what it will do.',
    ],
    know: [
      'Linux uses 5 fields; Quartz 6–7 (adds seconds + optional year); Spring uses 6.',
      <>Each field takes ranges (<Tok>9-17</Tok>), lists (<Tok>1,15</Tok>), steps (<Tok>*/5</Tok>) and aliases (<Tok>JAN</Tok>, <Tok>MON</Tok>).</>,
      <>Quartz/Spring also support <Tok>?</Tok>, <Tok>L</Tok>, <Tok>W</Tok> and <Tok>#</Tok> for advanced day rules.</>,
    ],
    caveat: [
      'It explains the expression but does not simulate actual run times.',
      'Quartz/Spring warn when day-of-month and day-of-week are both set (ambiguous).',
    ],
  }),

  'text-transform': makeGuide({
    use: [
      'Choose a transformation from the dropdown (case changes, single/multi-line, array, VN phone…).',
      'Paste text on the left; the result updates live on the right.',
      'For the single-/multi-line modes, set the characters to strip or the delimiters to split on.',
    ],
    know: [
      '“Array” outputs a JSON array; case modes treat _ and - as word boundaries.',
      'VN phone converts between the old 11-digit and new 10-digit formats (handles 0, +84 and separators).',
    ],
    caveat: ['VN phone leaves unrecognized prefixes unchanged.'],
  }),

  'text-counter': makeGuide({
    use: [
      'Paste text on the left; statistics appear on the right.',
      'Expand sections for byte size (UTF-8/16/32), encoding fit, and Unicode character composition.',
    ],
    know: [
      'Words split on whitespace, paragraphs on blank lines, sentences on . ! ?; reading time = words ÷ 200 (rounded up).',
      'Emoji and surrogate pairs are counted correctly as single code points.',
    ],
    caveat: ['Sentence detection is naive — abbreviations and ellipses aren’t special-cased.'],
  }),

  'color-picker': makeGuide({
    use: [
      'Move over the image for a magnified loupe; click a pixel to lock its color.',
      'Read or copy HEX, RGB, HSL and CMYK for the hovered and selected colors.',
      'Use the auto-extracted palette: click a swatch, download it as PNG, or copy all hex codes.',
      'Load your own image, or use the system eyedropper where the OS supports it.',
    ],
    know: ['The palette is built by median-cut quantization (16 colors) from a downsampled copy of the image.'],
    caveat: [
      'The OS eyedropper isn’t available in Safari/WebKit (including this macOS app) — upload a screenshot and pick from it.',
      'Transparent pixels are skipped and very large images are scaled down.',
    ],
  }),

  base64: makeGuide({
    use: [
      'Encode tab: pick a codec (Base64/62, URL, HTML, Hex, Morse, Punycode…) and toggle Encode/Decode.',
      'Image tab: convert an image to Base64 (drop/paste/upload, copy raw or data URL) or paste Base64 back to a preview.',
      'Hash tab: see MD5/SHA-1/2/3 & RIPEMD at once; toggle case, verify against a known hash, or add a key for HMAC.',
      'Checksum tab: drag a file in to compute MD5/SHA-1/256/512 with a progress bar, then verify against a known hash.',
      'Password tab: hash a password with bcrypt or Argon2 (id/i/d) and a fresh random salt, or Verify a password against an existing hash (algorithm auto-detected).',
      'Encrypt tab: choose an AES/3DES/Rabbit mode, enter a passphrase, and encrypt/decrypt.',
      'Pipeline tab: chain multiple encode/hash/encrypt stages together.',
    ],
    know: [
      'Hashes are one-way; most codecs are reversible. Everything runs locally — files and text are never uploaded.',
      'Files are checksummed in chunks (in Rust on desktop, a Web Worker on the web), so the UI stays responsive.',
      'Password hashing uses hash-wasm (WASM bundled inline → offline) and runs on a button since it’s intentionally slow.',
    ],
    caveat: [
      'Encryption is CryptoJS passphrase-based (no AEAD/PBKDF2); ECB mode leaks patterns — prefer CBC or CTR.',
      'Base64 is ~33% larger than the binary; very large images/files strain memory, and clipboard image copy isn’t supported on every platform.',
      'Higher bcrypt cost / Argon2 memory is slower by design; bcrypt only uses the first 72 bytes of a password.',
    ],
  }),

  'unix-time': makeGuide({
    use: [
      'Type a Unix timestamp (10/13-digit), ISO 8601, “YYYY-MM-DD HH:mm”, or natural language — or use the calendar picker.',
      'Pick input and output timezones to convert the same instant.',
      'Expand Formats (13 standard + a custom date-fns pattern), day/week/month/year Boundaries, and Time Difference.',
      '“LIVE” ticks every second; “Reset to now” jumps to the current time.',
    ],
    know: ['Conversions use the Intl API, so daylight-saving transitions are handled correctly.'],
    caveat: ['Parsing is lenient (no calendar validation, e.g. Feb 30); a time-only input assumes today’s date.'],
  }),

  json: makeGuide({
    use: [
      'Paste JSON — lenient input is allowed (single quotes, unquoted keys, trailing commas, comments).',
      'Switch mode: Beautify (interactive tree), Minify, or JSON String (escaped for pasting into code).',
      'In Beautify, click nodes to collapse/expand, search to filter, and copy the selected path.',
      'Choose indent (2/4/tab) and quote style; collapse the input pane for more room.',
    ],
    know: ['The status bar flags parse errors; the tree shows item/field counts and a breadcrumb path.'],
    caveat: [
      'The tree is read-only (no editing) and search is plain text, not regex.',
      'Comments aren’t preserved in output; JS number precision limits very large integers.',
    ],
  }),

  jwt: makeGuide({
    use: ['Paste a JWT (header.payload.signature) — the decoded header and payload show as formatted JSON instantly.'],
    know: ['Decoding happens entirely on your machine; nothing is sent anywhere.'],
    caveat: ['This decodes only — it does NOT verify the signature, so don’t trust a token’s contents based on this alone.'],
  }),

  regex: makeGuide({
    use: [
      <>Enter a pattern and toggle flags (<Tok>g i m s u y</Tok>); type your test string.</>,
      'Switch tabs: Matches, Highlight, Extract (capture groups), and Replace.',
      <>Replace supports <Tok>$1</Tok>, <Tok>$&lt;name&gt;</Tok> and <Tok>$&amp;</Tok>.</>,
      'Load a preset (email, URL, UUID…) to start from a working pattern + sample.',
    ],
    know: ['Named groups are labeled in Extract; up to 500 matches are shown to stay responsive.'],
    caveat: ['The pattern is validated on every keystroke, so you’ll see transient errors mid-edit.'],
  }),

  diff: makeGuide({
    use: [
      'Paste the original on the left and the modified version on the right.',
      'Text mode: word-level diff renders below — red = removed, green = added.',
      'JSON mode: a syntax-highlighted editor that auto-formats each side (on paste and when you click away); changes are listed by path as added / removed / changed (old → new).',
    ],
    know: ['Both modes update live as you type; JSON mode reports differences by key/index path, ignoring formatting and key order.'],
    caveat: ['Text mode has no line/character or unified-diff export; JSON mode needs valid JSON on both sides (parse errors show in the result panel). Panes don’t scroll in sync.'],
  }),

  qrcode: makeGuide({
    use: [
      'Generate: type text/URL, pick a frame, add a logo (text/emoji/upload), set colors or transparency, then copy or download the PNG.',
      'Read: drop, upload, or paste a QR image to decode it — and open the link if it’s a URL.',
    ],
    know: ['Error correction automatically rises to the highest level when a logo is present.'],
    caveat: ['A logo larger than ~22% of the code, or a transparent background, can hurt scannability; large payloads render slower.'],
  }),

  markdown: makeGuide({
    use: ['Type Markdown on the left; the rendered preview updates live on the right.'],
    know: ['Renders standard CommonMark.'],
    caveat: ['No editor syntax highlighting; no tables/footnotes/strikethrough (basic CommonMark); panes don’t sync-scroll.'],
  }),

  deduplicate: makeGuide({
    use: [
      'Paste one item per line on the left; unique items appear on the right.',
      'Choose Preserve order (keeps the first occurrence) or Sort (alphabetical).',
      'The stats bar shows original / unique / removed counts.',
    ],
    know: ['Processing runs in a background worker; undo/redo are supported.'],
    caveat: ['Matching is exact — case- and whitespace-sensitive (“Apple” ≠ “apple”, “a ” ≠ “a”).'],
  }),

  'sql-formatter': makeGuide({
    use: [
      'Pick SQL or MongoDB mode and an indent width; set SQL options (uppercase keywords, collapse spaces, line breaks).',
      'Paste into the editor and click Format; copy or clear from the action bar.',
      'MongoDB mode offers $-operator autocomplete.',
    ],
    know: ['Formatting is on-demand (the Format button), with syntax highlighting and bracket matching.'],
    caveat: ['SQL formatting is general / PostgreSQL-leaning and may not perfectly handle every dialect or deeply nested CTEs.'],
  }),

  generator: makeGuide({
    use: [
      <><strong className="text-foreground">Random</strong> tab: pick UUID, Number, or Text, set the options (count; min/max/decimals; length + character sets), and click Generate. Copy one result or all.</>,
      <><strong className="text-foreground">Test Data</strong> tab: define a field schema (40+ types across Identity, Internet, Location, Business, Finance, Content…), set a row count, and export as JSON, NDJSON, YAML, CSV, TSV, SQL inserts, or .properties.</>,
      <>Test Data output is deterministic for a given <strong className="text-foreground">seed</strong> — edit the schema and it stays stable; hit the seed’s refresh button for fresh data.</>,
      'Great for seeding a database or pasting into a Mock Server stub / API Client body.',
    ],
    know: [
      'Random uses cryptographically secure randomness (crypto.getRandomValues); UUIDs are v4.',
      'Test Data is powered by the Faker dataset (bundled, lazy-loaded → fully offline). int/float take min/max; enum takes comma-separated values; Date/Birthdate take an output format (ISO, US/EU, Unix s/ms, readable…).',
    ],
    caveat: ['Fake data is realistic-looking but synthetic, and not guaranteed unique across rows (e.g. emails can repeat).'],
  }),

  network: makeGuide({
    use: [
      'Switch tabs: DNS Lookup, Propagation, DNSSEC, What’s My IP, Local Network, IP Lookup.',
      'Enter a domain/IP (or click detect) and run the query; results persist while you switch tabs.',
    ],
    know: ['DNS uses DNS-over-HTTPS; propagation compares Cloudflare, Google, Quad9 and AdGuard. Results clear on app restart.'],
    caveat: [
      'This tool makes REAL external requests: domains go to the chosen DoH provider and IPs go to a geolocation service (ipapi.co).',
      'Local Network info is desktop-only.',
    ],
  }),

  'lucky-wheel': makeGuide({
    use: [
      'Enter choices (one per line; duplicates raise the odds); optionally toggle “Unique only” and “Remove winner”.',
      'Pick a spin duration and hit Spin — or Auto-spin to draw several distinct winners.',
      'Review or clear the spin history.',
    ],
    know: ['Duplicated lines proportionally increase a choice’s chance; auto-spin won’t repeat a winner within one run.'],
    caveat: ['“Remove winner” edits your choice list (destructive) and can’t be undone.'],
  }),

  '2fa': makeGuide({
    use: [
      'Add an account: choose TOTP or HOTP, enter a name/issuer and the Base32 secret, and set algorithm/digits/period.',
      'TOTP codes refresh on a countdown (tap to copy); HOTP advances with “Generate next code”.',
      'Import from Google Authenticator exports, otpauth:// URIs, or QR screenshots; export all as otpauth:// URIs.',
    ],
    know: ['Implements RFC 6238 (TOTP) and RFC 4226 (HOTP): Base32 secrets, SHA-1/256/512, 6 or 8 digits.'],
    caveat: ['Secrets are stored UNENCRYPTED in local storage — convenient, but not a hardened vault. Keep an export backup; there’s no device sync.'],
  }),

  'data-converter': makeGuide({
    use: [
      <>Pick the <strong className="text-foreground">From</strong> format, paste your data on the left, and choose the <strong className="text-foreground">To</strong> format — the result updates live on the right.</>,
      <>Use the <Tok>⇄</Tok> button to swap directions; the current result becomes the new input, so you can round-trip a value.</>,
      <>Adjust indent, CSV delimiter, or XML pretty-printing in the toolbar; copy or download the result.</>,
    ],
    know: [
      <>Conversion runs entirely on your device (JSON, YAML, TOML, XML, .properties) — nothing is uploaded, so it works offline.</>,
      <>Parse errors show inline on the right with the reason; fix the source and they clear.</>,
    ],
    caveat: [
      <><strong className="text-foreground">TOML</strong> output needs a top-level table (object); a bare array or scalar at the root can’t be represented.</>,
      <><strong className="text-foreground">XML</strong> uses <Tok>@_</Tok>-prefixed keys for attributes; arrays/scalars are wrapped in a <Tok>&lt;root&gt;</Tok> element so the output stays valid.</>,
      <><strong className="text-foreground">.properties</strong> has no nesting: dotted keys map to nested objects and <Tok>key[0]</Tok> to arrays, values are type-inferred, and comments are dropped. A literal dot in a key name isn’t supported.</>,
    ],
  }),

  'kafka-explorer': makeGuide({
    use: [
      'Add a broker (host:port), then pick a topic or consumer group from the tree.',
      'For a topic: browse Partitions, Messages (with offset/partition filters), Config and Consumers.',
      'For a group: view committed offsets, lag and member assignments. The ⓘ button lists every API call the tool makes.',
    ],
    know: ['Data loads on navigation (no background polling); message fetches cap at 10 MB and group scans at 500.'],
    caveat: [
      'Plaintext only — no TLS or SASL authentication.',
      'Producing messages and resetting offsets affect a REAL cluster, so take care on production brokers.',
    ],
  }),

  'task-tracker': makeGuide({
    use: [
      <>Add a task (with a project), then Start/Stop the timer (<Key>{mod}</Key>+<Key>↵</Key> toggles); edit entry times inline.</>,
      'Switch tabs: Timesheet grid (dates × projects), Calendar, and Meeting Notes; manage projects/colors and settings in the side panels.',
      <>In <strong className="text-foreground">Meeting Notes</strong>, create a note and fill title, participants, agenda, decisions, and action items; a note with a start time also appears on the Calendar. Use the Markdown tab to copy exportable minutes.</>,
      'Export time entries as JSON or CSV.',
    ],
    know: ['The timer and all data persist locally; Pomodoro pauses and beeps after the configured interval; meeting notes and time entries share the same calendar.'],
    caveat: ['Local only (no cloud sync); desktop notifications need permission. Meeting-note Markdown is generated one-way from the form (no markdown-to-form editing).'],
  }),
};
