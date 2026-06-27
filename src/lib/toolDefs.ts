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
}

export const TOOL_DEFS: ToolDef[] = [
  {
    id: "cron-generator",
    label: "Cron Generator",
    icon: CalendarClock,
    description: "Build and validate cron expressions with a visual editor.",
  },
  {
    id: "text-transform",
    label: "Text Transformer",
    icon: CaseSensitive,
    description:
      "Change case, join/split lines, build arrays, and convert Vietnamese phone numbers.",
  },
  {
    id: "text-counter",
    label: "Text Counter",
    icon: Type,
    description: "Count characters, words, lines and estimate reading time.",
  },
  {
    id: "color-picker",
    label: "Color Picker",
    icon: Pipette,
    description: "Pick colors from an image and convert between HEX, RGB, HSL, and CMYK.",
  },
  {
    id: "base64",
    label: "Encode·Hash·Encrypt",
    icon: Binary,
    description:
      "Encode/decode (Base64, URL, Hex, Morse…), image↔Base64, hash text or files (MD5, SHA, HMAC, checksums), and AES-256 encrypt/decrypt.",
  },
  {
    id: "unix-time",
    label: "Date / Time",
    icon: Clock,
    description:
      "Convert timestamps, compare dates, and format in any timezone.",
  },
  {
    id: "json",
    label: "JSON Formatter",
    icon: FileJson,
    description:
      "Format, validate, minify, and explore JSON with syntax highlighting.",
  },
  {
    id: "data-converter",
    label: "Data Converter",
    icon: ArrowLeftRight,
    description:
      "Convert structured data between JSON, YAML, TOML, XML, and .properties — fully offline.",
  },
  {
    id: "jwt",
    label: "JWT Debugger",
    icon: KeyRound,
    description:
      "Decode and inspect JWT headers and payloads without verification.",
  },
  {
    id: "regex",
    label: "Regex Tester",
    icon: Regex,
    description:
      "Test regular expressions with live match highlighting and group capture.",
  },
  {
    id: "diff",
    label: "Text Diff",
    icon: GitCompare,
    description:
      "Compare two text blocks and highlight additions and removals.",
  },
  {
    id: "qrcode",
    label: "QR Code",
    icon: QrCode,
    description: "Generate QR codes from text or URLs, or decode a QR image back to its content.",
  },
  {
    id: "markdown",
    label: "Markdown",
    icon: FileText,
    description: "Live Markdown preview with standard formatting support.",
  },
  {
    id: "deduplicate",
    label: "Deduplicate",
    icon: CopyMinus,
    description: "Remove duplicate lines or items from any list.",
  },
  {
    id: "generator",
    label: "Random Generator",
    icon: Dices,
    description:
      "Generate UUIDs, random numbers, and text with custom character sets.",
  },
  {
    id: "kafka-explorer",
    label: "Kafka Explorer",
    icon: Server,
    description:
      "Browse topics, inspect partitions and offsets, manage consumer groups, and produce messages.",
  },
  {
    id: "sql-formatter",
    label: "SQL Formatter",
    icon: Database,
    description:
      "Format and beautify SQL queries with keyword casing, space collapse, and clause line breaks.",
  },
  {
    id: "task-tracker",
    label: "Time Tracker",
    icon: Timer,
    description:
      "Time tracker with timesheet, calendar, and meeting-notes views, projects, tags, and pomodoro.",
  },
  {
    id: "network",
    label: "Network Tools",
    icon: Network,
    description:
      "DNS records (A, AAAA, CNAME, NS, TXT, SOA, SRV, CAA…), propagation, DNSSEC, plus what's my IP and IP geolocation lookup.",
  },
  {
    id: "lucky-wheel",
    label: "Lucky Wheel",
    icon: Disc3,
    description:
      "Spin a wheel of your own choices (one per line) to pick a random winner.",
  },
  {
    id: "api-client",
    label: "API Client",
    icon: Send,
    description:
      "Postman/Bruno-style HTTP workbench: collections, environments with {{vars}}, auth, pre/post-request scripts, tests & assertions, and Postman collection import/export.",
  },
  {
    id: "mock-server",
    label: "Mock Server",
    icon: ServerCog,
    description:
      "Run a local HTTP mock server: match requests by method, path, query, header, and body, then reply with templated or Rhai-scripted responses. Live request log.",
  },
  {
    id: "2fa",
    label: "2FA Authenticator",
    icon: ShieldCheck,
    description:
      "Generate TOTP and HOTP one-time passwords supporting SHA-1/256/512, 6/8 digits, and 30/60-second periods.",
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
