import { usePersistentState } from './usePersistentState';

const KEY = 'devtool-mcp-background-bridge';

/**
 * Opt-in setting (Settings → MCP): keep the API Client / Mock Server MCP
 * bridges listening for `mcp:call` events at the app root, regardless of
 * which tool is currently on screen. Off by default — see the "no silent
 * network calls" rule in docs/ai/CLAUDE.md; a user must explicitly turn this
 * on before an MCP client can drive either tool while it isn't visible.
 */
export function useMcpBackgroundBridge() {
  const [enabled, setEnabled] = usePersistentState<boolean>(KEY, false);
  return { enabled, setEnabled };
}
