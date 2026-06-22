import {
  Calendar,
  Code,
  Clock,
  FileJson,
  Shield,
  Search,
  GitCompare,
  QrCode,
  FileText,
  Filter,
  Type,
  Palette,
  FileCheck,
  ImageIcon,
  Shuffle,
  Server,
  Database,
  Timer,
  Network,
  NotebookPen,
  Disc3,
  Send,
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
    icon: Calendar,
    description: "Build and validate cron expressions with a visual editor.",
  },
  {
    id: "text-transform",
    label: "Text Transformer",
    icon: Code,
    description:
      "Convert case, sort, trim, reverse, and transform text in bulk.",
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
    icon: Palette,
    description: "Pick colors and convert between HEX, RGB, HSL, and HSV.",
  },
  {
    id: "base64",
    label: "Encode·Hash·Encrypt",
    icon: Shield,
    description:
      "Encode/decode (Base64, URL, Hex, Morse…), hash (MD5, SHA-256, HMAC), and AES-256 encrypt/decrypt.",
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
    id: "jwt",
    label: "JWT Debugger",
    icon: Shield,
    description:
      "Decode and inspect JWT headers and payloads without verification.",
  },
  {
    id: "regex",
    label: "Regex Tester",
    icon: Search,
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
    description: "Generate QR codes from any text or URL and download as PNG.",
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
    icon: Filter,
    description: "Remove duplicate lines or items from any list.",
  },
  {
    id: "checksum",
    label: "Checksum",
    icon: FileCheck,
    description:
      "Compute MD5, SHA-1, SHA-256, and SHA-512 checksums for any file.",
  },
  {
    id: "image-base64",
    label: "Image ↔ Base64",
    icon: ImageIcon,
    description:
      "Convert images to Base64 strings and render Base64 back to images.",
  },
  {
    id: "generator",
    label: "Generator",
    icon: Shuffle,
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
      "Clockify-style time suite: tracker, timesheet, calendar, schedule, expenses, and time off.",
  },
  {
    id: "network",
    label: "Network Tools",
    icon: Network,
    description:
      "DNS records (A, AAAA, CNAME, NS, TXT, SOA, SRV, CAA…), propagation, DNSSEC, plus what's my IP and IP geolocation lookup.",
  },
  {
    id: "meeting-notes",
    label: "Meeting Notes",
    icon: NotebookPen,
    description:
      "Manage meeting minutes — search, create, and edit timed notes that sync with the Time Tracker calendar and export to Markdown.",
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
];

export const TOOL_DEF_MAP = new Map(TOOL_DEFS.map((t) => [t.id, t]));

// Default tool display order for fresh installs (before any user drag-drop reordering).
// Edit this array to change the out-of-box sort order before a build.
export const DEFAULT_TOOL_ORDER: string[] = [
  "task-tracker",
  "api-client",
  "json",
  "deduplicate",
  "text-transform",
  "sql-formatter",
  "unix-time",
  "generator",
  "base64",
  "text-counter",
  "regex",
  "diff",
  "checksum",
  "cron-generator",
  "qrcode",
  "image-base64",
  "color-picker",
  "jwt",
  "markdown",
  "meeting-notes",
  "lucky-wheel",
  "network",
  "kafka-explorer",
];
