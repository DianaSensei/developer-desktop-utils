// MCP tool catalogue for this bridge — see mcpBridge.ts convention notes.
// Bundled with McpManageBridge.tsx (the platform's own management surface,
// mounted unconditionally at the app root) — kept in sync BY HAND with the
// `devtool_mcp_*` handlers in that file's `buildHandlers()`.
export interface McpToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export const META_MCP_TOOLS: McpToolDef[] = [
  {
            "name": "devtool_mcp_status",
            "description": "Get DevTool's current MCP integration state: whether the Background MCP bridge is on, the per-tool enabled/disabled map (toolsEnabled: api-client/mock-server/redis-client/kafka-explorer/rabbit-client/container-manager/base64/jwt/json), and the mock server's running status. Call this first if a tool's calls unexpectedly time out — a disabled tool times out exactly like \"wrong tool on screen\" does, since it never registers a listener either (except base64/jwt/json, which have no \"on screen\" requirement at all — a disabled one there just never answers).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "devtool_mcp_set_background",
            "description": "Turn DevTool's Background MCP bridge on or off (mirrors the Settings → MCP toggle). When on, every enabled tool's MCP tools answer regardless of which tool is on screen or whether the app window is focused — call this with enabled:true instead of asking the user to click it manually.",
            "inputSchema": {
                "type": "object",
                "properties": { "enabled": { "type": "boolean" } },
                "required": ["enabled"]
            }
        },
        {
            "name": "devtool_mcp_set_tool_enabled",
            "description": "Turn one tool's MCP access on or off (mirrors Settings → MCP → Per-tool MCP access). A disabled tool never answers any of its MCP tool calls — for the three stateless utility tools (base64/jwt/json) that means at all; for the rest, on screen or in the background. This is a separate, stricter switch than devtool_mcp_set_background. `tool` is one of: api-client, mock-server, redis-client, kafka-explorer, rabbit-client, container-manager, base64, jwt, json.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tool": { "type": "string", "enum": ["api-client", "mock-server", "redis-client", "kafka-explorer", "rabbit-client", "container-manager", "base64", "jwt", "json"] },
                    "enabled": { "type": "boolean" }
                },
                "required": ["tool", "enabled"]
            }
        },
];
