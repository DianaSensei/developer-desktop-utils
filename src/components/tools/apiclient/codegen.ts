// Generate request code snippets in several languages from a request, mirroring
// Bruno's "Generate Code" dialog. Each language exposes one or more variants.

import type { ApiRequest, VarMap } from './types';
import { resolveRequest, shellQuote, type ResolvedRequest } from './request';

export interface CodeTarget {
  lang: string;
  editorLang: 'shell' | 'javascript' | 'python';
  variants: { id: string; label: string }[];
}

export const CODE_TARGETS: CodeTarget[] = [
  { lang: 'Shell', editorLang: 'shell', variants: [{ id: 'curl', label: 'curl' }, { id: 'httpie', label: 'httpie' }, { id: 'wget', label: 'wget' }] },
  { lang: 'JavaScript', editorLang: 'javascript', variants: [{ id: 'fetch', label: 'fetch' }, { id: 'axios', label: 'axios' }] },
  { lang: 'Python', editorLang: 'python', variants: [{ id: 'requests', label: 'requests' }] },
];

export function generateCode(
  request: ApiRequest, vars: VarMap, lang: string, variant: string, interpolate: boolean,
): string {
  const r = resolveRequest(request, vars, interpolate);
  switch (`${lang}/${variant}`) {
    case 'Shell/curl': return curl(r);
    case 'Shell/httpie': return httpie(r);
    case 'Shell/wget': return wget(r);
    case 'JavaScript/fetch': return jsFetch(r);
    case 'JavaScript/axios': return axios(r);
    case 'Python/requests': return pyRequests(r);
    default: return curl(r);
  }
}

// ─── shell ────────────────────────────────────────────────────────────────────

function curl(r: ResolvedRequest): string {
  const lines = [`curl --request ${r.method} \\`, `  --url ${shellQuote(r.url)}`];
  for (const [k, v] of r.headers) lines.push(`  --header ${shellQuote(`${k}: ${v}`)}`);
  const b = r.body;
  if (b.type === 'raw') lines.push(`  --data ${shellQuote(b.text)}`);
  else if (b.type === 'urlencoded') for (const [k, v] of b.fields) lines.push(`  --data-urlencode ${shellQuote(`${k}=${v}`)}`);
  else if (b.type === 'multipart') for (const f of b.fields) lines.push(`  --form ${shellQuote(`${f.key}=${f.file ? `@${f.file}` : f.value ?? ''}`)}`);
  else if (b.type === 'file' && b.fileName) lines.push(`  --data-binary ${shellQuote(`@${b.fileName}`)}`);
  return lines.join(' \\\n').replace(/ \\\n$/, '');
}

function httpie(r: ResolvedRequest): string {
  const parts = [`http ${r.method} ${shellQuote(r.url)}`];
  for (const [k, v] of r.headers) parts.push(shellQuote(`${k}:${v}`));
  const b = r.body;
  if (b.type === 'raw') return `echo ${shellQuote(b.text)} | ${parts.join(' ')}`;
  if (b.type === 'urlencoded') for (const [k, v] of b.fields) parts.push(shellQuote(`${k}=${v}`));
  else if (b.type === 'multipart') for (const f of b.fields) parts.push(shellQuote(f.file ? `${f.key}@${f.file}` : `${f.key}=${f.value ?? ''}`));
  return parts.join(' ');
}

function wget(r: ResolvedRequest): string {
  const lines = [`wget --method=${r.method} \\`, `  --quiet --output-document - ${shellQuote(r.url)}`];
  for (const [k, v] of r.headers) lines.splice(lines.length - 1, 0, `  --header=${shellQuote(`${k}: ${v}`)} \\`);
  if (r.body.type === 'raw') lines.splice(lines.length - 1, 0, `  --body-data=${shellQuote(r.body.text)} \\`);
  return lines.join('\n');
}

// ─── javascript ─────────────────────────────────────────────────────────────

function headersObject(r: ResolvedRequest, indent: string): string {
  if (!r.headers.length) return '';
  const body = r.headers.map(([k, v]) => `${indent}  ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n');
  return `{\n${body}\n${indent}}`;
}

function jsBody(r: ResolvedRequest): string | null {
  const b = r.body;
  if (b.type === 'raw') return JSON.stringify(b.text);
  if (b.type === 'urlencoded') return `new URLSearchParams(${JSON.stringify(Object.fromEntries(b.fields))})`;
  if (b.type === 'multipart') return '/* build a FormData and append the fields/files below */ formData';
  return null;
}

function jsFetch(r: ResolvedRequest): string {
  const opts: string[] = [`  method: ${JSON.stringify(r.method)}`];
  const h = headersObject(r, '  ');
  if (h) opts.push(`  headers: ${h}`);
  const body = jsBody(r);
  if (body) opts.push(`  body: ${body}`);
  return `const res = await fetch(${JSON.stringify(r.url)}, {\n${opts.join(',\n')}\n});\nconst data = await res.text();\nconsole.log(data);`;
}

function axios(r: ResolvedRequest): string {
  const cfg: string[] = [`  method: ${JSON.stringify(r.method)}`, `  url: ${JSON.stringify(r.url)}`];
  const h = headersObject(r, '  ');
  if (h) cfg.push(`  headers: ${h}`);
  const body = jsBody(r);
  if (body) cfg.push(`  data: ${body}`);
  return `import axios from 'axios';\n\nconst res = await axios({\n${cfg.join(',\n')}\n});\nconsole.log(res.data);`;
}

// ─── python ───────────────────────────────────────────────────────────────────

function pyRequests(r: ResolvedRequest): string {
  const lines = ['import requests', '', `url = ${JSON.stringify(r.url)}`];
  if (r.headers.length) {
    lines.push(`headers = {\n${r.headers.map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(',\n')}\n}`);
  }
  const args = ['url'];
  if (r.headers.length) args.push('headers=headers');
  const b = r.body;
  if (b.type === 'raw') { lines.push(`payload = ${JSON.stringify(b.text)}`); args.push('data=payload'); }
  else if (b.type === 'urlencoded') { lines.push(`payload = ${pyDict(b.fields)}`); args.push('data=payload'); }
  else if (b.type === 'multipart') {
    const files = b.fields.filter((f) => f.file);
    const data = b.fields.filter((f) => !f.file);
    if (data.length) { lines.push(`data = ${pyDict(data.map((f) => [f.key, f.value ?? '']))}`); args.push('data=data'); }
    if (files.length) { lines.push(`files = ${pyDict(files.map((f) => [f.key, `open(${JSON.stringify(f.file)}, 'rb')`]), true)}`); args.push('files=files'); }
  }
  lines.push('', `response = requests.request(${JSON.stringify(r.method)}, ${args.join(', ')})`, 'print(response.text)');
  return lines.join('\n');
}

function pyDict(entries: [string, string][], raw = false): string {
  if (!entries.length) return '{}';
  const body = entries.map(([k, v]) => `    ${JSON.stringify(k)}: ${raw ? v : JSON.stringify(v)}`).join(',\n');
  return `{\n${body}\n}`;
}
