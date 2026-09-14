import { Send } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'api-client',
  label: "API Client",
  icon: Send,
  description:
    "Postman/Bruno-style HTTP workbench: collections, environments with {{vars}}, auth, pre/post-request scripts, tests & assertions, and Postman / OpenAPI import.",
  keywords: ["http", "rest", "api", "request", "postman", "bruno", "insomnia", "curl", "endpoint", "get", "post", "fetch", "client", "openapi", "swagger"],
  route: '/api-client',
  order: 20,
  defaultEnabled: true,
  permissions: ['storage', 'secrets', 'clipboard:read', 'clipboard:write', 'native', 'http'],
  commands: ['mcp_'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/apiclient/ApiClient').then((m) => m.ApiClient),
});
