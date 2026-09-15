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

const whereSchema = { type: 'string', enum: ['before', 'after', 'inside'], default: 'inside' };

function kvArraySchema() {
  return {
    type: 'array',
    items: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        key: { type: 'string' },
        value: { type: 'string' },
        enabled: { type: 'boolean' },
      },
      required: ['id', 'key', 'value', 'enabled'],
    },
  };
}

function nullableString() {
  return { type: ['string', 'null'] };
}

export const API_CLIENT_MCP_TOOLS: McpToolDef[] = [
        {
            "name": "list_collections",
            "description": "List every collection open in DevTool's API Client, with their folder/request tree (id, name, method, url — no bodies/scripts/secrets).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "get_collection",
            "description": "Get one collection by id, including its own script/auth/headers/variables (not its requests' bodies — use get_request for those).",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" } }, "required": ["collectionId"] }
        },
        {
            "name": "get_request",
            "description": "Get the full definition of one request by id: method, url, params, headers, body, auth, pre/post-request script, tests, assertions, settings.",
            "inputSchema": { "type": "object", "properties": { "requestId": { "type": "string" } }, "required": ["requestId"] }
        },
        {
            "name": "update_request",
            "description": "Patch a request in place. `patch` is a partial ApiRequest — only included top-level fields change (e.g. { \"url\", \"method\" }). For the nested object fields — script ({req, res}, auth, body, settings — you may pass either the full object or just the part you're changing: patch.script = { \"req\": \"...\" } alone updates only the pre-request script and leaves the post-response script (res) untouched, same for auth.apiKey/.oauth2 and body.graphql. Array fields (params/headers/pathParams/assertions) still fully replace — pass every row you want kept.",
            "inputSchema": {
                "type": "object",
                "properties": { "requestId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["requestId", "patch"]
            }
        },
        {
            "name": "create_request",
            "description": "Create a new request in a collection (optionally inside a folder) and return it. `request` is a partial ApiRequest used as the initial values.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "folderId": { "type": "string" }, "request": { "type": "object" } },
                "required": ["collectionId"]
            }
        },
        {
            "name": "run_request",
            "description": "Send a request through DevTool (same engine as Send): pre-request script → send → post-response script → tests/assertions → History. Returns response (body capped), tests, logs, and any error. Pass environmentId to override the active environment (null = \"No Environment\").",
            "inputSchema": {
                "type": "object",
                "properties": { "requestId": { "type": "string" }, "environmentId": nullableString() },
                "required": ["requestId"]
            }
        },
        {
            "name": "add_folder",
            "description": "Create a folder in a collection (optionally nested inside another folder) and return its id.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "name": { "type": "string" }, "parentId": { "type": "string" } },
                "required": ["collectionId"]
            }
        },
        {
            "name": "rename_item",
            "description": "Rename a request or folder by id.",
            "inputSchema": { "type": "object", "properties": { "itemId": { "type": "string" }, "name": { "type": "string" } }, "required": ["itemId", "name"] }
        },
        {
            "name": "delete_item",
            "description": "Delete a request or a folder (and everything inside it) by id.",
            "inputSchema": { "type": "object", "properties": { "itemId": { "type": "string" } }, "required": ["itemId"] }
        },
        {
            "name": "clone_item",
            "description": "Duplicate a request or folder as a new sibling right after it.",
            "inputSchema": { "type": "object", "properties": { "itemId": { "type": "string" } }, "required": ["itemId"] }
        },
        {
            "name": "move_item",
            "description": "Move (cut) a request or folder to a new spot. `targetId` may be a collection id (moves to its root), or a request/folder id combined with `where`: \"before\"/\"after\" that sibling, or \"inside\" it (folders only).",
            "inputSchema": {
                "type": "object",
                "properties": { "sourceId": { "type": "string" }, "targetId": { "type": "string" }, "where": whereSchema },
                "required": ["sourceId", "targetId"]
            }
        },
        {
            "name": "copy_item",
            "description": "Copy (not cut) a request or folder to a new spot — same targeting as move_item, but the source is left in place.",
            "inputSchema": {
                "type": "object",
                "properties": { "sourceId": { "type": "string" }, "targetId": { "type": "string" }, "where": whereSchema },
                "required": ["sourceId", "targetId"]
            }
        },
        {
            "name": "add_collection",
            "description": "Create a new, empty collection and return its id.",
            "inputSchema": { "type": "object", "properties": { "name": { "type": "string" } } }
        },
        {
            "name": "rename_collection",
            "description": "Rename a collection by id.",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" }, "name": { "type": "string" } }, "required": ["collectionId", "name"] }
        },
        {
            "name": "delete_collection",
            "description": "Delete a collection (and everything inside it) by id. Also drops any environments scoped to it.",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" } }, "required": ["collectionId"] }
        },
        {
            "name": "clone_collection",
            "description": "Duplicate a whole collection (deep copy, fresh ids for everything inside) right after the original.",
            "inputSchema": { "type": "object", "properties": { "collectionId": { "type": "string" } }, "required": ["collectionId"] }
        },
        {
            "name": "set_collection_variables",
            "description": "Replace a collection's Collection Variables (shared defaults available to every request in it, regardless of active environment). Pass the full array you want it to end up with.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "variables": kvArraySchema() },
                "required": ["collectionId", "variables"]
            }
        },
        {
            "name": "set_node_script",
            "description": "Set the pre/post-request script inherited by every request under a collection/folder. nodeId=null (or omitted) = collection root; a folder id = that folder. `script` may be the full { req, res } object or just one of them — e.g. { \"req\": \"...\" } alone updates only the pre-request script and leaves the existing post-response script (res) untouched. A request's own script is set via update_request's patch.script instead.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "collectionId": { "type": "string" },
                    "nodeId": nullableString(),
                    "script": {
                        "type": "object",
                        "properties": { "req": { "type": "string" }, "res": { "type": "string" } }
                    }
                },
                "required": ["collectionId", "script"]
            }
        },
        {
            "name": "set_node_auth",
            "description": "Set the auth inherited by requests with auth.type=\"inherit\" under a collection/folder. nodeId=null (or omitted) = collection root; a folder id = that folder. `auth` may be the full Auth object or just the fields you're changing (including a nested partial apiKey/oauth2) — merges onto the node's existing auth rather than replacing it outright. A request's own auth is set via update_request's patch.auth instead.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "nodeId": nullableString(), "auth": { "type": "object" } },
                "required": ["collectionId", "auth"]
            }
        },
        {
            "name": "set_node_headers",
            "description": "Set the headers added to every request under a collection/folder (a request's own header of the same name overrides it). nodeId=null (or omitted) = collection root; a folder id = that folder. A request's own headers are set via update_request's patch.headers instead.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "nodeId": nullableString(), "headers": kvArraySchema() },
                "required": ["collectionId", "headers"]
            }
        },
        {
            "name": "list_environments",
            "description": "List every environment (global and collection-scoped) with id, name, and owning collectionId (null = global).",
            "inputSchema": { "type": "object", "properties": {} }
        },
        {
            "name": "get_environment",
            "description": "Get one environment by id, including its variables (values are returned as stored — a variable marked secret is not masked here, unlike the UI's quick-view).",
            "inputSchema": { "type": "object", "properties": { "environmentId": { "type": "string" } }, "required": ["environmentId"] }
        },
        {
            "name": "update_environment",
            "description": "Patch an environment. `patch` is a partial Environment object — { \"variables\": [...] } replaces the ENTIRE variables array (pass every row you want kept, not just changed ones), { \"name\": ... } renames it, { \"collectionId\": ... } moves it between global (null) and a collection's scope. To add/edit/remove one or a few variables without resending the rest, use set_environment_variable / delete_environment_variable instead.",
            "inputSchema": {
                "type": "object",
                "properties": { "environmentId": { "type": "string" }, "patch": { "type": "object" } },
                "required": ["environmentId", "patch"]
            }
        },
        {
            "name": "set_environment_variable",
            "description": "Add or update ONE variable in an environment by key, leaving every other variable untouched — cheaper and safer than update_environment when only a few variables need to change. Creates the variable (enabled by default) if no row with that key exists yet; otherwise patches only the fields you pass (value/enabled/secret). Returns the resulting variable row.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "environmentId": { "type": "string" },
                    "key": { "type": "string" },
                    "value": { "type": "string" },
                    "enabled": { "type": "boolean" },
                    "secret": { "type": "boolean", "description": "Masks the value in the editor and excludes it from generated code/cURL export/history, like the Vault." }
                },
                "required": ["environmentId", "key"]
            }
        },
        {
            "name": "delete_environment_variable",
            "description": "Remove one variable from an environment by key, leaving every other variable untouched. No-op (deleted:false) if the key isn't present.",
            "inputSchema": {
                "type": "object",
                "properties": { "environmentId": { "type": "string" }, "key": { "type": "string" } },
                "required": ["environmentId", "key"]
            }
        },
        {
            "name": "set_active_environment",
            "description": "Activate an environment. scope=\"global\" sets the active Global env; scope=\"collection\" (default) sets it for one collection (pass collectionId). environmentId=null clears it (\"No Environment\").",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "scope": { "type": "string", "enum": ["global", "collection"], "default": "collection" },
                    "collectionId": { "type": "string" },
                    "environmentId": nullableString()
                },
                "required": ["environmentId"]
            }
        },
        {
            "name": "add_environment",
            "description": "Create a new environment and return its id. Omit collectionId for a global environment (available everywhere); pass one to scope it to that collection (Bruno-style — only available while working inside that collection). A collection can have any number of scoped environments (e.g. \"Local\"/\"Staging\"/\"Prod\"), same as the global list.",
            "inputSchema": {
                "type": "object",
                "properties": { "collectionId": { "type": "string" }, "name": { "type": "string" }, "variables": kvArraySchema() }
            }
        },
        {
            "name": "duplicate_environment",
            "description": "Clone an environment (same scope, \"<name> copy\", fresh ids for every variable row) and return the new id.",
            "inputSchema": { "type": "object", "properties": { "environmentId": { "type": "string" } }, "required": ["environmentId"] }
        },
        {
            "name": "delete_environment",
            "description": "Delete an environment by id. Clears it from wherever it was the active choice.",
            "inputSchema": { "type": "object", "properties": { "environmentId": { "type": "string" } }, "required": ["environmentId"] }
        },
        {
            "name": "import_environment",
            "description": "Create an environment with a name, scope, and full variable set in one call (e.g. importing one from another tool). Returns the new id.",
            "inputSchema": {
                "type": "object",
                "properties": { "name": { "type": "string" }, "collectionId": nullableString(), "variables": kvArraySchema() },
                "required": ["name"]
            }
        },

];
