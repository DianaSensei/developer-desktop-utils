// MCP bridge — JWT Debugger tool (`jwt`). Decode-only, same limitation as
// the UI (`jwt-decode` cannot verify a signature — there is no signing key
// to check against). Pure function of its argument — no persisted state —
// so, like codecMcpBridge.ts, this is mounted unconditionally at the app
// root (McpUtilityBridge.tsx), gated only by the per-tool MCP toggle.

import { jwtDecode } from 'jwt-decode';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`"${name}" is required and must be a string`);
  return v;
}

export function buildJwtHandlers(): Record<string, ToolHandler> {
  return {
    jwt_decode: async (args) => {
      const token = requireString(args.token, 'token');
      try {
        return {
          header: jwtDecode(token, { header: true }),
          payload: jwtDecode(token, { header: false }),
        };
      } catch (e) {
        throw new Error((e as Error).message || 'Invalid JWT token');
      }
    },
  };
}
