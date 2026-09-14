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
  permissions: ['storage', 'clipboard:read', 'clipboard:write', 'native', 'http'],
  commands: ['mcp_respond', 'rabbit_'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/rabbit/RabbitClient').then((m) => m.RabbitClient),
});
