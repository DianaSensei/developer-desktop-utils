import { invoke, Channel } from '@tauri-apps/api/core';

// ── Connection profile ──────────────────────────────────────────────────────

export interface ContainerConnection {
  id: string;
  name: string;
  socketPath: string;
}

export const EMPTY_CONNECTION: ContainerConnection = {
  id: '',
  name: '',
  socketPath: '',
};

export interface DetectedSocket {
  label: string;
  socketPath: string;
}

// ── Containers (raw Docker Engine API shapes — PascalCase, matches bollard/
// Docker's own JSON so no field-name mapping layer is needed) ──────────────

export interface ContainerPort {
  IP?: string;
  PrivatePort: number;
  PublicPort?: number;
  Type: string;
}

export interface ContainerSummary {
  Id: string;
  Names?: string[];
  Image?: string;
  ImageID?: string;
  Command?: string;
  Created?: number;
  State?: string;
  Status?: string;
  Ports?: ContainerPort[];
  Labels?: Record<string, string>;
}

export interface LogLine {
  stream: string;
  message: string;
}

export interface StatsFrame {
  cpuPercent: number;
  memUsageBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
}

// ── Images ──────────────────────────────────────────────────────────────

export interface ImageSummary {
  Id: string;
  RepoTags?: string[];
  Created?: number;
  Size?: number;
}

export interface PullProgress {
  status: string;
  id?: string | null;
  progressCurrent?: number | null;
  progressTotal?: number | null;
}

// ── Volumes / Networks ─────────────────────────────────────────────────────

export interface VolumeInfo {
  Name: string;
  Driver: string;
  Mountpoint: string;
  CreatedAt?: string;
}

export interface NetworkInfo {
  Id: string;
  Name: string;
  Driver?: string;
  Scope?: string;
}

// ── System overview ─────────────────────────────────────────────────────

export interface SystemInfo {
  ID?: string;
  Containers?: number;
  ContainersRunning?: number;
  ContainersPaused?: number;
  ContainersStopped?: number;
  Images?: number;
  ServerVersion?: string;
  OperatingSystem?: string;
  Architecture?: string;
  NCPU?: number;
  MemTotal?: number;
  Name?: string;
}

export interface SystemDataUsageResponse {
  LayersSize?: number;
  Images?: ImageSummary[];
  Containers?: ContainerSummary[];
  Volumes?: VolumeInfo[];
}

// ── Compose ─────────────────────────────────────────────────────────────

export interface ComposeProject {
  id: string;
  name: string;
  connectionId: string;
  composeFiles: string[];
  workingDir: string;
}

export const EMPTY_COMPOSE_PROJECT: ComposeProject = {
  id: '',
  name: '',
  connectionId: '',
  composeFiles: [],
  workingDir: '',
};

export interface ComposeProjectStatus {
  Name: string;
  Status: string;
  ConfigFiles: string;
}

export interface ComposeServiceStatus {
  ID: string;
  Name: string;
  Service: string;
  State: string;
  Health: string;
  Publishers: unknown;
}

// ── Invoke wrappers ─────────────────────────────────────────────────────────

