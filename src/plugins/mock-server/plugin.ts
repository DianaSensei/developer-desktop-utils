import { ServerCog } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'mock-server',
  label: "Mock Server",
  icon: ServerCog,
  description:
    "Run a local HTTP mock server: match requests by method, path, query, header, and body, then reply with templated or Rhai-scripted responses. Live request log.",
  keywords: ["mock", "stub", "fake api", "http server", "endpoint", "rhai", "response", "wiremock"],
  route: '/mock-server',
  order: 30,
  defaultEnabled: true,
  permissions: ['storage', 'clipboard:read', 'clipboard:write', 'native'],
  commands: ['mcp_', 'mock_'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/mockserver/MockServer').then((m) => m.MockServer),
});
