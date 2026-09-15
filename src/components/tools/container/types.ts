import type { PluginSdk } from '@/platform';

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
  // The list endpoint already reports each container's mounts and attached
  // networks. Declaring them here is what lets the Images/Volumes/Networks
  // views answer "is this in use, and by what?" from the container list they
  // can load anyway, instead of inspecting every resource one by one.
  Mounts?: { Type?: string; Name?: string; Source?: string; Destination?: string }[];
  NetworkSettings?: { Networks?: Record<string, { NetworkID?: string; IPAddress?: string }> };
}

export interface LogLine {
  stream: string;
  message: string;
  /** Present only when the stream was started with timestamps on; split off
   *  from the message backend-side so searches never match inside it. */
  timestamp?: string | null;
}

export interface StatsFrame {
  cpuPercent: number;
  memUsageBytes: number;
  memLimitBytes: number;
  netRxBytes: number;
  netTxBytes: number;
}

// Curated projection of `inspect_container` — see ContainerDetails in
// devtool-svc-container.rs for why this isn't the raw bollard ContainerInspectResponse
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

// Curated projection of `inspect_image` — see ImageDetails in devtool-svc-container.rs
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

/** Result of any of the four prune endpoints. Networks free no disk, so
 *  `spaceReclaimed` is always 0 there. */
export interface PruneResult {
  deleted: number;
  spaceReclaimed: number;
}

// ── Volumes / Networks ─────────────────────────────────────────────────────

export interface VolumeInfo {
  Name: string;
  Driver: string;
  Mountpoint: string;
  CreatedAt?: string;
  /** Compose stamps `com.docker.compose.project` on volumes and networks it
   *  creates, the same way it does on containers — that is how the Compose
   *  view's "Down" finds what belongs to a project. */
  Labels?: Record<string, string> | null;
}

export interface NetworkInfo {
  Id: string;
  Name: string;
  Driver?: string;
  Scope?: string;
  Labels?: Record<string, string> | null;
}

// Curated projections of `inspect_network` / `inspect_volume`, same approach
// as ContainerDetails/ImageDetails.
export interface NetworkIpamConfig {
  subnet?: string;
  ipRange?: string;
  gateway?: string;
}

export interface NetworkDetails {
  id: string;
  name: string;
  driver?: string;
  scope?: string;
  created?: string;
  internal: boolean;
  attachable: boolean;
  ingress: boolean;
  ipv6: boolean;
  ipamDriver?: string;
  ipamConfig: NetworkIpamConfig[];
  options: Record<string, string>;
  labels: Record<string, string>;
}

