// MCP tool catalogues for McpUtilityBridge.tsx — split by which per-tool
// toggle gates each (base64/jwt/json in useMcpToolEnabled.ts), since that
// bridge registers only the currently-enabled subset (see its own
// registration effect). Kept in sync BY HAND with buildCodecHandlers/
// buildJwtHandlers/buildJsonHandlers in ./tools/*McpBridge.ts.
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const CODEC_MCP_TOOLS: McpToolDef[] = [
  {
            "name": "codec_encode",
            "description": "Encode text with a codec. `algorithm` is one of: base64, base62, rot13, url, html, quoted-printable, huffman, rle, morse, punycode, hex, octal, binary, decimal.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "algorithm": { "type": "string", "enum": ["base64", "base62", "rot13", "url", "html", "quoted-printable", "huffman", "rle", "morse", "punycode", "hex", "octal", "binary", "decimal"] }
                },
                "required": ["text", "algorithm"]
            }
        },
        {
            "name": "codec_decode",
            "description": "Decode text with a codec — same `algorithm` list as codec_encode.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "algorithm": { "type": "string", "enum": ["base64", "base62", "rot13", "url", "html", "quoted-printable", "huffman", "rle", "morse", "punycode", "hex", "octal", "binary", "decimal"] }
                },
                "required": ["text", "algorithm"]
            }
        },
        {
            "name": "hash_compute",
            "description": "Hash text. Omit `algorithm` to get every algorithm at once (md5, ripemd160, sha1, sha224, sha256, sha384, sha512, sha3-256, sha3-512), as { algorithm: hash }; pass one to get just that hash as { algorithm, hash }.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "algorithm": { "type": "string", "enum": ["md5", "ripemd160", "sha1", "sha224", "sha256", "sha384", "sha512", "sha3-256", "sha3-512"] },
                    "upperHex": { "type": "boolean" }
                },
                "required": ["text"]
            }
        },
        {
            "name": "hash_hmac",
            "description": "Compute an HMAC. `algorithm` is one of: md5, ripemd160, sha1, sha224, sha256, sha384, sha512 (SHA-3 has no dedicated per-length HMAC function, so it's excluded here, same as the UI).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "key": { "type": "string" },
                    "algorithm": { "type": "string", "enum": ["md5", "ripemd160", "sha1", "sha224", "sha256", "sha384", "sha512"] },
                    "upperHex": { "type": "boolean" }
                },
                "required": ["text", "key", "algorithm"]
            }
        },
        {
            "name": "encrypt_text",
            "description": "Encrypt text with a passphrase. `algorithm`: \"aes-gcm\" is recommended (PBKDF2-SHA256 600k-round key stretching, authenticated, random salt+IV) — the rest (aes-cbc/ctr/ecb/cfb/ofb, tripledes, rabbit) exist for crypto-js interop only (weak key stretching, unauthenticated; aes-ecb also leaks plaintext structure). `key` is supplied by the caller — never read from the app's own saved passphrase.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "key": { "type": "string" },
                    "algorithm": { "type": "string", "enum": ["aes-gcm", "aes-cbc", "aes-ctr", "aes-ecb", "aes-cfb", "aes-ofb", "tripledes", "rabbit"] }
                },
                "required": ["text", "key", "algorithm"]
            }
        },
        {
            "name": "decrypt_text",
            "description": "Decrypt text encrypted with encrypt_text (or, for the crypto-js algorithms, anything crypto-js itself produced). `algorithm` must match what encrypted it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "ciphertext": { "type": "string" },
                    "key": { "type": "string" },
                    "algorithm": { "type": "string", "enum": ["aes-gcm", "aes-cbc", "aes-ctr", "aes-ecb", "aes-cfb", "aes-ofb", "tripledes", "rabbit"] }
                },
                "required": ["ciphertext", "key", "algorithm"]
            }
        },
];

export const JWT_MCP_TOOLS: McpToolDef[] = [
        // ── JWT Debugger — stateless, same McpUtilityBridge.tsx as above,
        // gated by the `jwt` tool id.
        {
            "name": "jwt_decode",
            "description": "Decode a JWT's header and payload. Decode-only — does NOT verify the signature (no verification key available).",
            "inputSchema": { "type": "object", "properties": { "token": { "type": "string" } }, "required": ["token"] }
        },
];

export const JSON_MCP_TOOLS: McpToolDef[] = [
        // ── JSON Formatter — stateless, same McpUtilityBridge.tsx as above,
        // gated by the `json` tool id. All four accept lenient input: single
        // quotes, unquoted object keys, trailing commas, // and /* */
        // comments, and a JSON-string-literal wrapper — same parser the UI
        // itself uses.
        {
            "name": "json_format",
            "description": "Pretty-print JSON (or JSON-ish input — see tool description). `indent` is \"2\" (default), \"4\", or \"tab\"; `quote` is `\"` (default) or `'`.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": { "type": "string" },
                    "indent": { "type": "string", "enum": ["2", "4", "tab"] },
                    "quote": { "type": "string", "enum": ["\"", "'"] }
                },
                "required": ["text"]
            }
        },
        {
            "name": "json_minify",
            "description": "Minify JSON (or JSON-ish input) to a single line, no whitespace.",
            "inputSchema": {
                "type": "object",
                "properties": { "text": { "type": "string" }, "quote": { "type": "string", "enum": ["\"", "'"] } },
                "required": ["text"]
            }
        },
        {
            "name": "json_to_string",
            "description": "Minify JSON, then re-encode the result as a single escaped string literal — for embedding a JSON payload inside another string (a shell command, a source file, …).",
            "inputSchema": {
                "type": "object",
                "properties": { "text": { "type": "string" }, "quote": { "type": "string", "enum": ["\"", "'"] } },
                "required": ["text"]
            }
        },
        {
            "name": "json_validate",
            "description": "Check whether input parses (leniently — see tool description). Returns { valid: true } or { valid: false, error }.",
            "inputSchema": { "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] }
        },
];