export const containerApi = {
  listConfigs: () => invoke<ContainerConnection[]>('container_list_configs'),
  saveConfig: (config: ContainerConnection) => invoke<ContainerConnection>('container_save_config', { config }),
  deleteConfig: (configId: string) => invoke<void>('container_delete_config', { configId }),
  detectSockets: () => invoke<DetectedSocket[]>('container_detect_sockets'),
  testConnection: (config: ContainerConnection) => invoke<void>('container_test_connection', { config }),

  list: (config: ContainerConnection, all: boolean) =>
    invoke<ContainerSummary[]>('container_list', { config, all }),
  inspect: (config: ContainerConnection, containerId: string) =>
    invoke<unknown>('container_inspect', { config, containerId }),
  start: (config: ContainerConnection, containerId: string) =>
    invoke<void>('container_start', { config, containerId }),
  stop: (config: ContainerConnection, containerId: string) =>
    invoke<void>('container_stop', { config, containerId }),
  restart: (config: ContainerConnection, containerId: string) =>
    invoke<void>('container_restart', { config, containerId }),
  pause: (config: ContainerConnection, containerId: string) =>
    invoke<void>('container_pause', { config, containerId }),
  unpause: (config: ContainerConnection, containerId: string) =>
    invoke<void>('container_unpause', { config, containerId }),
  remove: (config: ContainerConnection, containerId: string, force: boolean) =>
    invoke<void>('container_remove', { config, containerId, force }),

  logsStart: (config: ContainerConnection, containerId: string, tail: string, onLog: Channel<LogLine>) =>
    invoke<string>('container_logs_start', { config, containerId, tail, onLog }),
  logsStop: (streamId: string) => invoke<void>('container_logs_stop', { streamId }),

  statsStart: (config: ContainerConnection, containerId: string, onStat: Channel<StatsFrame>) =>
    invoke<string>('container_stats_start', { config, containerId, onStat }),

  imageList: (config: ContainerConnection) => invoke<ImageSummary[]>('image_list', { config }),
  imageInspect: (config: ContainerConnection, imageId: string) => invoke<unknown>('image_inspect', { config, imageId }),
  imageRemove: (config: ContainerConnection, imageId: string, force: boolean) =>
    invoke<void>('image_remove', { config, imageId, force }),
  imagePull: (config: ContainerConnection, image: string, tag: string, onProgress: Channel<PullProgress>) =>
    invoke<void>('image_pull', { config, image, tag, onProgress }),

  volumeList: (config: ContainerConnection) => invoke<VolumeInfo[]>('volume_list', { config }),
  volumeRemove: (config: ContainerConnection, name: string, force: boolean) =>
    invoke<void>('volume_remove', { config, name, force }),
  volumeCreate: (config: ContainerConnection, name: string) =>
    invoke<VolumeInfo>('volume_create', { config, name }),

  networkList: (config: ContainerConnection) => invoke<NetworkInfo[]>('network_list', { config }),
  networkRemove: (config: ContainerConnection, name: string) => invoke<void>('network_remove', { config, name }),
  networkCreate: (config: ContainerConnection, name: string, driver: string) =>
    invoke<void>('network_create', { config, name, driver }),

  systemInfo: (config: ContainerConnection) => invoke<SystemInfo>('container_system_info', { config }),
  systemDf: (config: ContainerConnection) => invoke<SystemDataUsageResponse>('container_system_df', { config }),
};

export const composeApi = {
  listKnown: () => invoke<ComposeProject[]>('compose_list_known'),
  addProject: (project: ComposeProject) => invoke<ComposeProject>('compose_add_project', { project }),
  removeProject: (projectId: string) => invoke<void>('compose_remove_project', { projectId }),

  listProjects: (connection: ContainerConnection) =>
    invoke<ComposeProjectStatus[]>('compose_list_projects', { connection }),
  ps: (connection: ContainerConnection, composeFiles: string[], workingDir: string) =>
    invoke<ComposeServiceStatus[]>('compose_ps', { connection, composeFiles, workingDir }),
  up: (connection: ContainerConnection, composeFiles: string[], workingDir: string) =>
    invoke<string>('compose_up', { connection, composeFiles, workingDir }),
  down: (connection: ContainerConnection, composeFiles: string[], workingDir: string, removeVolumes: boolean) =>
    invoke<string>('compose_down', { connection, composeFiles, workingDir, removeVolumes }),
  restart: (connection: ContainerConnection, composeFiles: string[], workingDir: string, service: string | null) =>
    invoke<string>('compose_restart', { connection, composeFiles, workingDir, service }),
  stop: (connection: ContainerConnection, composeFiles: string[], workingDir: string, service: string | null) =>
    invoke<string>('compose_stop', { connection, composeFiles, workingDir, service }),
  pull: (connection: ContainerConnection, composeFiles: string[], workingDir: string) =>
    invoke<string>('compose_pull', { connection, composeFiles, workingDir }),
  config: (connection: ContainerConnection, composeFiles: string[], workingDir: string) =>
    invoke<unknown>('compose_config', { connection, composeFiles, workingDir }),

  logsStart: (
    connection: ContainerConnection,
    composeFiles: string[],
    workingDir: string,
    service: string | null,
    onLog: Channel<LogLine>,
  ) => invoke<string>('compose_logs_start', { connection, composeFiles, workingDir, service, onLog }),
  logsStop: (streamId: string) => invoke<void>('compose_logs_stop', { streamId }),
};
