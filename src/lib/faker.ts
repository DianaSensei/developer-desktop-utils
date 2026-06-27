// Test-data generation backed by @faker-js/faker — a large, realistic dataset
// covering identity, internet, location, finance, commerce, and more. The
// library is heavy, so it's dynamically imported (lazy-loaded only when the
// Test Data tool runs) and the whole thing stays offline. Output is
// deterministic for a given seed via faker.seed().

import type { Faker } from '@faker-js/faker';
import { stringifyProperties } from '@/lib/properties';

export type FakerType =
  // Identity
  | 'uuid' | 'firstName' | 'lastName' | 'fullName' | 'jobTitle' | 'sex'
  // Internet
  | 'email' | 'username' | 'password' | 'url' | 'domainName' | 'ipv4' | 'ipv6' | 'mac' | 'userAgent' | 'emoji'
  // Contact / location
  | 'phone' | 'streetAddress' | 'city' | 'state' | 'zipCode' | 'country' | 'countryCode' | 'latitude' | 'longitude' | 'timeZone'
  // Business
  | 'company' | 'catchPhrase' | 'product' | 'price' | 'department'
  // Finance
  | 'currencyCode' | 'amount' | 'iban' | 'creditCard' | 'accountNumber' | 'bitcoinAddress'
  // Content
  | 'word' | 'words' | 'sentence' | 'paragraph' | 'slug'
  // Misc / primitives
  | 'color' | 'vehicle' | 'boolean' | 'int' | 'float' | 'date' | 'birthdate' | 'enum';

export type DateFormat =
  | 'iso' | 'isoDate' | 'isoDateTime' | 'us' | 'eu' | 'time' | 'unix' | 'unixMs' | 'readable';

export interface FieldDef {
  id: string;
  name: string;
  type: FakerType;
  min?: number;          // int / float
  max?: number;          // int / float
  decimals?: number;     // float
  values?: string;       // enum (comma-separated)
  dateFormat?: DateFormat; // date / birthdate
}

