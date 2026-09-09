import { usePersistentState } from './usePersistentState';

/**
 * Per-tool MCP kill switch (Settings → MCP, and the MCP setup dialog) —
 * independent of, and layered UNDER, the Background MCP bridge toggle
 * (useMcpBackgroundBridge): a tool switched off here never answers any of
 * its MCP tool calls, whether on screen or in the background. Off is the
 * exception, not the rule — missing/absent from the persisted map means
 * enabled, so this doesn't change behavior for anyone who hasn't touched it.
 *
 * Keyed by the same tool ids TOOL_DEFS/FeatureContext already use
 * ('api-client', 'mock-server', 'redis-client', 'kafka-explorer') so a
 * label only has to be looked up once, from TOOL_DEFS, rather than
 * duplicated here.
 */
export type McpToolId = 'api-client' | 'mock-server' | 'redis-client' | 'kafka-explorer';

export const MCP_TOOL_IDS: McpToolId[] = ['api-client', 'mock-server', 'redis-client', 'kafka-explorer'];

const KEY = 'devtool-mcp-tool-enabled';

type EnabledMap = Partial<Record<McpToolId, boolean>>;

export function useMcpToolEnabledMap() {
  const [map, setMap] = usePersistentState<EnabledMap>(KEY, {});

  const isEnabled = (id: McpToolId) => map[id] !== false;
  const setToolEnabled = (id: McpToolId, enabled: boolean) =>
    setMap((prev) => ({ ...prev, [id]: enabled }));

  return { map, isEnabled, setToolEnabled };
}

/** Convenience wrapper for a single tool's own component. */
export function useMcpToolEnabled(id: McpToolId) {
  const { isEnabled, setToolEnabled } = useMcpToolEnabledMap();
  return { enabled: isEnabled(id), setEnabled: (v: boolean) => setToolEnabled(id, v) };
}
