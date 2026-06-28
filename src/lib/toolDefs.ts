import {
  CalendarClock,
  CaseSensitive,
  Clock,
  FileJson,
  Binary,
  KeyRound,
  Regex,
  GitCompare,
  QrCode,
  FileText,
  CopyMinus,
  Type,
  Pipette,
  Dices,
  Server,
  Database,
  Timer,
  Network,
  Disc3,
  Send,
  ShieldCheck,
  ServerCog,
  ArrowLeftRight,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface ToolDef {
  id: string;
  label: string;
  icon: LucideIcon;
  description: string;
  /**
   * Extra search terms / synonyms so the sidebar search finds a tool even when
   * the user types a related word that isn't in its label or description
   * (e.g. "epoch" → Date/Time, "guid" → Generator, "postman" → API Client).
   */
  keywords?: string[];
}

export const TOOL_DEFS: ToolDef[] = [
  {
    id: "cron-generator",
    label: "Cron Generator",
    icon: CalendarClock,
    description: "Build and validate cron expressions with a visual editor.",
    keywords: ["crontab", "schedule", "quartz", "spring", "job", "timer", "expression"],
  },
  {
    id: "text-transform",
    label: "Text Transformer",
    icon: CaseSensitive,
    description:
      "Change case, join/split lines, build arrays, and convert Vietnamese phone numbers.",
    keywords: ["case", "uppercase", "lowercase", "camelcase", "snake case", "kebab", "title case", "lines", "split", "join", "trim", "phone", "vietnamese"],
  },
  {
    id: "text-counter",
    label: "Text Counter",
    icon: Type,
    description: "Count characters, words, lines and estimate reading time.",
    keywords: ["characters", "words", "lines", "length", "count", "reading time", "bytes", "letters"],
  },
  {
    id: "color-picker",
    label: "Color Picker",
    icon: Pipette,
    description: "Pick colors from an image and convert between HEX, RGB, HSL, and CMYK.",
    keywords: ["hex", "rgb", "hsl", "cmyk", "eyedropper", "palette", "swatch", "image", "colour"],
  },
  {
    id: "base64",
    label: "Encode·Hash·Encrypt",
    icon: Binary,
    description:
      "Encode/decode (Base64, URL, Hex, Morse…), image↔Base64, hash text or files (MD5, SHA, HMAC, checksums), password hashing (bcrypt/Argon2), and AES-256 encrypt/decrypt.",
    keywords: ["base64", "encode", "decode", "url encode", "hex", "morse", "hash", "md5", "sha1", "sha256", "sha512", "hmac", "checksum", "crc", "bcrypt", "argon2", "aes", "encrypt", "decrypt", "cipher", "password"],
  },
  {
    id: "unix-time",
    label: "Date / Time",
    icon: Clock,
    description:
      "Convert timestamps, compare dates, and format in any timezone.",
    keywords: ["timestamp", "epoch", "unix time", "date", "time", "timezone", "iso 8601", "utc", "convert", "duration"],
  },
  {
    id: "json",
    label: "JSON Formatter",
    icon: FileJson,
    description:
      "Format, validate, minify, and explore JSON with syntax highlighting.",
    keywords: ["json", "format", "validate", "minify", "beautify", "prettify", "tree", "viewer", "parse"],
  },
  {
    id: "data-converter",
    label: "Data Converter",
    icon: ArrowLeftRight,
    description:
      "Convert structured data between JSON, YAML, TOML, XML, and .properties — fully offline.",
    keywords: ["json", "yaml", "yml", "toml", "xml", "properties", "convert", "transform"],
  },
  {
    id: "jwt",
    label: "JWT Debugger",
    icon: KeyRound,
    description:
      "Decode and inspect JWT headers and payloads without verification.",
    keywords: ["jwt", "token", "decode", "header", "payload", "claims", "bearer", "auth"],
  },
  {
    id: "regex",
    label: "Regex Tester",
    icon: Regex,
    description:
      "Test regular expressions with live match highlighting and group capture.",
    keywords: ["regex", "regexp", "regular expression", "match", "pattern", "test", "replace", "capture group"],
  },
  {
    id: "diff",
    label: "Diff",
    icon: GitCompare,
    description:
      "Compare two text blocks (word-level) or two JSON values (structural, by path).",
    keywords: ["diff", "compare", "difference", "text", "json", "changes", "merge"],
  },
  {
    id: "qrcode",
    label: "QR Code",
    icon: QrCode,
    description: "Generate QR codes from text or URLs, or decode a QR image back to its content.",
    keywords: ["qr", "qr code", "barcode", "scan", "decode", "generate", "url"],
  },
  {
    id: "markdown",
    label: "Markdown",
    icon: FileText,
    description: "Live Markdown preview with standard formatting support.",
    keywords: ["markdown", "md", "preview", "readme", "render", "gfm"],
  },
  {
    id: "deduplicate",
    label: "Deduplicate",
    icon: CopyMinus,
    description: "Remove duplicate lines or items from any list.",
    keywords: ["deduplicate", "dedup", "unique", "remove duplicates", "distinct", "lines", "list"],
  },
  {
    id: "generator",
    label: "Generator",
    icon: Dices,
    description:
      "Generate UUIDs, random numbers and text, or realistic fake datasets (names, emails, dates…) exported as JSON, CSV, SQL, and more.",
    keywords: ["uuid", "guid", "random", "fake data", "mock data", "faker", "test data", "lorem ipsum", "number", "string", "csv", "sql", "seed"],
  },
  {
    id: "kafka-explorer",
    label: "Kafka Explorer",
    icon: Server,
    description:
      "Browse topics, inspect partitions and offsets, manage consumer groups, and produce messages.",
    keywords: ["kafka", "topic", "partition", "offset", "consumer group", "producer", "message", "broker", "stream"],
  },
  {
    id: "sql-formatter",
    label: "SQL Formatter",
    icon: Database,
    description:
      "Format and beautify SQL queries — or MongoDB shell/aggregation queries — with keyword casing, space collapse, and clause line breaks.",
    keywords: ["sql", "mysql", "postgres", "query", "format", "beautify", "prettify", "mongodb", "mongo", "aggregation"],
  },
  {
    id: "task-tracker",
    label: "Time Tracker",
    icon: Timer,
    description:
      "Time tracker with timesheet, calendar, and meeting-notes views, projects, tags, and pomodoro.",
    keywords: ["time tracker", "timer", "timesheet", "pomodoro", "calendar", "clockify", "meeting notes", "project", "task", "stopwatch"],
  },
  {
    id: "network",
    label: "Network Tools",
    icon: Network,
    description:
      "DNS records (A, AAAA, CNAME, NS, TXT, SOA, SRV, CAA…), propagation, DNSSEC, plus what's my IP and IP geolocation lookup.",
    keywords: ["dns", "ip address", "geolocation", "lookup", "propagation", "dnssec", "nslookup", "dig", "whats my ip", "cname", "txt record"],
  },
  {
    id: "lucky-wheel",
    label: "Lucky Wheel",
    icon: Disc3,
    description:
      "Spin a wheel of your own choices (one per line) to pick a random winner.",
    keywords: ["wheel", "spinner", "random", "picker", "raffle", "choice", "winner", "decide", "draw"],
  },
  {
    id: "api-client",
    label: "API Client",
    icon: Send,
    description:
      "Postman/Bruno-style HTTP workbench: collections, environments with {{vars}}, auth, pre/post-request scripts, tests & assertions, and Postman collection import/export.",
    keywords: ["http", "rest", "api", "request", "postman", "bruno", "insomnia", "curl", "endpoint", "get", "post", "fetch", "client"],
  },
  {
    id: "mock-server",
    label: "Mock Server",
    icon: ServerCog,
    description:
      "Run a local HTTP mock server: match requests by method, path, query, header, and body, then reply with templated or Rhai-scripted responses. Live request log.",
    keywords: ["mock", "stub", "fake api", "http server", "endpoint", "rhai", "response", "wiremock"],
  },
  {
    id: "2fa",
    label: "2FA Authenticator",
    icon: ShieldCheck,
    description:
      "Generate TOTP and HOTP one-time passwords supporting SHA-1/256/512, 6/8 digits, and 30/60-second periods.",
    keywords: ["2fa", "mfa", "totp", "hotp", "otp", "authenticator", "one-time password", "google authenticator", "verification code"],
  },
];

export const TOOL_DEF_MAP = new Map(TOOL_DEFS.map((t) => [t.id, t]));

// Default tool display order for fresh installs (before any user drag-drop reordering).
// Edit this array to change the out-of-box sort order before a build.
export const DEFAULT_TOOL_ORDER: string[] = [
  "task-tracker",
  "api-client",
  "mock-server",
  "json",
  "data-converter",
  "deduplicate",
  "text-transform",
  "sql-formatter",
  "unix-time",
  "generator",
  "base64",
  "text-counter",
  "regex",
  "diff",
  "cron-generator",
  "kafka-explorer",
  "qrcode",
  "color-picker",
  "jwt",
  "markdown",
  "lucky-wheel",
  "network",
  "2fa",
];
