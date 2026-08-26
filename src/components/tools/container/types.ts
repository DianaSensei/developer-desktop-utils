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

// Curated projection of `inspect_container` — see ContainerDetails in
// container_tool.rs for why this isn't the raw bollard ContainerInspectResponse
// shape (dozens of fields, most never worth showing in the UI).
export interface ContainerMountInfo {
  type?: string;
  name?: string;
  source?: string;
  destination?: string;
  mode?: string;
  rw?: boolean;
}

export interface ContainerPortBinding {
  containerPort: string;
  hostIp?: string;
  hostPort?: string;
}

export interface ContainerNetworkInfo {
  name: string;
  ipAddress?: string;
  gateway?: string;
  macAddress?: string;
}

// The cgroup limits `docker update` can change on a live container. `null`
// means "unlimited / daemon default" — the backend normalises the daemon's
// `0`-for-unset to null so the editor can tell the two apart.
export interface ContainerResources {
  nanoCpus?: number | null;
  cpuShares?: number | null;
  cpuPeriod?: number | null;
  cpuQuota?: number | null;
  cpusetCpus?: string | null;
  memoryBytes?: number | null;
  memoryReservationBytes?: number | null;
  memorySwapBytes?: number | null;
  blkioWeight?: number | null;
  pidsLimit?: number | null;
  restartPolicy?: string | null;
  restartMaxRetry?: number | null;
}

/** Only the fields present are sent to the daemon, which merges them into the
 *  container's existing HostConfig — so a bulk edit of one limit leaves every
 *  other limit on those containers alone. */
export type ContainerResourceUpdate = Partial<Record<keyof ContainerResources, number | string | null>>;

