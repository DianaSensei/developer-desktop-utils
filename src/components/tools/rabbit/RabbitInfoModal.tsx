import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RabbitInfoModalProps {
  onClose: () => void;
  onDismissPermanently: () => void;
}

function Badge({ label, variant }: { label: string; variant: 'read' | 'write' | 'destructive' }) {
  return (
    <span className={cn(
      'inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide shrink-0',
      variant === 'read' && 'bg-sky-500/15 text-sky-400',
      variant === 'write' && 'bg-amber-500/15 text-amber-400',
      variant === 'destructive' && 'bg-red-500/15 text-red-400',
    )}>
      {label}
    </span>
  );
}

function Row({ action, when, calls, badge, note }: {
  action: string;
  when: string;
  calls: string;
  badge: { label: string; variant: 'read' | 'write' | 'destructive' };
  note?: string;
}) {
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
          {note && <div className="text-[11px] text-orange-400/90 mt-1">{note}</div>}
        </div>
      </div>
    </div>
  );
}

export function RabbitInfoModal({ onClose, onDismissPermanently }: RabbitInfoModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-background border rounded-lg shadow-2xl w-full max-w-xl max-h-[88vh] flex flex-col mx-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b shrink-0">
          <div>
            <p className="text-sm font-semibold">How the RabbitMQ Client accesses your broker</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Every action that contacts the server is listed below.
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
          <p className="text-[11px] text-muted-foreground leading-relaxed mb-3">
            <span className="font-semibold text-foreground">Management HTTP API only.</span>{' '}
            This tool talks to the RabbitMQ <span className="font-mono">management</span> plugin's REST API
            (default port <span className="font-mono">15672</span>) to browse and create queues/exchanges.
            Each such request sends your username and password as HTTP Basic auth to the host you configured.
            There is no background polling — data loads when you open a view and refreshes only when you
            navigate or click Refresh. <span className="font-semibold text-foreground">Publish, Consume and
            Request/Response</span> instead open a short-lived <span className="font-mono">AMQP</span> connection
            (port <span className="font-mono">5672</span>, or <span className="font-mono">5671</span> with TLS) —
            these are the real broker operations the HTTP API can't do.
          </p>

          <p className="text-[11px] leading-relaxed mb-4 rounded-md border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-sky-700 dark:text-sky-300">
            <span className="font-semibold">AMQP-only mode.</span>{' '}
            If your broker exposes no management API, enable <span className="font-mono">AMQP-only</span> on the
            connection. The tool then works entirely over AMQP: you track queues/exchanges by name, counts come from a
            passive declare, and create/bind go over AMQP. Browse-all lists, Overview and Connections are unavailable
            (AMQP can't enumerate them).
          </p>

          <p className="text-[11px] leading-relaxed mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-300">
            <span className="font-semibold">Credential storage.</span>{' '}
            Connection profiles (including the password) are saved on this device in
            <span className="font-mono"> rabbit-connections.json</span> in the app data directory.
            Use TLS (HTTPS) for any non-local broker.
          </p>

          <div className="rounded-lg border border-border/50 overflow-hidden mb-4">
            <div className="px-3 py-2 bg-muted/20 border-b border-border/40">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Operations</span>
            </div>
            <div className="px-3 divide-y divide-border/20">
              <Row action="Test / Overview" when="on connect or Refresh" calls="GET /api/overview, /api/nodes" badge={{ label: 'Read', variant: 'read' }} />
              <Row action="Queue & exchange lists" when="on connect or Refresh" calls="GET /api/queues/{vhost}, /api/exchanges/{vhost}" badge={{ label: 'Read', variant: 'read' }} />
              <Row action="Open queue / exchange" when="on click" calls="GET …/{name} + …/bindings" badge={{ label: 'Read', variant: 'read' }} />
              <Row action="Connections & channels" when="on tab open or Refresh" calls="GET /api/connections, /api/channels" badge={{ label: 'Read', variant: 'read' }} />
              <Row action="Create exchange / binding / queue" when="on create confirm" calls="PUT /api/exchanges|queues/…, POST /api/bindings/…" badge={{ label: 'Write', variant: 'write' }} />
              <Row
                action="Publish message"
                when="on Publish click"
                calls="AMQP connect (5672/5671) · basic.publish (+ confirm / mandatory)"
                badge={{ label: 'Write', variant: 'write' }}
                note="A real AMQP publish with your chosen properties. Persistent + routed messages are stored by the broker; mandatory returns unroutable messages instead of dropping them."
              />
              <Row
                action="Consume — Peek"
                when="while a peek consumer is running"
                calls="AMQP connect · basic.qos(prefetch) · basic.consume (no ack)"
                badge={{ label: 'Read', variant: 'read' }}
                note="Non-destructive: messages are delivered unacked, bounded by prefetch, and requeued (flagged redelivered) on Stop. It is still a real subscription — on a queue with other consumers it competes for and temporarily withholds the messages it holds. Confirmed before it starts."
              />
              <Row
                action="Consume — Consume (ack)"
                when="while a consume consumer is running"
                calls="AMQP connect · basic.qos(prefetch) · basic.consume + basic.ack"
                badge={{ label: 'Write', variant: 'write' }}
                note="Destructive: acknowledges and permanently removes each message it receives. On a queue with other consumers it takes a share of the messages. Confirmed before it starts."
              />
              <Row
                action="Respond (RPC server)"
                when="while a respond consumer is running"
                calls="basic.consume + basic.ack + basic.publish to each request's reply_to"
                badge={{ label: 'Write', variant: 'write' }}
                note="The tool acts as an RPC server: it acks (removes) each request and replies (echo or a fixed payload) to the request's reply_to with the same correlation id. Confirmed before it starts."
              />
              <Row
                action="Request / Response"
                when="on Send & await reply"
                calls="AMQP connect · consume amq.rabbitmq.reply-to · basic.publish"
                badge={{ label: 'Write', variant: 'write' }}
                note="Opens a one-shot AMQP connection to use direct reply-to. Publishes a real request message and waits for the reply."
              />
            </div>
            <p className="px-3 pb-2.5 pt-1 text-[11px] text-muted-foreground">
              No destructive operations: the tool never purges or deletes queues or exchanges.
            </p>
          </div>
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
