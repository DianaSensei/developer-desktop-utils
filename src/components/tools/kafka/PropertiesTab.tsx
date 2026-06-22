import type { TopicDetails } from './types';

interface PropertiesTabProps {
  details: TopicDetails;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <span className="text-sm text-muted-foreground py-1.5">{label}</span>
      <span className="font-mono text-sm py-1.5 break-all">{value}</span>
    </>
  );
}

export function PropertiesTab({ details }: PropertiesTabProps) {
  const totalMessages = details.partitions.reduce((sum, p) => {
    if (p.latestOffset >= 0 && p.earliestOffset >= 0) {
      return sum + (p.latestOffset - p.earliestOffset);
    }
    return sum;
  }, 0);

  return (
    <div className="p-5 space-y-6 overflow-y-auto h-full">
      {/* General */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 border-b pb-1">
          General
        </h3>
        <div className="grid gap-x-8 gap-y-0.5 items-start" style={{ gridTemplateColumns: '11rem 1fr' }}>
          <Row label="Topic Name" value={details.name} />
          <Row label="Partitions" value={String(details.partitions.length)} />
          <Row label="Replication Factor" value={String(details.replicationFactor)} />
        </div>
      </section>

      {/* Messages */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 border-b pb-1">
          Messages
        </h3>
        <div className="grid gap-x-8 gap-y-0.5 items-start" style={{ gridTemplateColumns: '11rem 1fr' }}>
          <span className="text-sm text-muted-foreground py-1.5">Total messages</span>
          <span className="font-mono text-sm py-1.5">{totalMessages.toLocaleString()}</span>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Computed from partition offsets (latest − earliest). May differ from actual message count if compaction or retention has run.
        </p>
      </section>

      {/* Partitions detail */}
      <section>
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3 border-b pb-1">
          Partition Offsets
        </h3>
        <div className="rounded-lg border overflow-hidden">
          <div className="grid text-xs font-medium text-muted-foreground bg-muted/30 px-3 py-2 border-b"
            style={{ gridTemplateColumns: '3rem 1fr 1fr 1fr' }}>
            <span>ID</span>
            <span>Earliest</span>
            <span>Latest</span>
            <span>Messages</span>
          </div>
          {details.partitions.map((p) => {
            const count = p.latestOffset >= 0 && p.earliestOffset >= 0
              ? p.latestOffset - p.earliestOffset
              : -1;
            return (
              <div
                key={p.id}
                className="grid text-xs font-mono px-3 py-1.5 border-b last:border-0 hover:bg-muted/10"
                style={{ gridTemplateColumns: '3rem 1fr 1fr 1fr' }}
              >
                <span>{p.id}</span>
                <span className="text-muted-foreground">{p.earliestOffset >= 0 ? p.earliestOffset.toLocaleString() : '—'}</span>
                <span className="text-muted-foreground">{p.latestOffset >= 0 ? p.latestOffset.toLocaleString() : '—'}</span>
                <span>{count >= 0 ? count.toLocaleString() : '—'}</span>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
