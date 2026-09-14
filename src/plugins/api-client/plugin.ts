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
  // '*' là đúng bản chất ở đây chứ không phải sự lười: một HTTP workbench tồn
  // tại để gọi tới URL người dùng gõ vào. Khai tường minh để nó là một dòng
  // nhìn thấy được, không phải mặc định ngầm.
  hosts: ['*'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/apiclient/ApiClient').then((m) => m.ApiClient),
});
