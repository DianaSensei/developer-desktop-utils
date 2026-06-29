import { useState } from 'react';
import { Plus, Pencil, Trash2, Gauge, Plug, Repeat, Inbox, Radio, Square, Headphones, ChevronRight, ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import type { RabbitConnection } from './types';
import { rabbitApi } from './types';
import { ConnectionForm } from './ConnectionForm';
import { ConfirmDialog } from './ConfirmDialog';
import { consumerStore, useConsumers } from './consumerStore';
import type { RabbitView } from './useRabbitState';

interface LeftPanelProps {
  connections: RabbitConnection[];
  connectionsLoading: boolean;
  selectedConnId: string;
  onSelectConn: (id: string) => void;
  onConnectionsChanged: () => void;
  view: RabbitView;
  onShowOverview: () => void;
  onShowConnections: () => void;
  onShowRpc: () => void;
  onShowConsumers: () => void;
  onShowQueues: () => void;
  onShowExchanges: () => void;
}

export function LeftPanel(props: LeftPanelProps) {
  const {
    connections, connectionsLoading, selectedConnId, onSelectConn, onConnectionsChanged,
    view, onShowOverview, onShowConnections, onShowRpc, onShowConsumers, onShowQueues, onShowExchanges,
  } = props;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RabbitConnection | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [consumersExpanded, setConsumersExpanded] = useState(true);

  const conn = connections.find((c) => c.id === selectedConnId) ?? null;

  const activeConsumers = useConsumers().filter((s) => s.connId === selectedConnId);

  const handleSave = async (config: RabbitConnection) => {
    const saved = await rabbitApi.saveConfig(config);
    setFormOpen(false);
    setEditing(null);
    onConnectionsChanged();
    onSelectConn(saved.id);
  };

  return (
    <div className="flex flex-col h-full border-r min-w-0">
      {/* Connection picker */}
      <div className="p-3 border-b shrink-0 space-y-2">
        <div className="flex items-center gap-1.5">
          <Select value={selectedConnId} onValueChange={onSelectConn}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder={connectionsLoading ? 'Loading…' : 'Select connection'} />
            </SelectTrigger>
            <SelectContent>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost" size="icon" className="h-8 w-8 shrink-0"
            title="Add connection"
            onClick={() => { setEditing(null); setFormOpen(true); }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {conn && (
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground font-mono truncate">
              {conn.useTls ? 'https' : 'http'}://{conn.host}:{conn.port}
            </span>
            <div className="flex items-center gap-0.5 shrink-0">
              <button
                className="p-1 rounded text-muted-foreground hover:text-foreground hover:bg-muted"
                title="Edit" onClick={() => { setEditing(conn); setFormOpen(true); }}
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
              <button
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted"
                title="Remove this saved connection" onClick={() => setDeleteOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        )}
      </div>

      {!conn ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center">
          {!connectionsLoading && (
            <p className="text-xs text-muted-foreground">Add a connection to get started.</p>
          )}
        </div>
      ) : (
        <div className="p-2 space-y-0.5 overflow-y-auto">
          {/* Overview & Connections need the management API — hidden in AMQP-only mode. */}
          {!conn.amqpOnly && <NavItem icon={Gauge} label="Overview" active={view === 'overview'} onClick={onShowOverview} />}
          <NavItem icon={Inbox} label="Queues" active={view === 'queues' || view === 'queue'} onClick={onShowQueues} />
          <NavItem icon={Radio} label="Exchanges" active={view === 'exchanges' || view === 'exchange'} onClick={onShowExchanges} />
          {!conn.amqpOnly && <NavItem icon={Plug} label="Connections" active={view === 'connections'} onClick={onShowConnections} />}
          <NavItem icon={Repeat} label="Send / Request" active={view === 'rpc'} onClick={onShowRpc} />
          {/* Consumers — collapsible parent for the active-consumer children. */}
          <div
            className={cn(
              'group w-full flex items-center gap-2 px-2 rounded-md text-xs transition-colors',
              view === 'consumers' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
            )}
          >
            <button type="button" className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left" onClick={onShowConsumers}>
              <Headphones className="h-4 w-4 shrink-0" />
              Consumers
            </button>
            {activeConsumers.length > 0 && (
              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">{activeConsumers.length}</span>
            )}
            <button
              type="button"
              className="p-0.5 rounded hover:bg-muted/60 shrink-0 disabled:opacity-30"
              title={consumersExpanded ? 'Collapse' : 'Expand'}
              disabled={activeConsumers.length === 0}
              onClick={() => setConsumersExpanded((e) => !e)}
            >
              {consumersExpanded
                ? <ChevronDown className="h-3.5 w-3.5" />
                : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>

          {/* Active consumers, nested under Consumers — keep running across tabs. */}
          {consumersExpanded && activeConsumers.map((s) => (
            <div
              key={s.queue}
              className="group flex items-center gap-2 pl-3.5 pr-2 py-1 rounded-md text-xs hover:bg-muted/60"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" title={s.starting ? 'starting' : 'live'} />
              <button
                className="flex-1 min-w-0 text-left font-mono truncate text-muted-foreground group-hover:text-foreground"
                title={`${s.queue} (${s.mode})`}
                onClick={onShowConsumers}
              >
                {s.queue}
              </button>
              <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{s.messages.length}</span>
              <button
                className="text-muted-foreground hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Stop consumer"
                onClick={() => consumerStore.stop(s.connId, s.queue)}
              >
                <Square className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <ConnectionForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => { setFormOpen(false); setEditing(null); }}
        />
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title="Remove connection?"
        description={`Remove the saved connection "${conn?.name}" from this device. The broker is not affected.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!conn) return;
          await rabbitApi.deleteConfig(conn.id);
          onConnectionsChanged();
          onSelectConn('');
        }}
      />
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick }: {
  icon: typeof Gauge; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors',
        active ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}
