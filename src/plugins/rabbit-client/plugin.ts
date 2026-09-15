import { Rabbit } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'rabbit-client',
  label: "RabbitMQ",
  icon: Rabbit,
  description:
    "RabbitMQ management client: browse queues and exchanges, peek and publish messages, view bindings, connections, and cluster overview.",
  keywords: ["rabbitmq", "rabbit", "amqp", "queue", "exchange", "message broker", "management", "vhost", "binding", "publish", "consume", "broker"],
  route: '/rabbit-client',
  order: 170,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write', 'native', 'http', 'service'],
  // `native` chỉ còn cho `mcp_respond`/`mcp:call` (cầu nối MCP, xem mcpBridge.ts) —
  // mọi lệnh RabbitMQ thật đi qua `service` (sidecar `devtool-svc-rabbit`).
  commands: ['mcp_respond'],
  service: {
    bin: 'devtool-svc-rabbit',
    methods: [
      'list-configs',
      'save-config',
      'delete-config',
      'amqp-test',
      'rpc-call',
      'publish',
      'consume-start',
      'consume-stop',
      'amqp-queues-info',
      'amqp-exchanges-info',
      'amqp-declare-queue',
      'amqp-declare-exchange',
      'amqp-bind-queue',
    ],
  },
  // Host management API do người dùng cấu hình lúc chạy, không biết trước.
  hosts: ['*'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/rabbit/RabbitClient').then((m) => m.RabbitClient),
});
