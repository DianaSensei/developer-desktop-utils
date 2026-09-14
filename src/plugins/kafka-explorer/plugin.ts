import { Server } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'kafka-explorer',
  label: "Kafka Explorer",
  icon: Server,
  description:
    "Browse topics, inspect partitions and offsets, manage consumer groups, and produce messages.",
  keywords: ["kafka", "topic", "partition", "offset", "consumer group", "producer", "message", "broker", "stream"],
  route: '/kafka-explorer',
  order: 160,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write', 'native'],
  commands: ['kafka_', 'mcp_respond'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/kafka/KafkaExplorer').then((m) => m.KafkaExplorer),
});
