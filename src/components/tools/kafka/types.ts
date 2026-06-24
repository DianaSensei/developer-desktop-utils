import { invoke } from '@tauri-apps/api/core';

export interface BrokerConfig {
  id: string;
  name: string;
  bootstrapServers: string;
  saslMechanism?: string;
  saslUsername?: string;
  saslPassword?: string;
  sslEnabled: boolean;
}

export interface TopicSummary {
  name: string;
  partitionCount: number;
  replicationFactor: number;
}

export interface PartitionInfo {
  id: number;
  leader: number;
  earliestOffset: number;
  latestOffset: number;
}

export interface GroupLag {
  groupId: string;
  partition: number;
  committedOffset: number;
  lag: number;
}

export interface TopicDetails {
  name: string;
  partitions: PartitionInfo[];
  replicationFactor: number;
}

export interface TopicConfig {
  name: string;
  value: string | null;
}

export interface GroupSummary {
  groupId: string;
  state: string;
  protocolType: string;
}

export interface Assignment {
  topic: string;
  partition: number;
  committedOffset: number;
  lag: number;
}

export interface GroupMember {
  memberId: string;
  clientId: string;
  clientHost: string;
}

export interface GroupDetails {
  groupId: string;
  state: string;
  memberCount: number;
  members: GroupMember[];
  assignments: Assignment[];
}

export interface BatchRecord {
  key: string | null;
  value: string;
  headers?: Record<string, string>;
}

export interface ProduceResult {
  partition: number;
  offset: number;
}

export interface KafkaMessage {
  offset: number;
  partition: number;
  timestamp: string;
  key: string | null;
  value: string | null;
  headers: Record<string, string>;
}

// ── Invoke wrappers ───────────────────────────────────────────────────────────

export const kafkaApi = {
  listConfigs: () =>
    invoke<BrokerConfig[]>('kafka_list_configs'),

  saveConfig: (config: BrokerConfig) =>
    invoke<BrokerConfig>('kafka_save_config', { config }),

  deleteConfig: (configId: string) =>
    invoke<void>('kafka_delete_config', { configId }),

  testConnection: (configId: string) =>
    invoke<void>('kafka_test_connection', { configId }),

  listTopics: (configId: string) =>
    invoke<TopicSummary[]>('kafka_list_topics', { configId }),

  topicDetails: (configId: string, topic: string) =>
    invoke<TopicDetails>('kafka_topic_details', { configId, topic }),

  // On-demand only (Consumers tab) — scans groups, so never call on topic open.
  topicConsumerGroups: (configId: string, topic: string) =>
    invoke<GroupLag[]>('kafka_topic_consumer_groups', { configId, topic }),

  createTopic: (configId: string, name: string, numPartitions: number, replicationFactor: number) =>
    invoke<void>('kafka_create_topic', { configId, name, numPartitions, replicationFactor }),

  listGroups: (configId: string) =>
    invoke<GroupSummary[]>('kafka_list_groups', { configId }),

  groupDetails: (configId: string, groupId: string) =>
    invoke<GroupDetails>('kafka_group_details', { configId, groupId }),

  produce: (configId: string, topic: string, partition: number | null, key: string | null, value: string, headers: Record<string, string>) =>
    invoke<ProduceResult>('kafka_produce', { configId, topic, partition, key, value, headers }),

  produceBatch: (configId: string, topic: string, partition: number | null, records: BatchRecord[]) =>
    invoke<number[]>('kafka_produce_batch', { configId, topic, partition, records }),

  fetchMessages: (configId: string, topic: string, partition: number, offset: number, limit: number, startTimestamp?: number | null) =>
    invoke<KafkaMessage[]>('kafka_fetch_messages', { configId, topic, partition, offset, limit, startTimestamp: startTimestamp ?? null }),

  deleteTopic: (configId: string, name: string) =>
    invoke<void>('kafka_delete_topic', { configId, name }),

  topicConfigs: (configId: string, topic: string) =>
    invoke<TopicConfig[]>('kafka_topic_configs', { configId, topic }),
};
