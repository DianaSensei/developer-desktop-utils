// Keeps every tool's MCP bridge answering `mcp:call` events while that tool
// isn't on screen — opt-in via Settings → MCP (`useMcpBackgroundBridge`,
// off by default per the "no silent network calls" rule). Mounted once at
// the app root (App.tsx), inside every runtime provider so it shares the
// exact same store/state instances the tool components read when they're
// open — see apiclient/mcpRuntimeContext.tsx, mockserver/mcpRuntimeContext.tsx,
// redis/mcpRuntimeContext.tsx, kafka/mcpRuntimeContext.tsx, and
// rabbit/mcpRuntimeContext.tsx for why that sharing matters.
//
// Renders nothing; it exists purely to hold the `useMcpBridge` calls. When
// the background setting is off, all of them are still called (rules of
// hooks) but with `enabled=false`, so none registers a Tauri listener. Each
// call is additionally gated by that tool's own per-tool MCP toggle
// (useMcpToolEnabled, Settings → MCP) — a tool switched off there never
// answers here either, background bridge or not.

import { useMcpBridge as useApiClientMcpBridge } from './tools/apiclient/mcpBridge';
import { useApiClientRuntime } from './tools/apiclient/mcpRuntimeContext';
import { useMcpBridge as useMockServerMcpBridge } from './tools/mockserver/mcpBridge';
import { useMockServerRuntime } from './tools/mockserver/mcpRuntimeContext';
import { useMcpBridge as useRedisMcpBridge } from './tools/redis/mcpBridge';
import { useRedisRuntime } from './tools/redis/mcpRuntimeContext';
import { useMcpBridge as useKafkaMcpBridge } from './tools/kafka/mcpBridge';
import { useKafkaRuntime } from './tools/kafka/mcpRuntimeContext';
import { useMcpBridge as useRabbitMcpBridge } from './tools/rabbit/mcpBridge';
import { useRabbitRuntime } from './tools/rabbit/mcpRuntimeContext';
import { useMcpBackgroundBridge } from '@/hooks/useMcpBackgroundBridge';
import { useMcpToolEnabledMap } from '@/hooks/useMcpToolEnabled';

export function McpBackgroundBridge() {
  const { enabled } = useMcpBackgroundBridge();
  const { isEnabled } = useMcpToolEnabledMap();
  const { store, runRequest } = useApiClientRuntime();
  const mockServer = useMockServerRuntime();
  const redisState = useRedisRuntime();
  const kafkaState = useKafkaRuntime();
  const rabbitState = useRabbitRuntime();

  useApiClientMcpBridge(store, runRequest, enabled && isEnabled('api-client'));
  useMockServerMcpBridge(mockServer, enabled && isEnabled('mock-server'));
  useRedisMcpBridge(redisState, enabled && isEnabled('redis-client'));
  useKafkaMcpBridge(kafkaState, enabled && isEnabled('kafka-explorer'));
  useRabbitMcpBridge(rabbitState, enabled && isEnabled('rabbit-client'));

  return null;
}
