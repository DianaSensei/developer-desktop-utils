import { useState } from 'react';
import { Plus, Pencil, Trash2, Gauge, Plug, PlugZap, KeyRound, Terminal, Radio, Wrench } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { IconButton } from '@/components/ui/icon-button';
import { StatusDot } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';
import type { RedisConnection } from './types';
import { redisApi } from './types';
import { ConnectionForm } from './ConnectionForm';
import { ConfirmDialog } from './ConfirmDialog';
import type { RedisView } from './useRedisState';

const DB_COUNT = 16;

interface LeftPanelProps {
  connections: RedisConnection[];
  connectionsLoading: boolean;
  selectedConnId: string;
  onSelectConn: (id: string) => void;
  onConnectionsChanged: () => void;
  connected: boolean;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  db: number;
  onSelectDb: (db: number) => void;
  view: RedisView;
  onShowOverview: () => void;
  onShowKeys: () => void;
  onShowCli: () => void;
  onShowPubSub: () => void;
  onShowAdmin: () => void;
}

export function LeftPanel(props: LeftPanelProps) {
  const {
    connections, connectionsLoading, selectedConnId, onSelectConn, onConnectionsChanged,
    connected, connecting, onConnect, onDisconnect,
    db, onSelectDb,
    view, onShowOverview, onShowKeys, onShowCli, onShowPubSub, onShowAdmin,
  } = props;

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<RedisConnection | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const conn = connections.find((c) => c.id === selectedConnId) ?? null;

  const handleSave = async (config: RedisConnection) => {
    const saved = await redisApi.saveConfig(config);
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
          <Select value={selectedConnId} onValueChange={onSelectConn} disabled={!connectionsLoading && connections.length === 0}>
            <SelectTrigger className="h-ctl text-xs">
              <SelectValue placeholder={connectionsLoading ? 'Loading…' : connections.length === 0 ? 'No connections yet' : 'Select connection'} />
            </SelectTrigger>
            <SelectContent>
              {connections.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost" size="icon" className="h-ctl w-ctl shrink-0"
            title="Add connection"
            onClick={() => { setEditing(null); setFormOpen(true); }}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        {conn && (
          <>
            <div className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 min-w-0">
                <StatusDot tone={connected ? 'live' : 'idle'} size="xs" title={connected ? 'connected' : 'not connected'} />
                <span className="text-[11px] text-fg-mute font-mono truncate">
                  {conn.host}:{conn.port}
                </span>
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                <IconButton size="sm" className="hover:bg-bg-2" title="Edit" onClick={() => { setEditing(conn); setFormOpen(true); }}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton size="sm" className="hover:bg-bg-2 hover:text-bad" title="Remove this saved connection" onClick={() => setDeleteOpen(true)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </IconButton>
              </div>
            </div>
            {connected ? (
              <Button variant="outline" size="sm" className="w-full h-ctl text-xs" onClick={onDisconnect}>
                <Plug className="h-3.5 w-3.5 mr-1.5" /> Disconnect
              </Button>
            ) : (
              <Button size="sm" className="w-full h-ctl text-xs" onClick={onConnect} disabled={connecting}>
                {connecting ? <Spinner size="sm" className="mr-1.5" /> : <PlugZap className="h-3.5 w-3.5 mr-1.5" />}
                {connecting ? 'Connecting…' : 'Connect'}
              </Button>
            )}
            {connected && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-fg-mute shrink-0">DB</span>
                <Select value={String(db)} onValueChange={(v) => onSelectDb(Number(v))}>
                  <SelectTrigger className="h-ctl text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: DB_COUNT }, (_, i) => (
                      <SelectItem key={i} value={String(i)} className="text-xs font-mono">{i}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </>
        )}
      </div>

      {!conn ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center">
          {!connectionsLoading && (
            <p className="text-xs text-fg-mute">Add a connection to get started.</p>
          )}
        </div>
      ) : (
        <div className="p-2 space-y-0.5 overflow-y-auto">
          <NavItem icon={Gauge} label="Overview" active={view === 'overview'} onClick={onShowOverview} />
          <NavItem icon={KeyRound} label="Keys" active={view === 'keys' || view === 'key'} onClick={onShowKeys} />
          <NavItem icon={Terminal} label="CLI Console" active={view === 'cli'} onClick={onShowCli} />
          <NavItem icon={Radio} label="Pub/Sub" active={view === 'pubsub'} onClick={onShowPubSub} />
          <NavItem icon={Wrench} label="Admin" active={view === 'admin'} onClick={onShowAdmin} />
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
        description={`Remove the saved connection "${conn?.name}" from this device. The server is not affected.`}
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!conn) return;
          await redisApi.deleteConfig(conn.id);
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
        active ? 'bg-acc/10 text-acc font-medium' : 'text-fg-mute hover:text-fg hover:bg-bg-2/60',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}
