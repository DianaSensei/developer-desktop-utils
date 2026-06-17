import {
  Calendar,
  Code,
  Hash,
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
    label: "Encoder / Decoder",
    icon: Code,
    description:
      "Encode and decode Base64, URL, HTML entities, Hex, Morse, and more.",
  },
  {
    id: "hash",
    label: "Hash & Encrypt",
    icon: Hash,
    description:
      "Compute MD5, SHA-1, SHA-256, SHA-512 hashes and AES encrypt/decrypt.",
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
];

export const TOOL_DEF_MAP = new Map(TOOL_DEFS.map((t) => [t.id, t]));

// Default tool display order for fresh installs (before any user drag-drop reordering).
// Edit this array to change the out-of-box sort order before a build.
export const DEFAULT_TOOL_ORDER: string[] = [
  "task-tracker",
  "json",
  "deduplicate",
  "text-transform",
  "sql-formatter",
  "unix-time",
  "generator",
  "text-counter",
  "base64",
  "regex",
  "diff",
  "checksum",
  "cron-generator",
  "qrcode",
  "image-base64",
  "color-picker",
  "hash",
  "jwt",
  "markdown",
  "kafka-explorer",
];
