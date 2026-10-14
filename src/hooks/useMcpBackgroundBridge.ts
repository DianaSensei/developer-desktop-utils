import { useSharedSetting } from './useSharedSetting';

const KEY = 'devtool-mcp-background-bridge';

/**
 * Opt-in setting (Settings → MCP): keep the API Client / Mock Server MCP
 * bridges listening for `mcp:call` events at the app root, regardless of
 * which tool is currently on screen. Off by default — see the "no silent
 * network calls" rule in docs/ai/CLAUDE.md; a user must explicitly turn this
 * on before an MCP client can drive either tool while it isn't visible.
 */
export function useMcpBackgroundBridge() {
  // Shared: the app-root bridge, each tool's bridge, Settings and the MCP
  // management tools must all see a change at once.
  const [enabled, setEnabled] = useSharedSetting<boolean>(KEY, false);
  return { enabled, setEnabled };
}