export const DATE_FORMATS: { value: DateFormat; label: string; example: string }[] = [
  { value: 'iso',         label: 'ISO 8601',     example: '2026-06-09T10:19:04Z' },
  { value: 'isoDate',     label: 'Date',         example: '2026-06-09' },
  { value: 'isoDateTime', label: 'Date & time',  example: '2026-06-09 10:19:04' },
  { value: 'us',          label: 'US',           example: '06/09/2026' },
  { value: 'eu',          label: 'EU',           example: '09/06/2026' },
  { value: 'time',        label: 'Time',         example: '10:19:04' },
  { value: 'unix',        label: 'Unix (s)',     example: '1781345944' },
  { value: 'unixMs',      label: 'Unix (ms)',    example: '1781345944355' },
  { value: 'readable',    label: 'Readable',     example: 'Tue Jun 09 2026' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

// Formats a date using UTC components so output stays deterministic across
// machines/timezones for a given seed.
function formatDate(d: Date, fmt: DateFormat = 'iso'): string | number {
  const Y = d.getUTCFullYear(), Mo = d.getUTCMonth(), D = d.getUTCDate();
  const M = pad(Mo + 1), DD = pad(D);
  const h = pad(d.getUTCHours()), m = pad(d.getUTCMinutes()), s = pad(d.getUTCSeconds());
  switch (fmt) {
    case 'iso': return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
    case 'isoDate': return `${Y}-${M}-${DD}`;
    case 'isoDateTime': return `${Y}-${M}-${DD} ${h}:${m}:${s}`;
    case 'us': return `${M}/${DD}/${Y}`;
    case 'eu': return `${DD}/${M}/${Y}`;
    case 'time': return `${h}:${m}:${s}`;
    case 'unix': return Math.floor(d.getTime() / 1000);
    case 'unixMs': return d.getTime();
    case 'readable': return `${WEEKDAYS[d.getUTCDay()]} ${MONTHS[Mo]} ${DD} ${Y}`;
  }
}

// Grouped, ordered list for the type picker.
export const FAKER_TYPE_GROUPS: { group: string; types: { value: FakerType; label: string }[] }[] = [
  { group: 'Identity', types: [
    { value: 'uuid', label: 'UUID' },
    { value: 'fullName', label: 'Full name' },
    { value: 'firstName', label: 'First name' },
    { value: 'lastName', label: 'Last name' },
    { value: 'jobTitle', label: 'Job title' },
    { value: 'sex', label: 'Sex' },
  ] },
  { group: 'Internet', types: [
    { value: 'email', label: 'Email' },
    { value: 'username', label: 'Username' },
    { value: 'password', label: 'Password' },
    { value: 'url', label: 'URL' },
    { value: 'domainName', label: 'Domain' },
    { value: 'ipv4', label: 'IPv4' },
    { value: 'ipv6', label: 'IPv6' },
    { value: 'mac', label: 'MAC address' },
    { value: 'userAgent', label: 'User agent' },
    { value: 'emoji', label: 'Emoji' },
  ] },
  { group: 'Contact / Location', types: [
    { value: 'phone', label: 'Phone' },
    { value: 'streetAddress', label: 'Street address' },
    { value: 'city', label: 'City' },
    { value: 'state', label: 'State' },
    { value: 'zipCode', label: 'Zip code' },
    { value: 'country', label: 'Country' },
    { value: 'countryCode', label: 'Country code' },
    { value: 'latitude', label: 'Latitude' },
    { value: 'longitude', label: 'Longitude' },
    { value: 'timeZone', label: 'Time zone' },
  ] },
  { group: 'Business', types: [
    { value: 'company', label: 'Company' },
    { value: 'catchPhrase', label: 'Catch phrase' },
    { value: 'product', label: 'Product' },
    { value: 'price', label: 'Price' },
    { value: 'department', label: 'Department' },
  ] },
  { group: 'Finance', types: [
    { value: 'currencyCode', label: 'Currency code' },
    { value: 'amount', label: 'Amount' },
    { value: 'iban', label: 'IBAN' },
    { value: 'creditCard', label: 'Credit card' },
    { value: 'accountNumber', label: 'Account number' },
    { value: 'bitcoinAddress', label: 'Bitcoin address' },
  ] },
  { group: 'Content', types: [
    { value: 'word', label: 'Word' },
    { value: 'words', label: 'Words' },
    { value: 'sentence', label: 'Sentence' },
    { value: 'paragraph', label: 'Paragraph' },
    { value: 'slug', label: 'Slug' },
  ] },
  { group: 'Misc', types: [
    { value: 'boolean', label: 'Boolean' },
    { value: 'int', label: 'Integer' },
    { value: 'float', label: 'Float' },
    { value: 'date', label: 'Date (past)' },
    { value: 'birthdate', label: 'Birthdate' },
    { value: 'color', label: 'Color (hex)' },
    { value: 'vehicle', label: 'Vehicle' },
    { value: 'enum', label: 'Enum (custom)' },
  ] },
];

function genValue(f: Faker, fd: FieldDef): unknown {
  switch (fd.type) {
    case 'uuid': return f.string.uuid();
    case 'firstName': return f.person.firstName();
    case 'lastName': return f.person.lastName();
    case 'fullName': return f.person.fullName();
    case 'jobTitle': return f.person.jobTitle();
    case 'sex': return f.person.sex();
    case 'email': return f.internet.email();
    case 'username': return f.internet.username();
    case 'password': return f.internet.password();
    case 'url': return f.internet.url();
    case 'domainName': return f.internet.domainName();
    case 'ipv4': return f.internet.ipv4();
    case 'ipv6': return f.internet.ipv6();
    case 'mac': return f.internet.mac();
    case 'userAgent': return f.internet.userAgent();
    case 'emoji': return f.internet.emoji();
    case 'phone': return f.phone.number();
    case 'streetAddress': return f.location.streetAddress();
    case 'city': return f.location.city();
    case 'state': return f.location.state();
    case 'zipCode': return f.location.zipCode();
    case 'country': return f.location.country();
    case 'countryCode': return f.location.countryCode();
    case 'latitude': return f.location.latitude();
    case 'longitude': return f.location.longitude();
    case 'timeZone': return f.location.timeZone();
    case 'company': return f.company.name();
    case 'catchPhrase': return f.company.catchPhrase();
    case 'product': return f.commerce.productName();
    case 'price': return f.commerce.price();
    case 'department': return f.commerce.department();
    case 'currencyCode': return f.finance.currencyCode();
    case 'amount': return f.finance.amount();
    case 'iban': return f.finance.iban();
    case 'creditCard': return f.finance.creditCardNumber();
    case 'accountNumber': return f.finance.accountNumber();
    case 'bitcoinAddress': return f.finance.bitcoinAddress();
    case 'word': return f.lorem.word();
    case 'words': return f.lorem.words();
    case 'sentence': return f.lorem.sentence();
    case 'paragraph': return f.lorem.paragraph();
    case 'slug': return f.lorem.slug();
    case 'color': return f.color.rgb();
    case 'vehicle': return f.vehicle.vehicle();
    case 'boolean': return f.datatype.boolean();
    case 'int': {
      const min = fd.min ?? 0;
      const max = fd.max ?? 1000;
      return f.number.int({ min: Math.min(min, max), max: Math.max(min, max) });
    }
    case 'float': {
      const min = fd.min ?? 0;
      const max = fd.max ?? 1000;
      return f.number.float({ min: Math.min(min, max), max: Math.max(min, max), fractionDigits: Math.max(0, Math.min(fd.decimals ?? 2, 10)) });
    }
    case 'date': return formatDate(f.date.past(), fd.dateFormat ?? 'iso');
    case 'birthdate': return formatDate(f.date.birthdate(), fd.dateFormat ?? 'isoDate');
    case 'enum': {
      const opts = (fd.values ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      return opts.length ? f.helpers.arrayElement(opts) : null;
    }
  }
}

// Lazily load faker once and cache it (keeps the heavy library out of the main bundle).
let _faker: Faker | null = null;
async function getFaker(): Promise<Faker> {
  if (!_faker) { _faker = (await import('@faker-js/faker')).faker; }
  return _faker;
}

// ─── Output serialization ─────────────────────────────────────────────────────

export type RowFormat = 'json' | 'ndjson' | 'yaml' | 'csv' | 'tsv' | 'sql' | 'properties';

export const ROW_FORMATS: { value: RowFormat; label: string; ext: string }[] = [
  { value: 'json', label: 'JSON', ext: 'json' },
  { value: 'ndjson', label: 'NDJSON', ext: 'ndjson' },
  { value: 'yaml', label: 'YAML', ext: 'yaml' },
  { value: 'csv', label: 'CSV', ext: 'csv' },
  { value: 'tsv', label: 'TSV', ext: 'tsv' },
  { value: 'sql', label: 'SQL', ext: 'sql' },
  { value: 'properties', label: '.properties', ext: 'properties' },
];

// Unique, ordered, non-empty column names from the schema.
function columns(fields: FieldDef[]): string[] {
  const seen = new Set<string>();
  const cols: string[] = [];
  for (const f of fields) {
    const n = f.name.trim();
    if (n && !seen.has(n)) { seen.add(n); cols.push(n); }
  }
  return cols;
}

function csvCell(v: unknown, delim: string): string {
  const s = v == null ? '' : String(v);
  return s.includes(delim) || /["\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function sqlLiteral(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return `'${String(v).replace(/'/g, "''")}'`;
}

export async function serializeRows(
  rows: Record<string, unknown>[],
  fields: FieldDef[],
  format: RowFormat,
  opts: { table?: string; prefix?: string } = {},
): Promise<string> {
  const cols = columns(fields);
  switch (format) {
    case 'json':
      return JSON.stringify(rows, null, 2);
    case 'ndjson':
      return rows.map((r) => JSON.stringify(r)).join('\n');
    case 'yaml': {
      const { dump } = await import('js-yaml');
      return dump(rows);
    }
    case 'csv':
    case 'tsv': {
      const d = format === 'csv' ? ',' : '\t';
      const head = cols.map((c) => csvCell(c, d)).join(d);
      const body = rows.map((r) => cols.map((c) => csvCell(r[c], d)).join(d));
      return [head, ...body].join('\n');
    }
    case 'sql': {
      const table = (opts.table || 'data').trim() || 'data';
      const colList = cols.join(', ');
      return rows.map((r) => `INSERT INTO ${table} (${colList}) VALUES (${cols.map((c) => sqlLiteral(r[c])).join(', ')});`).join('\n');
    }
    case 'properties': {
      // Array of rows → indexed flat keys. A prefix groups them under one key,
      // e.g. prefix "data" → data[0].name=… (Spring-style list binding).
      const prefix = (opts.prefix ?? '').trim();
      return stringifyProperties(prefix ? { [prefix]: rows } : rows);
    }
  }
}

export async function generateRows(fields: FieldDef[], count: number, seed: number): Promise<Record<string, unknown>[]> {
  const faker = await getFaker();
  faker.seed(seed); // deterministic for a given seed
  const named = fields.filter((fd) => fd.name.trim());
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) {
    const row: Record<string, unknown> = {};
    for (const fd of named) {
      try { row[fd.name] = genValue(faker, fd); }
      catch { row[fd.name] = null; }
    }
    rows.push(row);
  }
  return rows;
}
