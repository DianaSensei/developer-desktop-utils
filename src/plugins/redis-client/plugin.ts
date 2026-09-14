import { MemoryStick } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'redis-client',
  label: "Redis",
  icon: MemoryStick,
  description:
    "Redis client: browse and edit keys (string, hash, list, set, sorted set), inspect server info, and run raw commands from a CLI console.",
  keywords: ["redis", "cache", "key-value", "kv", "hash", "sorted set", "zset", "ttl", "expire", "scan", "cli", "in-memory"],
  route: '/redis-client',
  order: 180,
  defaultEnabled: false,
  permissions: ['storage', 'clipboard:read', 'clipboard:write', 'native'],
  commands: ['mcp_respond', 'redis_'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/redis/RedisClient').then((m) => m.RedisClient),
});
