import { useEffect, useState } from 'react';
import {
  Plus, Pencil, Trash2, List, Users, Radio, Send, Square, ChevronRight, ChevronDown, Plug, PlugZap, } from 'lucide-react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@/components/ui/select';
import { IconButton } from '@/components/ui/icon-button';
import { StatusDot } from '@/components/ui/status-dot';
import { cn } from '@/lib/utils';
import { BrokerForm } from './BrokerForm';
import { kafkaApi, type BrokerConfig } from './types';
import { kafkaConsumerStore, useKafkaConsumers } from './kafkaConsumerStore';
import type { KafkaView } from './useKafkaState';

interface LeftPanelProps {
  selectedBrokerId: string;
  onSelectBroker: (id: string) => void;
  connected: boolean;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  view: KafkaView;
  onShowTopics: () => void;
  onShowGroups: () => void;
  onShowConsumers: (topic?: string) => void;
  onOpenConsumer: (topic: string) => void;
  onShowProduce: (topic?: string) => void;
}

export function LeftPanel({
  selectedBrokerId, onSelectBroker, connected, connecting, onConnect, onDisconnect,
  view, onShowTopics, onShowGroups, onShowConsumers, onOpenConsumer, onShowProduce,
}: LeftPanelProps) {
  const [configs, setConfigs] = useState<BrokerConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BrokerConfig | null>(null);
  const [removeArmed, setRemoveArmed] = useState(false);
  const [consumersExpanded, setConsumersExpanded] = useState(true);

  const conn = configs.find((c) => c.id === selectedBrokerId) ?? null;
  const activeConsumers = useKafkaConsumers().filter((s) => s.brokerId === selectedBrokerId);

  const loadConfigs = () => {
    setLoading(true);
    kafkaApi.listConfigs()
      .then(setConfigs)
      .catch(() => setConfigs([]))
      .finally(() => setLoading(false));
  };
  useEffect(() => { loadConfigs(); }, []);

  // Reset the armed remove after a few seconds, or when the selection changes.
  useEffect(() => {
    if (!removeArmed) return;
    const t = window.setTimeout(() => setRemoveArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [removeArmed]);
  useEffect(() => { setRemoveArmed(false); }, [selectedBrokerId]);

  const handleSave = async (config: BrokerConfig) => {
    const saved = await kafkaApi.saveConfig(config);
    setFormOpen(false);
    setEditing(null);
    loadConfigs();
    onSelectBroker(saved.id);
  };

  const handleRemove = async () => {
    if (!conn) return;
    if (!removeArmed) { setRemoveArmed(true); return; }
    setRemoveArmed(false);
    await kafkaApi.deleteConfig(conn.id);
    loadConfigs();
    onSelectBroker('');
  };

  return (
    <div className="flex flex-col h-full border-r min-w-0">
      {/* Broker picker */}
      <div className="p-3 border-b shrink-0 space-y-2">
        <div className="flex items-center gap-1.5">
          <Select value={selectedBrokerId} onValueChange={onSelectBroker}>
            <SelectTrigger className="h-ctl text-xs">
              <SelectValue placeholder={loading ? 'Loading…' : 'Select broker'} />
            </SelectTrigger>
            <SelectContent>
              {configs.map((c) => (
                <SelectItem key={c.id} value={c.id} className="text-xs">{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost" size="icon" className="h-ctl w-ctl shrink-0"
            title="Add broker"
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
                <span className="text-[11px] text-fg-mute font-mono truncate" title={conn.bootstrapServers}>
                  {conn.bootstrapServers}
                </span>
              </span>
              <div className="flex items-center gap-0.5 shrink-0">
                <IconButton size="sm" className="hover:bg-muted" title="Edit" onClick={() => { setEditing(conn); setFormOpen(true); }}>
                  <Pencil className="h-3.5 w-3.5" />
                </IconButton>
                <IconButton
                  size="sm"
                  className={cn('hover:bg-muted hover:text-destructive', removeArmed && 'text-destructive')}
                  title={removeArmed ? 'Click again to remove' : 'Remove this saved broker'}
                  onClick={handleRemove}
                >
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
          </>
        )}
      </div>

      {!conn ? (
        <div className="flex-1 flex items-center justify-center p-4 text-center">
          {!loading && <p className="text-xs text-fg-mute">Add a broker to get started.</p>}
        </div>
      ) : (
        <div className="p-2 space-y-0.5 overflow-y-auto">
          <NavItem icon={List} label="Topics" active={view === 'topics' || view === 'topic'} onClick={onShowTopics} />
          <NavItem icon={Users} label="Groups" active={view === 'groups' || view === 'group'} onClick={onShowGroups} />
          <NavItem icon={Send} label="Produce" active={view === 'produce'} onClick={() => onShowProduce()} />

          {/* Consume — collapsible parent for the active realtime consumers. */}
          <div
            className={cn(
              'group w-full flex items-center gap-2 px-2 rounded-md text-xs transition-colors',
              view === 'consume' ? 'bg-primary/10 text-primary font-medium' : 'text-fg-mute hover:text-fg hover:bg-muted/60',
            )}
          >
            <button type="button" className="flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left" onClick={() => onShowConsumers()}>
              <Radio className="h-4 w-4 shrink-0" />
              Consume
            </button>
            {activeConsumers.length > 0 && (
              <span className="text-[11px] tabular-nums text-fg-mute shrink-0">{activeConsumers.length}</span>
            )}
            <button
              type="button"
              className="p-0.5 rounded hover:bg-muted/60 shrink-0 disabled:opacity-30"
              title={consumersExpanded ? 'Collapse' : 'Expand'}
              disabled={activeConsumers.length === 0}
              onClick={() => setConsumersExpanded((e) => !e)}
            >
              {consumersExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>

          {consumersExpanded && activeConsumers.map((s) => (
            <div key={s.topic} className="group flex items-center gap-2 pl-3.5 pr-2 py-1 rounded-md text-xs hover:bg-muted/60">
              <StatusDot tone={s.starting ? 'starting' : 'live'} size="xs" title={s.starting ? 'starting' : 'live'} />
              <button
                className="flex-1 min-w-0 text-left font-mono truncate text-fg-mute group-hover:text-fg"
                title={`${s.topic} (${s.from === 'latest' ? 'new only' : 'from start'})`}
                onClick={() => onOpenConsumer(s.topic)}
              >
                {s.topic}
              </button>
              <span className="text-[11px] text-fg-mute tabular-nums shrink-0" title={`${s.received.toLocaleString()} received`}>{s.received.toLocaleString()}</span>
              <button
                className="text-fg-mute hover:text-destructive shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                title="Stop consumer"
                onClick={() => kafkaConsumerStore.stop(s.brokerId, s.topic)}
              >
                <Square className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}

      {formOpen && (
        <BrokerForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => { setFormOpen(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

function NavItem({ icon: Icon, label, active, onClick }: {
  icon: typeof List; label: string; active: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors',
        active ? 'bg-primary/10 text-primary font-medium' : 'text-fg-mute hover:text-fg hover:bg-muted/60',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
    </button>
  );
}