export interface ContainerDetails {
  id: string;
  name: string;
  image: string;
  platform?: string;
  created?: string;
  status?: string;
  running: boolean;
  paused: boolean;
  restarting: boolean;
  exitCode?: number;
  startedAt?: string;
  finishedAt?: string;
  healthStatus?: string;
  command?: string;
  entrypoint: string[];
  restartPolicy?: string;
  restartMaxRetry?: number;
  env: string[];
  labels: Record<string, string>;
  mounts: ContainerMountInfo[];
  ports: ContainerPortBinding[];
  networks: ContainerNetworkInfo[];
  resources: ContainerResources;
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

// Curated projection of `inspect_image` — see ImageDetails in container_tool.rs
// for why this isn't the raw bollard ImageInspect shape.
export interface ImageDetails {
  id: string;
  repoTags: string[];
  repoDigests: string[];
  created?: string;
  size: number;
  architecture?: string;
  os?: string;
  author?: string;
  cmd: string[];
  entrypoint: string[];
  env: string[];
  workingDir?: string;
  exposedPorts: string[];
  labels: Record<string, string>;
  layerCount: number;
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

export interface DiskUsageSummary {
  ActiveCount?: number;
  TotalCount?: number;
  Reclaimable?: number;
  TotalSize?: number;
}

// Matches bollard's `SystemDataUsageResponse` in this bollard version:
// aggregate counters per resource type only — no per-item lists (the raw
// Docker Engine API response does include those, but this bollard version's
// typed model drops them on deserialize). See volume_sizes in
// container_tool.rs for how per-volume size is obtained instead.
export interface SystemDataUsageResponse {
  ImageUsage?: DiskUsageSummary;
  ContainerUsage?: DiskUsageSummary;
  VolumeUsage?: DiskUsageSummary;
  BuildCacheUsage?: DiskUsageSummary;
}

// ── Compose ─────────────────────────────────────────────────────────────

// Compose projects are not a first-class bollard/Docker Engine API concept —
// there is no daemon-side "project" object. What exists is a handful of
// well-known labels docker compose stamps on every container it creates
// (com.docker.compose.project, .service, .project.working_dir,
// .project.config_files). Grouping ContainerSummary rows by those labels
// gives project/service structure using only data container_list already
// returns — the same read-only technique GUI tools like OrbStack use for
// their compose grouping. There is deliberately no up/down/build here: that
// requires the compose spec's client-side orchestration logic, which has no
// Docker Engine API equivalent (see ComposeView.tsx for the full rationale).
export const COMPOSE_LABELS = {
  project: 'com.docker.compose.project',
  service: 'com.docker.compose.service',
  workingDir: 'com.docker.compose.project.working_dir',
  configFiles: 'com.docker.compose.project.config_files',
} as const;

export interface ComposeProjectGroup {
  name: string;
  workingDir: string | null;
  configFiles: string | null;
  containers: ContainerSummary[];
}

export function groupByComposeProject(containers: ContainerSummary[]): ComposeProjectGroup[] {
  const groups = new Map<string, ComposeProjectGroup>();
  for (const c of containers) {
    const project = c.Labels?.[COMPOSE_LABELS.project];
    if (!project) continue;
    let group = groups.get(project);
    if (!group) {
      group = {
        name: project,
        workingDir: c.Labels?.[COMPOSE_LABELS.workingDir] ?? null,
        configFiles: c.Labels?.[COMPOSE_LABELS.configFiles] ?? null,
        containers: [],
      };
      groups.set(project, group);
    }
    group.containers.push(c);
  }
  return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
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
  details: (config: ContainerConnection, containerId: string) =>
    invoke<ContainerDetails>('container_details', { config, containerId }),

  /** `since`/`until` are Unix seconds; pass 0 for "no bound" on either. */
  logsStart: (config: ContainerConnection, containerId: string, tail: string, since: number, until: number, onLog: Channel<LogLine>) =>
    invoke<string>('container_logs_start', { config, containerId, tail, since, until, onLog }),
  logsStop: (streamId: string) => invoke<void>('container_logs_stop', { streamId }),

  statsStart: (config: ContainerConnection, containerId: string, onStat: Channel<StatsFrame>) =>
    invoke<string>('container_stats_start', { config, containerId, onStat }),
  /** Streams share one registry on the Rust side, so the log-stream stopper
   *  cancels a stats stream just the same. */
  statsStop: (streamId: string) => invoke<void>('container_logs_stop', { streamId }),
  /** One sample per container for the table's live usage columns — cheaper
   *  than one open stats stream per row. Containers that fail are omitted. */
  statsSnapshot: (config: ContainerConnection, containerIds: string[]) =>
    invoke<Record<string, StatsFrame>>('container_stats_snapshot', { config, containerIds }),

  resources: (config: ContainerConnection, containerId: string) =>
    invoke<ContainerResources>('container_resources', { config, containerId }),
  updateResources: (config: ContainerConnection, containerId: string, resources: ContainerResourceUpdate) =>
    invoke<void>('container_update_resources', { config, containerId, resources }),

  imageList: (config: ContainerConnection) => invoke<ImageSummary[]>('image_list', { config }),
  imageInspect: (config: ContainerConnection, imageId: string) => invoke<unknown>('image_inspect', { config, imageId }),
  imageDetails: (config: ContainerConnection, imageId: string) => invoke<ImageDetails>('image_details', { config, imageId }),
  imageRemove: (config: ContainerConnection, imageId: string, force: boolean) =>
    invoke<void>('image_remove', { config, imageId, force }),
  imagePull: (config: ContainerConnection, image: string, tag: string, onProgress: Channel<PullProgress>) =>
    invoke<void>('image_pull', { config, image, tag, onProgress }),

  volumeList: (config: ContainerConnection) => invoke<VolumeInfo[]>('volume_list', { config }),
  volumeRemove: (config: ContainerConnection, name: string, force: boolean) =>
    invoke<void>('volume_remove', { config, name, force }),
  volumeCreate: (config: ContainerConnection, name: string) =>
    invoke<VolumeInfo>('volume_create', { config, name }),
  /** Per-volume disk usage in bytes, keyed by name — `{}` on Windows (named
   *  pipe transport isn't wired up for this raw request, see backend). */
  volumeSizes: (config: ContainerConnection) => invoke<Record<string, number>>('volume_sizes', { config }),

  networkList: (config: ContainerConnection) => invoke<NetworkInfo[]>('network_list', { config }),
  networkRemove: (config: ContainerConnection, name: string) => invoke<void>('network_remove', { config, name }),
  networkCreate: (config: ContainerConnection, name: string, driver: string) =>
    invoke<void>('network_create', { config, name, driver }),

  systemInfo: (config: ContainerConnection) => invoke<SystemInfo>('container_system_info', { config }),
  systemDf: (config: ContainerConnection) => invoke<SystemDataUsageResponse>('container_system_df', { config }),
};
