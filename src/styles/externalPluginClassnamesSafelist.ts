/**
 * Tailwind CSS safelist for plugins moved out to `developer-desktop-util-plugin`
 * (redis-client, rabbit-client, container-manager — see
 * docs/decisions/architecture/platform-plugin-architecture.md for why they're
 * no longer compiled into this repo).
 *
 * Tailwind's JIT scans `content` globs (tailwind.config.js) for class-name-
 * shaped TEXT, not the import graph — once a plugin's `.tsx` source leaves
 * `src/`, every Tailwind utility class it used that isn't ALSO used by some
 * still-compiled tool silently drops out of the built CSS. A user who later
 * installs one of these plugins from a URL (docs/plugin-sdk/05-external-install.md)
 * would then see it rendered with half its classes doing nothing.
 *
 * This file is never imported — it exists purely as scannable text so those
 * classes stay in the compiled stylesheet. Regenerate by re-running the
 * extraction one-off in the migration PR description if the plugin source
 * changes meaningfully after this point (no automated re-sync — that would
 * require checking out the plugin repo during this app's build, which is
 * more coupling than a safelist is worth).
 */
export const EXTERNAL_PLUGIN_CLASSNAMES_SAFELIST = `
  -1 -mx-3 -v /api-1 /container-manager /rabbit-client /redis-client /web-1
  0-3 0-3. : Comma-separated Content-Type Destructive: Docker-compatible Double-click
  Non-destructive: Pretty-print RepoTags: SELF-TERMINATING Timestamps: Un-ticked ab-ab-ab ackMode:
  active:scale-[0.94] already-filtered amq.rabbitmq.reply-to amqp-bind-queue amqp-declare-exchange amqp-declare-queue amqp-exchanges-info amqp-queues-info
  amqp-test amqp:// animate-in answer: api-1 api-1-logs.log args: backdrop-blur-xs
  bg-acc bg-acc/10 bg-acc/70 bg-bg-2/10 bg-bg-2/20 bg-bg-2/30 bg-card bg-card/40
  bg-card/95 bg-line bg-warn/40 blkioWeight: border-0 border-acc border-acc/40 border-b
  border-fg-mute/70 border-line border-line-soft border-r border-t bottom-4 break-all break-words
  broker2:5672 built-in channel: client-list client: clipboard:read clipboard:write col-span-full
  config-get config-set config: connectedConnId: consume-start consume-stop consumer-1 container-manager
  container-prune cpuShares: cpusetCpus: cs-prefetch cursor-col-resize cursor-pointer cursor: datetime-local
  db: decoration-dotted delete-config delete-keys detect-sockets devtool-svc-container devtool-svc-container.rs::find_config devtool-svc-rabbit
  devtool-svc-redis devtool:rabbit:exchangeTab devtool:rabbit:info-dismissed devtool:rabbit:knownNames devtool:rabbit:leftPanelWidth devtool:rabbit:payloadFormat devtool:rabbit:queueTab devtool:rabbit:replyFormat
  devtool:redis: disabled:cursor-not-allowed disabled:opacity-40 divide-line-soft divide-y docker-compose docs/decisions/architecture/platform-plugin-architecture.md done:
  duration-100 duration-base duration-fast ease-out-soft entrance-animation exchange: fade-in-0 files:write
  filter: flex-1 flex-[2] flex-col flex-wrap focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-focus
  focus-visible:ring-offset-bg font-medium font-mono font-normal font-semibold gap-0.5 gap-1 gap-1.5
  gap-2 gap-2.5 gap-3 gap-4 gap-x-2 gap-x-3 gap-x-4 gap-x-6
  gap-y-0.5 gap-y-1 gap-y-1.5 gap-y-2 gap-y-3 get-key grid-cols-2 grid-cols-[1fr_auto]
  group-hover:bg-acc/50 group-hover:left-[1px] group-hover:w-[3px] h-14 h-3 h-3.5 h-4 h-5
  h-ctl h-full hint: host: host:port hover:bg-acc hover:bg-acc-hi hover:bg-acc/10
  hover:bg-acc/90 hover:bg-bg-2 hover:bg-bg-2/40 hover:bg-bg-2/60 hover:border-acc hover:border-acc-hi hover:border-line hover:text-bad
  hover:text-fg hover:underline image-details image-inspect image-list image-prune image-pull image-remove
  image-tag in-memory info-dismissed inline-flex inset-x-0 inset-y-0 items-baseline items-center
  items-end items-start justify-between justify-center justify-end kebab-case key-summary key-value
  key: keys: kind: label: last:border-0 leading-relaxed left-[1px] left-[2px]
  lines: list-configs logs-start logs-unsubscribe long-lived lucide-react max-h-40 max-h-64
  max-h-[65vh] max-w-2xl max-w-3xl max-w-5xl max-w-[45%] max-w-full max-w-md max-w-sm
  mb-3 mb-4 mcp:call memory-usage memoryReservation: memorySwap: message: min-h-0
  min-h-24 min-h-40 min-h-[16px] min-w-0 missing: ml-1 ml-auto mr-1.5
  mr-2 mr-auto mt-0.5 mt-1 mt-2 mx-0.5 my-network my-volume
  name: names: network-create network-details network-list network-prune network-remove new-conn-id
  newKey: non-string oldKey: one-by-one one-shot opacity-30 opacity-60 opacity-70
  other-tool-call overflow-hidden overflow-x-auto overflow-y-auto p-2 p-2.5 p-3 p-4
  param: password: pattern: payload: pb-2.5 pb-20 pb-3 placeholder:
  pointer-events-auto pointer-events-none port: pr-1 pr-2 pt-1 pt-3 pubsub-subscribe
  px-2 px-2.5 px-3 px-4 px-5 px-8 py-1 py-1.5
  py-2 py-2.5 py-3 py-4 queue: rabbit-client rb-hb rb-hosts
  rb-name rb-pass rb-port rb-tls rb-uri rb-user rd-rename read-only
  redis-cache redis-client redis:7-alpine rename-key reply-to. repo:tag resize-y restartPolicy:
  rounded-full rounded-lg rounded-md rounded-none rounded-sm routingKey: rpc-call save-config
  scan-keys select-none server: set-string set-ttl sha256: sha256:img-nginx sha256:img-node
  sha256:missing sha256:x shadow-lg shrink-0 site-data size: slide-in-from-bottom-2 sm:grid-cols-2
  sm:grid-cols-3 sm:grid-cols-4 socketPath: space-y-0.5 space-y-1 space-y-2 space-y-3 space-y-4
  space-y-5 state: stats-snapshot stats-start stats-unsubscribe sub-1 summary: syntax:
  system-df system-info tabular-nums test-connection text-[11px] text-acc text-acc-fg text-bad
  text-center text-fg text-fg-mute text-fg-mute/50 text-fg-mute/60 text-fg-mute/70 text-fg-mute/80 text-left
  text-ok text-right text-sm text-warn text-xs tool-full-height tool-scrollable transition-all
  transition-colors underline-offset-2 update-resources user-defined user:1 value: variant: vhost:
  volume-create volume-details volume-list volume-prune volume-remove volume-sizes w-14 w-16
  w-24 w-28 w-3 w-3.5 w-32 w-4 w-5 w-8
  w-[110px] w-[3px] w-[5px] w-ctl w-full w-px web-1 whitespace-nowrap
  whitespace-pre-wrap wrapper: yyyy-MM-ddTHH:mm z-10 z-20
`;
