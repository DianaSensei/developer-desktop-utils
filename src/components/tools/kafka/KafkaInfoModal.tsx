import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface KafkaInfoModalProps {
  onClose: () => void;
  onDismissPermanently: () => void;
}

function Badge({ label, variant }: { label: string; variant: 'read' | 'write' | 'destructive' | 'warn' }) {
  return (
    <span className={cn(
      'inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0',
      variant === 'read'        && 'bg-sky-500/15 text-sky-400',
      variant === 'write'       && 'bg-amber-500/15 text-amber-400',
      variant === 'destructive' && 'bg-red-500/15 text-red-400',
      variant === 'warn'        && 'bg-orange-500/15 text-orange-400',
    )}>
      {label}
    </span>
  );
}

interface RowProps {
  action: string;
  when: string;
  calls: string;
  badge: { label: string; variant: 'read' | 'write' | 'destructive' | 'warn' };
  note?: string;
}

function Row({ action, when, calls, badge, note }: RowProps) {
  return (
    <div className="py-2.5 border-b border-border/30 last:border-0">
      <div className="flex items-start gap-2.5">
        <Badge label={badge.label} variant={badge.variant} />
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-xs font-semibold text-foreground">{action}</span>
            <span className="text-[11px] text-muted-foreground">{when}</span>
          </div>
          <div className="text-[11px] font-mono text-muted-foreground/70 mt-0.5">{calls}</div>
          {note && (
            <div className="text-[11px] text-orange-400/90 mt-1">{note}</div>
          )}
        </div>
      </div>
    </div>
  );
}

export function KafkaInfoModal({ onClose, onDismissPermanently }: KafkaInfoModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border rounded-lg shadow-2xl w-full max-w-xl max-h-[88vh] flex flex-col mx-4">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <div>
            <p className="text-sm font-semibold">How Kafka Explorer accesses your cluster</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Every action that contacts the broker is listed below.
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors ml-3 shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto min-h-0 px-5 py-3">

          {/* Connection model */}
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
            <span className="font-semibold text-foreground">No persistent connection.</span>{' '}
            Each action opens one TCP connection to your broker and closes it when done.
            The connection starts with a short probe (MetadataRequest, to confirm this is a Kafka port)
            and is then reused for the command. The app identifies itself to brokers as
            client ID <span className="font-mono">devtool</span>. There is no background polling —
            data loads when you open a view and refreshes only when you navigate or click Refresh.
          </p>

          {/* Security note */}
          <p className="text-[11px] leading-relaxed mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
            <span className="font-semibold">Plaintext only.</span>{' '}
            Connections are unencrypted — TLS/SSL and SASL authentication are not implemented.
            Don't point this at a broker that requires encryption or credentials.
          </p>

          {/* Operations table */}
          <div className="rounded-lg border border-border/50 overflow-hidden mb-4">
            <div className="px-3 py-2 bg-muted/20 border-b border-border/40">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Operations</span>
            </div>
            <div className="px-3 divide-y divide-border/20">
              <Row
                action="Select broker / Test connection"
                when="on broker select or Refresh"
                calls="MetadataRequest v0 (API 3)"
                badge={{ label: 'Read', variant: 'read' }}
              />
              <Row
                action="Topic list"
                when="on broker select or Refresh"
                calls="MetadataRequest v0 (all topics)"
                badge={{ label: 'Read', variant: 'read' }}
              />
              <Row
                action="Open topic"
                when="on topic click"
                calls="MetadataRequest + 2× ListOffsets v0 (earliest & latest)"
                badge={{ label: 'Read', variant: 'read' }}
              />
              <Row
                action="Config tab"
                when="on tab open"
                calls="DescribeConfigs v0 (API 32) — all config keys"
                badge={{ label: 'Read', variant: 'read' }}
              />
              <Row
                action="Fetch messages / Load more"
                when="auto on open (latest), then Fetch or Load more"
                calls="FetchRequest via rskafka — up to 10 MB per call"
                badge={{ label: 'Read', variant: 'read' }}
                note="The latest page loads automatically when you open a topic. No consumer group is created, no offset is committed, and existing consumers are not affected."
              />
              <Row
                action="Consumer groups list"
                when="on broker select or Refresh"
                calls="ListGroups v0 + DescribeGroups v0 (all groups)"
                badge={{ label: 'Read', variant: 'read' }}
              />
              <Row
                action="Topic → Consumers tab"
                when="auto on tab open, or Refresh"
                calls="ListGroups + 1× OffsetFetch v2 per group (capped at 500 groups)"
                badge={{ label: 'Read', variant: 'read' }}
                note="Scans groups for committed offsets on this topic. Bounded to the first 500 groups so large clusters aren't hammered."
              />
              <Row
                action="Consumer group details"
                when="on group click"
                calls="DescribeGroups + 1× OffsetFetch v2 (all committed offsets) + 1× ListOffsets per committed topic"
                badge={{ label: 'Read', variant: 'read' }}
                note="A single OffsetFetch returns the group's committed offsets; ListOffsets is then batched once per topic (not per partition)."
              />
              <Row
                action="Produce message"
                when="on Send Message click"
                calls="ProduceRequest (no compression)"
                badge={{ label: 'Write', variant: 'write' }}
                note="Permanently writes a message to the topic. Retained per topic retention policy. Cannot be undone."
              />
              <Row
                action="Create topic"
                when="on create confirm"
                calls="CreateTopicsRequest via rskafka controller"
                badge={{ label: 'Write', variant: 'write' }}
              />
              <Row
                action="Delete topic"
                when="on delete confirm"
                calls="DeleteTopicsRequest via rskafka controller"
                badge={{ label: 'Destructive', variant: 'destructive' }}
                note="Permanently deletes the topic and all its data. Irreversible."
              />
            </div>
          </div>

          <p className="text-[11px] text-muted-foreground">
            Full documentation: <span className="font-mono text-foreground/70">docs/human/kafka-explorer.md</span>
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t shrink-0 bg-muted/10">
          <button
            onClick={onDismissPermanently}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Don't show again
          </button>
          <button
            onClick={onClose}
            className="text-xs font-medium bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:bg-primary/90 transition-colors"
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}
