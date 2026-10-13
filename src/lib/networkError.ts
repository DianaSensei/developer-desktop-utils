// Classifies a transport error (no response at all) so the UI can say what
// probably went wrong. Messages come from the webview's fetch ("Failed to
// fetch", "Load failed") or from reqwest through the Tauri HTTP plugin
// ("dns error: failed to lookup address", "Connection refused",
// "operation timed out"). Certificate and redirect-loop errors have their
// own hints in the API Client, so they are not classified here.

export type NetworkErrorKind = 'dns' | 'refused' | 'timeout' | 'unreachable';

const PATTERNS: [NetworkErrorKind, RegExp][] = [
  ['dns', /\bdns\b|failed to lookup|getaddrinfo|enotfound|name or service not known|no such host|nodename nor servname/i],
  ['refused', /connection refused|econnrefused|actively refused/i],
  ['timeout', /timed? ?out|timeout|etimedout/i],
  ['unreachable', /failed to fetch|load failed|networkerror|network is unreachable|enetunreach|error sending request|connection reset|econnreset/i],
];

export function classifyNetworkError(message: string): NetworkErrorKind | null {
  for (const [kind, re] of PATTERNS) if (re.test(message)) return kind;
  return null;
}
