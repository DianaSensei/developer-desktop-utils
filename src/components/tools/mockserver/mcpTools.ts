// MCP tool catalogue for this plugin — bundled with it, not with the
// platform. Registered once (mcp_register_tools) when this bridge mounts
// its `mcp:call` listener, so devtool-mcp-server.rs's dynamic
// `list_tools()` (no compiled-in tool list of its own) can advertise these
// to an MCP client. Kept in sync BY HAND with `buildHandlers()` in
// ./mcpBridge.ts.
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const MOCK_SERVER_MCP_TOOLS: McpToolDef[] = [
        // ── Mock Server ──────────────────────────────────────────────────
        // Only answers while DevTool is open with the Mock Server tool on
        // screen — same contract as the API Client tools above, for the same
        // reason (the stub list and bind config live in that mounted
        // component's state, not anywhere the sidecar can reach on its own).
        {
            "name": "mock_get_config",
            "description": "Get the mock server's bind (host/port), fallback response, running status, and a summarized stub list (id/enabled/name/method/path/mode/status — not matchers/headers/body/script). Use mock_get_stub for one stub's full definition.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "mock_get_stub",
            "description": "Get one stub's full definition: matchers, response mode, status, headers, body (or script for scripted responses), delay.",
            "inputSchema": { "type": "object", "properties": { "stubId": { "type": "string" } }, "required": ["stubId"] }
        },
        {
            "name": "mock_add_stub",
            "description": "Add a new stub. `stub` is a partial Stub object for the initial values (defaults: enabled=true, method=GET, mode=static — see get_scripting_reference for field shapes). Returns the created stub, appended to the end; reorder with mock_move_stub since stub order matters (first match wins).",
            "inputSchema": { "type": "object", "properties": { "stub": { "type": "object" } } }
        },
        {
            "name": "mock_update_stub",
            "description": "Patch a stub in place. `patch` is a partial Stub object — only the fields you include are changed.",
            "inputSchema": {
                "type": "object",
                "properties": { "stubId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["stubId", "patch"]
            }
        },
        {
            "name": "mock_duplicate_stub",
            "description": "Duplicate a stub (fresh id, \"<name> copy\") as the next stub right after the original. Returns the new stub.",
            "inputSchema": { "type": "object", "properties": { "stubId": { "type": "string" } }, "required": ["stubId"] }
        },
        {
            "name": "mock_delete_stub",
            "description": "Delete a stub by id.",
            "inputSchema": { "type": "object", "properties": { "stubId": { "type": "string" } }, "required": ["stubId"] }
        },
        {
            "name": "mock_move_stub",
            "description": "Move a stub up or down one position relative to its siblings. Stub order matters — the first enabled stub whose matchers all pass wins — so this is how to reprioritize overlapping stubs.",
            "inputSchema": {
                "type": "object",
                "properties": { "stubId": { "type": "string" }, "direction": { "type": "string", "enum": ["up", "down"] } },
                "required": ["stubId", "direction"]
            }
        },
        {
            "name": "mock_set_fallback",
            "description": "Patch the \"no stub matched\" response. `patch` may include any of notFoundStatus (number), notFoundBody (string), notFoundContentType (string).",
            "inputSchema": { "type": "object", "properties": { "patch": { "type": "object" } }, "required": ["patch"] }
        },
        {
            "name": "mock_set_bind",
            "description": "Set the host and/or port the server binds to on the next mock_start. Does NOT hot-swap an already-running server (unlike stubs/fallback, which apply live) — call mock_stop then mock_start to rebind.",
            "inputSchema": { "type": "object", "properties": { "host": { "type": "string" }, "port": { "type": "number" } } }
        },
        {
            "name": "mock_start",
            "description": "Start the mock server with the current config (stubs + bind address). Returns the resulting status (running/host/port). Errors if the port is already in use.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "mock_stop",
            "description": "Stop the mock server.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "mock_status",
            "description": "Get the mock server's current running status (running/host/port), without the config/stub list mock_get_config also returns.",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "mock_test_script",
            "description": "Run a Rhai response script against a synthetic request, without saving it to a stub — for iterating before mock_add_stub/mock_update_stub. `sample` is { method, path, query, headers, params, body } (all optional, defaults to GET /); see get_scripting_reference for the req/return shape.",
            "inputSchema": {
                "type": "object",
                "properties": { "script": { "type": "string" }, "sample": { "type": "object" } },
                "required": ["script"]
            }
        },
        {
            "name": "mock_get_request_log",
            "description": "Get the most recent requests the mock server handled (newest first, capped at `limit`, default 50), each with which stub matched (or null for the fallback), status, timing, and truncated request/response bodies.",
            "inputSchema": { "type": "object", "properties": { "limit": { "type": "number" } } }
        },
        {
            "name": "mock_clear_request_log",
            "description": "Clear the mock server's request log.",
            "inputSchema": { "type": "object", "properties": {} }
        },

];
