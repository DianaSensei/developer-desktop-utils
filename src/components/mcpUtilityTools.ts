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
            "description": "Decode a JWT's header and payload, plus `expired`/`notYetValid` computed from exp/nbf. Does NOT check the signature — use jwt_verify for that.",
            "inputSchema": { "type": "object", "properties": { "token": { "type": "string" } }, "required": ["token"] }
        },
        {
            "name": "jwt_verify",
            "description": "Verify a JWT's signature (and optionally iss/aud/sub) with a key you supply. `algorithm` is the one you EXPECT — the token's own `alg` header is never trusted to choose, so a token whose header disagrees is rejected with reason \"alg\". A failed check is a normal result, not an error: returns { valid, reason, message, header, payload }, where reason is one of format/key/alg/signature/expired/nbf/claim. `key` is the shared secret for HS*, or a PEM SPKI public key, X.509 certificate, JWK or JWK Set for the rest. `keyEncoding` says how an HS* secret is written down (utf8 default, base64, base64url, hex) — getting it wrong changes the bytes and fails the signature.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "token": { "type": "string" },
                    "algorithm": { "type": "string", "enum": ["HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA", "none"] },
                    "key": { "type": "string" },
                    "keyEncoding": { "type": "string", "enum": ["utf8", "base64", "base64url", "hex"] },
                    "issuer": { "type": "string" },
                    "audience": { "type": "string" },
                    "subject": { "type": "string" },
                    "clockTolerance": { "type": "number", "description": "Seconds of leeway on exp/nbf." }
                },
                "required": ["token", "algorithm", "key"]
            }
        },
        {
            "name": "jwt_sign",
            "description": "Sign claims into a JWT. `key` is the shared secret for HS*, or a PEM PKCS#8 private key or private JWK for RS*/PS*/ES*/EdDSA (PKCS#1 \"BEGIN RSA PRIVATE KEY\" is not accepted — convert with `openssl pkcs8 -topk8`). `expiresIn`/`notBefore` take a duration (\"1h\", \"7d\", or plain seconds), never an absolute timestamp. `iat` is set unless issuedAt is false. Algorithm \"none\" produces an UNSIGNED token that proves nothing — only for testing how a server reacts to one.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "payload": { "type": "object", "description": "Claims object. A JSON string is also accepted." },
                    "algorithm": { "type": "string", "enum": ["HS256", "HS384", "HS512", "RS256", "RS384", "RS512", "PS256", "PS384", "PS512", "ES256", "ES384", "ES512", "EdDSA", "none"] },
                    "key": { "type": "string" },
                    "keyEncoding": { "type": "string", "enum": ["utf8", "base64", "base64url", "hex"] },
                    "expiresIn": { "type": "string" },
                    "notBefore": { "type": "string" },
                    "kid": { "type": "string" },
                    "issuedAt": { "type": "boolean" }
                },
                "required": ["payload", "algorithm"]
            }
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
