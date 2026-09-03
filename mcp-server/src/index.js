#!/usr/bin/env node
// DevTool MCP stdio server.
//
// Runs OUTSIDE the DevTool app — Claude Desktop/Code spawns this process
// directly (stdio transport) per its own MCP config. It never touches
// DevTool's data itself; every tool call is forwarded as an HTTP request to
// the loopback control server DevTool's Tauri backend starts on launch (see
// src-tauri/src/mcp_bridge.rs), which in turn hands it to the running
// webview — so calls run through the exact same API Client store and
// request-sending engine the user's own UI uses. That also means DevTool
// must be OPEN, with the API Client tool on screen, for calls to succeed;
// see README.md in this directory for setup and troubleshooting.

import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// Must match `identifier` in src-tauri/tauri.conf.json — Tauri's app_data_dir
// is keyed off it, and mcp_bridge.rs writes its discovery file there.
const APP_IDENTIFIER = 'com.desktop-devtool-app';

// Tauri v2's app_data_dir() resolution, per platform — see
// https://v2.tauri.app/reference/javascript/api/namespacepath/#appdatadir
function appDataDir() {
  const home = homedir();
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', APP_IDENTIFIER);
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), APP_IDENTIFIER);
    default:
      return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), APP_IDENTIFIER);
  }
}

const DISCOVERY_PATH = join(appDataDir(), 'mcp-bridge.json');

async function readBridgeInfo() {
  let text;
  try {
    text = await readFile(DISCOVERY_PATH, 'utf8');
  } catch {
    throw new Error(
      `DevTool doesn't seem to have started its MCP bridge yet (no file at ${DISCOVERY_PATH}). ` +
        'Open the DevTool app and try again.',
    );
  }
  const parsed = JSON.parse(text);
  if (!parsed.port || !parsed.token) throw new Error('DevTool\'s MCP bridge file is malformed — restart the app.');
  return parsed;
}

// Re-reads the discovery file on every call (cheap) so an app restart (new
// port/token) is picked up without restarting this sidecar.
async function callBridge(tool, args) {
  const { port, token } = await readBridgeInfo();
  let res;
  try {
    res = await fetch(`http://127.0.0.1:${port}/call`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ tool, args }),
    });
  } catch (e) {
    throw new Error(
      `Could not reach DevTool on 127.0.0.1:${port} (${e.message}). Is the app open?`,
    );
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error(`DevTool's MCP bridge returned a non-JSON response (HTTP ${res.status}).`);
  }
  if (!res.ok || json.error) {
    throw new Error(json.error || `DevTool's MCP bridge returned HTTP ${res.status}.`);
  }
  return json.result;
}

function textResult(value) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] };
}

async function callTool(name, args) {
  try {
    return textResult(await callBridge(name, args));
  } catch (e) {
    return { content: [{ type: 'text', text: e.message ?? String(e) }], isError: true };
  }
}

const server = new McpServer({ name: 'devtool-api-client', version: '1.0.0' });

// ─── collections & requests ─────────────────────────────────────────────────

server.registerTool(
  'list_collections',
  {
    description:
      "List every collection open in DevTool's API Client, with their folder/request tree (id, name, method, url — no bodies/scripts/secrets).",
    inputSchema: {},
  },
  () => callTool('list_collections', {}),
);

server.registerTool(
  'get_collection',
  {
    description: 'Get one collection by id, including its own script/auth/headers/variables (not its requests\' bodies — use get_request for those).',
    inputSchema: { collectionId: z.string() },
  },
  (args) => callTool('get_collection', args),
);

server.registerTool(
  'get_request',
  {
    description: 'Get the full definition of one request by id: method, url, params, headers, body, auth, pre/post-request script, tests, assertions, settings.',
    inputSchema: { requestId: z.string() },
  },
  (args) => callTool('get_request', args),
);

server.registerTool(
  'update_request',
  {
    description:
      'Patch a request in place. `patch` is a partial ApiRequest object — only the fields you include are changed (e.g. { "url": "...", "method": "POST", "body": { "mode": "json", "raw": "...", "form": [] } }). Set patch.script = { req, res } to edit its pre/post-request script.',
    inputSchema: { requestId: z.string(), patch: z.record(z.string(), z.any()) },
  },
  (args) => callTool('update_request', args),
);

server.registerTool(
  'create_request',
  {
    description: 'Create a new request in a collection (optionally inside a folder) and return it. `request` is a partial ApiRequest used as the initial values.',
    inputSchema: {
      collectionId: z.string(),
      folderId: z.string().optional(),
      request: z.record(z.string(), z.any()).optional(),
    },
  },
  (args) => callTool('create_request', args),
);

server.registerTool(
  'delete_request',
  {
    description: 'Delete a request by id.',
    inputSchema: { requestId: z.string() },
  },
  (args) => callTool('delete_request', args),
);

server.registerTool(
  'set_node_script',
  {
    description:
      'Set the pre/post-request script inherited by every request under a collection or folder (Bruno-style). Pass nodeId=null (or omit it) for the collection\'s own root script; pass a folder id for that folder\'s script.',
    inputSchema: {
      collectionId: z.string(),
      nodeId: z.string().nullable().optional(),
      script: z.object({ req: z.string(), res: z.string() }),
    },
  },
  (args) => callTool('set_node_script', args),
);

server.registerTool(
  'run_request',
  {
    description:
      'Actually send a request through DevTool (same engine as the Send button): runs its pre-request script, sends it, runs the post-response script, evaluates tests/assertions, and appends it to History. Returns the response, tests, console logs, and any transport/script error. Pass environmentId to force a specific environment ("" / omit for the currently active one, null for "No Environment").',
    inputSchema: { requestId: z.string(), environmentId: z.string().nullable().optional() },
  },
  (args) => callTool('run_request', args),
);

// ─── environments ───────────────────────────────────────────────────────────

server.registerTool(
  'list_environments',
  {
    description: 'List every environment (global and collection-scoped) with id, name, and owning collectionId (null = global).',
    inputSchema: {},
  },
  () => callTool('list_environments', {}),
);

server.registerTool(
  'get_environment',
  {
    description: 'Get one environment by id, including its variables (values are returned as stored — a variable marked secret is not masked here, unlike the UI\'s quick-view).',
    inputSchema: { environmentId: z.string() },
  },
  (args) => callTool('get_environment', args),
);

server.registerTool(
  'update_environment',
  {
    description: 'Patch an environment. `patch` is a partial Environment object, most commonly { "variables": [{ "id": "...", "key": "...", "value": "...", "enabled": true }, ...] } — pass the full variables array you want it to end up with.',
    inputSchema: { environmentId: z.string(), patch: z.record(z.string(), z.any()) },
  },
  (args) => callTool('update_environment', args),
);

server.registerTool(
  'set_active_environment',
  {
    description: 'Activate an environment. scope="global" sets the active Global environment; scope="collection" (default) sets the active environment for one collection — pass collectionId in that case. environmentId=null clears it ("No Environment").',
    inputSchema: {
      scope: z.enum(['global', 'collection']).default('collection'),
      collectionId: z.string().optional(),
      environmentId: z.string().nullable(),
    },
  },
  (args) => callTool('set_active_environment', args),
);

const transport = new StdioServerTransport();
await server.connect(transport);