export interface VolumeDetails {
  name: string;
  driver: string;
  mountpoint: string;
  createdAt?: string;
  scope?: string;
  labels: Record<string, string>;
  options: Record<string, string>;
  sizeBytes?: number | null;
  refCount?: number | null;
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
// devtool-svc-container.rs for how per-volume size is obtained instead.
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

/** Trả về từ `logsStart`/`statsStart` — `.stop()` gói cả hai bước bắt buộc:
 *  báo sidecar dừng qua method `*-unsubscribe` (nếu đã nhận được
 *  `subscriptionId`) rồi mới gỡ đăng ký phía host, đúng thứ tự
 *  `pubsubSubscribe` của Redis đã làm. */
export interface ContainerStreamSubscription {
  stop(): Promise<void>;
}

/**
 * Lớp lệnh của tool, dựng theo `sdk.service` (Tier B — sidecar
 * `devtool-svc-container`) thay vì gọi thẳng `invoke`. Nhờ vậy allowlist
 * `service.methods` trong manifest có hiệu lực thật — một method gõ sai hay
 * ngoài danh sách bị chặn ngay và ghi vào nhật ký, thay vì lặng lẽ đi thẳng
 * xuống sidecar.
 *
 * Chữ ký công khai của hầu hết các hàm GIỮ NGUYÊN so với bản `sdk.native`
 * trước đó — vẫn nhận nguyên `config: ContainerConnection`, không phải
 * `configId` — để giảm diff ở mọi call site: bản thân sidecar (khác Tier A)
 * đòi `configId` (nó tra cứu từ file cấu hình RIÊNG của nó, xem
 * `devtool-svc-container.rs::find_config`), nên ở đây chỉ đơn giản gửi
 * `config.id` xuống. `saveConfig`/`testConnection` là hai ngoại lệ đúng: chúng
 * thao tác trên một `ContainerConnection` CHƯA CHẮC đã có `id` (form "Thêm kết
 * nối" trước khi lưu), nên sidecar nhận nguyên object, khớp đúng
 * `handle()`'s `"save-config"`/`"test-connection"`.
 *
 * Dùng qua `useContainerApi()` (xem api_sdk.ts); factory để lộ ra đây chỉ cho
 * test và cho code không phải React.
 */
export function createContainerApi(sdk: PluginSdk) {
  const call = <T,>(method: string, params?: Record<string, unknown>) =>
    sdk.service.call<T>(method, params);

  return {
    listConfigs: () => call<ContainerConnection[]>('list-configs'),
    saveConfig: (config: ContainerConnection) => call<ContainerConnection>('save-config', { config }),
    deleteConfig: (configId: string) => call<void>('delete-config', { configId }),
    detectSockets: () => call<DetectedSocket[]>('detect-sockets'),
    testConnection: (config: ContainerConnection) => call<void>('test-connection', { config }),

    list: (config: ContainerConnection, all: boolean) =>
      call<ContainerSummary[]>('list', { configId: config.id, all }),
    inspect: (config: ContainerConnection, containerId: string) =>
      call<unknown>('inspect', { configId: config.id, containerId }),
    start: (config: ContainerConnection, containerId: string) =>
      call<void>('start', { configId: config.id, containerId }),
    stop: (config: ContainerConnection, containerId: string) =>
      call<void>('stop', { configId: config.id, containerId }),
    restart: (config: ContainerConnection, containerId: string) =>
      call<void>('restart', { configId: config.id, containerId }),
    pause: (config: ContainerConnection, containerId: string) =>
      call<void>('pause', { configId: config.id, containerId }),
    unpause: (config: ContainerConnection, containerId: string) =>
      call<void>('unpause', { configId: config.id, containerId }),
    remove: (config: ContainerConnection, containerId: string, force: boolean) =>
      call<void>('remove', { configId: config.id, containerId, force }),
    details: (config: ContainerConnection, containerId: string) =>
      call<ContainerDetails>('details', { configId: config.id, containerId }),

    /**
     * `since`/`until` are Unix seconds; pass 0 for "no bound" on either.
     * `timestamps` asks the daemon to prefix each line — it can only be
     * chosen when the stream starts, so toggling it restarts the stream.
     *
     * Backed by the sidecar's STREAM method `logs-start` — same shape as
     * Redis's `pubsubSubscribe`: the first event carries
     * `{ type: 'subscribed', subscriptionId }`, every `{ type: 'line', ... }`
     * event is forwarded to `onLine`, and a subscribe-time failure (bad
     * config, container not found) arrives as a THIRD event shape,
     * `{ type: 'error', message }` — never as a protocol-level
     * `ServiceResponse.error` (see `send_stream_error` in
     * devtool-svc-container.rs and the ADR's Tier B section for why). This
     * promise properly WAITS for either `subscribed` or `error` before
     * settling. `.stop()` calls `logs-unsubscribe` first (only if a
     * `subscriptionId` was received), then stops the host-side registration.
     */
    logsStart: (
      config: ContainerConnection, containerId: string, tail: string,
      since: number, until: number, timestamps: boolean, onLine: (line: LogLine) => void,
    ): Promise<ContainerStreamSubscription> =>
      startSubscriptionStream<{ stream?: string; message?: string; timestamp?: string | null }, LogLine>(
        sdk, call, 'logs-start', 'logs-unsubscribe',
        { configId: config.id, containerId, tail, since, until, timestamps },
        (event) => ({ stream: event.stream ?? 'stdout', message: event.message ?? '', timestamp: event.timestamp ?? null }),
        onLine,
      ),

    /** Same STREAM shape as `logsStart`, backed by `stats-start`/`stats-unsubscribe`. */
    statsStart: (
      config: ContainerConnection, containerId: string, onFrame: (frame: StatsFrame) => void,
    ): Promise<ContainerStreamSubscription> =>
      startSubscriptionStream<StatsFrame, StatsFrame>(
        sdk, call, 'stats-start', 'stats-unsubscribe',
        { configId: config.id, containerId },
        (event) => event,
        onFrame,
      ),

    /** One sample per container for the table's live usage columns — cheaper
     *  than one open stats stream per row. Containers that fail are omitted. */
    statsSnapshot: (config: ContainerConnection, containerIds: string[]) =>
      call<Record<string, StatsFrame>>('stats-snapshot', { configId: config.id, containerIds }),

    resources: (config: ContainerConnection, containerId: string) =>
      call<ContainerResources>('resources', { configId: config.id, containerId }),
    updateResources: (config: ContainerConnection, containerId: string, resources: ContainerResourceUpdate) =>
      call<void>('update-resources', { configId: config.id, containerId, resources }),

    prune: (config: ContainerConnection) => call<PruneResult>('container-prune', { configId: config.id }),

    imageList: (config: ContainerConnection) => call<ImageSummary[]>('image-list', { configId: config.id }),
    imageInspect: (config: ContainerConnection, imageId: string) => call<unknown>('image-inspect', { configId: config.id, imageId }),
    imageDetails: (config: ContainerConnection, imageId: string) => call<ImageDetails>('image-details', { configId: config.id, imageId }),
    imageRemove: (config: ContainerConnection, imageId: string, force: boolean) =>
      call<void>('image-remove', { configId: config.id, imageId, force }),

    /**
     * `image-pull` is a SELF-TERMINATING stream (the `tick-stream` pattern
     * from `devtool-svc-echo`, not the infinite `pubsub-subscribe`/
     * `logs-start` pattern — no unsubscribe method, nothing to stop by hand).
     * The sidecar sends `{ type: 'progress', ...PullProgress }` per Docker
     * pull event, then `{ type: 'done' }` once the daemon's own stream ends,
     * or `{ type: 'error', message }` on failure — this promise resolves on
     * `done` and rejects on `error`, forwarding every `progress` event to
     * `onProgress` in between. The framing-level `done: true` the sidecar
     * also sends is NOT what this waits for: `service_host.rs`'s `dispatch()`
     * drops that line's payload before it reaches `onMessage` (see the
     * sidecar's `handle_image_pull` doc comment) — completion has to be
     * encoded in the application payload instead, same lesson as the ADR's
     * stream-error section.
     */
    imagePull: (
      config: ContainerConnection, image: string, tag: string, onProgress: (p: PullProgress) => void,
    ): Promise<void> => new Promise<void>((resolve, reject) => {
      let subscription: { stop(): Promise<void> } | null = null;
      const stopQuietly = () => { void subscription?.stop().catch(() => {}); };
      sdk.service.stream<{
        type: string;
        status?: string;
        id?: string | null;
        progressCurrent?: number | null;
        progressTotal?: number | null;
        message?: string;
      }>(
        'image-pull',
        (event) => {
          if (event.type === 'progress') {
            onProgress({
              status: event.status ?? '',
              id: event.id ?? null,
              progressCurrent: event.progressCurrent ?? null,
              progressTotal: event.progressTotal ?? null,
            });
            return;
          }
          if (event.type === 'done') {
            resolve();
            stopQuietly();
            return;
          }
          if (event.type === 'error') {
            reject(new Error(event.message ?? 'Pull failed'));
            stopQuietly();
          }
        },
        { configId: config.id, image, tag },
      )
        .then((sub) => { subscription = sub; })
        .catch(reject);
    }),

    /** `danglingOnly` = `docker image prune`; `false` = `docker image prune -a`. */
    imagePrune: (config: ContainerConnection, danglingOnly: boolean) =>
      call<PruneResult>('image-prune', { configId: config.id, danglingOnly }),
    imageTag: (config: ContainerConnection, imageId: string, repo: string, tag: string) =>
      call<void>('image-tag', { configId: config.id, imageId, repo, tag }),

    volumeList: (config: ContainerConnection) => call<VolumeInfo[]>('volume-list', { configId: config.id }),
    volumeRemove: (config: ContainerConnection, name: string, force: boolean) =>
      call<void>('volume-remove', { configId: config.id, name, force }),
    volumeCreate: (config: ContainerConnection, name: string) =>
      call<VolumeInfo>('volume-create', { configId: config.id, name }),
    /** Per-volume disk usage in bytes, keyed by name — `{}` on Windows (named
     *  pipe transport isn't wired up for this raw request, see backend). */
    volumeSizes: (config: ContainerConnection) => call<Record<string, number>>('volume-sizes', { configId: config.id }),
    volumePrune: (config: ContainerConnection) => call<PruneResult>('volume-prune', { configId: config.id }),
    volumeDetails: (config: ContainerConnection, name: string) =>
      call<VolumeDetails>('volume-details', { configId: config.id, name }),

    networkList: (config: ContainerConnection) => call<NetworkInfo[]>('network-list', { configId: config.id }),
    networkRemove: (config: ContainerConnection, name: string) => call<void>('network-remove', { configId: config.id, name }),
    networkCreate: (config: ContainerConnection, name: string, driver: string) =>
      call<void>('network-create', { configId: config.id, name, driver }),
    networkPrune: (config: ContainerConnection) => call<PruneResult>('network-prune', { configId: config.id }),
    networkDetails: (config: ContainerConnection, networkId: string) =>
      call<NetworkDetails>('network-details', { configId: config.id, networkId }),

    systemInfo: (config: ContainerConnection) => call<SystemInfo>('system-info', { configId: config.id }),
    systemDf: (config: ContainerConnection) => call<SystemDataUsageResponse>('system-df', { configId: config.id }),
  };
}

/**
 * Dùng chung cho `logsStart`/`statsStart` — cả hai đều là stream VÔ HẠN
 * (mirror `pubsubSubscribe` của Redis): sự kiện đầu `{ type: 'subscribed',
 * subscriptionId }` mới cho promise settle, `{ type: 'error', message }` làm
 * nó reject, mọi sự kiện khác được ánh xạ qua `mapEvent` rồi forward tới
 * `onEvent`. `.stop()` gọi `unsubscribeMethod` (nếu có `subscriptionId`)
 * TRƯỚC rồi mới dừng đăng ký phía host — đúng thứ tự bắt buộc đã ghi ở
 * `pubsubSubscribe`.
 */
async function startSubscriptionStream<RawEvent, MappedEvent>(
  sdk: PluginSdk,
  call: <T>(method: string, params?: Record<string, unknown>) => Promise<T>,
  startMethod: string,
  unsubscribeMethod: string,
  params: Record<string, unknown>,
  mapEvent: (event: RawEvent) => MappedEvent,
  onEvent: (event: MappedEvent) => void,
): Promise<ContainerStreamSubscription> {
  let subscriptionId: string | null = null;
  let settleReady: (() => void) | null = null;
  let settleFailed: ((e: Error) => void) | null = null;
  const ready = new Promise<void>((resolve, reject) => {
    settleReady = resolve;
    settleFailed = reject;
  });

  // Trộn thêm `type`/`subscriptionId`/`message` vào kiểu sự kiện thô qua giao
  // (`&`) thay vì bắt `RawEvent` phải `extends` một kiểu có ba trường tuỳ
  // chọn đó: `StatsFrame` (dùng cho `statsStart`) không có trường nào trùng
  // tên với ba trường này, và TypeScript coi một kiểu KHÔNG CÓ trường nào
  // trùng với một kiểu chỉ toàn trường tuỳ chọn là khả nghi (lỗi TS2559) —
  // giao kiểu ở đây tránh hẳn luật đó vì không phải một phép gán/ràng buộc.
  const subscription = await sdk.service.stream<RawEvent & { type?: string; subscriptionId?: string; message?: string }>(
    startMethod,
    (event) => {
      if (event.type === 'subscribed') {
        subscriptionId = event.subscriptionId ?? null;
        settleReady?.();
        return;
      }
      if (event.type === 'error') {
        settleFailed?.(new Error(event.message ?? 'Stream failed'));
        return;
      }
      onEvent(mapEvent(event));
    },
    params,
  );

  try {
    await ready;
  } catch (e) {
    await subscription.stop().catch(() => {});
    throw e;
  }

  return {
    async stop() {
      if (subscriptionId) {
        await call<void>(unsubscribeMethod, { subscriptionId }).catch(() => {});
      }
      await subscription.stop();
    },
  };
}

export type ContainerApi = ReturnType<typeof createContainerApi>;
