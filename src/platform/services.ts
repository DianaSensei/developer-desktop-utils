import { useEffect } from 'react';
import { useAppConfig } from '@/contexts/AppConfigContext';
import { liveConnections } from '@/lib/liveConnections';
import { useMcpBackgroundBridge } from '@/hooks/useMcpBackgroundBridge';
import { MCP_TOOL_IDS, useMcpToolEnabled, type McpToolId } from '@/hooks/useMcpToolEnabled';
import type { AppConfig } from '@/config/appConfig';
import type { PluginSdk } from './sdk';

/**
 * Platform services that are React hooks. They cannot live on the `sdk`
 * object, but are exported from '@/platform' like the rest of the platform.
 */

/**
 * App tuning values (editor debounce, generator limits...). Read-only:
 * users change them in Settings.
 */
export function usePluginConfig(): AppConfig {
  return useAppConfig().config;
}

/**
 * Marks the plugin as having a live connection (sidebar dot). The id comes
 * from the SDK, so it cannot drift from the manifest.
 *
 * Not cleared on unmount: connections live in Rust and persist when the
 * user switches tools.
 */
export function useLiveConnection(sdk: PluginSdk, connected: boolean): void {
  useEffect(() => {
    liveConnections.set(sdk.id, connected);
  }, [sdk.id, connected]);
}

/**
 * Whether this component should mount its own MCP bridge: the tool is an
 * MCP tool, its switch is on, and the background bridge is off (which
 * already mounts every bridge app-wide).
 */
export function usePluginMcpBridgeActive(sdk: PluginSdk): boolean {
  const { enabled: backgroundEnabled } = useMcpBackgroundBridge();
  const { enabled: toolEnabled } = useMcpToolEnabled(sdk.id as McpToolId);
  const isMcpTool = MCP_TOOL_IDS.includes(sdk.id as McpToolId);
  return isMcpTool && toolEnabled && !backgroundEnabled;
}
