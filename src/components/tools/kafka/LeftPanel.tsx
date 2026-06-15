import { useState, useEffect } from 'react';
import {
  CheckCircle, XCircle, Loader2, Pencil, Trash2, Plus,
  ChevronDown, Search, RefreshCw, WifiOff, Wifi,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { BrokerForm } from './BrokerForm';
import { kafkaApi, type BrokerConfig, type TopicSummary, type GroupSummary } from './types';

type ConnStatus = 'idle' | 'testing' | 'ok' | 'error' | 'disconnected';

const GROUP_STATE_BG: Record<string, string> = {
  Stable: 'bg-green-500',
  Empty: 'bg-muted-foreground/40',
  Dead: 'bg-destructive',
  PreparingRebalance: 'bg-orange-500',
  CompletingRebalance: 'bg-yellow-500',
};

interface LeftPanelProps {
  selectedBrokerId: string;
  onSelectBroker: (id: string) => void;
  selectedTopic: string | null;
  onSelectTopic: (t: string | null) => void;
  selectedGroup: string | null;
  onSelectGroup: (g: string | null) => void;
  refreshKey: number;
}

export function LeftPanel({
  selectedBrokerId,
  onSelectBroker,
  selectedTopic,
  onSelectTopic,
  selectedGroup,
  onSelectGroup,
  refreshKey,
}: LeftPanelProps) {
  const [configs, setConfigs] = useState<BrokerConfig[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editConfig, setEditConfig] = useState<BrokerConfig | null>(null);
  const [connStatus, setConnStatus] = useState<Record<string, ConnStatus>>({});
  const [showBrokerDropdown, setShowBrokerDropdown] = useState(false);

  // Topics
  const [topics, setTopics] = useState<TopicSummary[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(false);
  const [topicsRefreshTick, setTopicsRefreshTick] = useState(0);
  const [topicSearch, setTopicSearch] = useState('');
  const [showCreateTopic, setShowCreateTopic] = useState(false);
  const [newTopicName, setNewTopicName] = useState('');
  const [newTopicPartitions, setNewTopicPartitions] = useState('1');
  const [newTopicRf, setNewTopicRf] = useState('1');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [deletingTopic, setDeletingTopic] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ name: string; a: number; b: number } | null>(null);
  const [deleteNameInput, setDeleteNameInput] = useState('');
  const [deleteMathInput, setDeleteMathInput] = useState('');

  // Groups
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsRefreshTick, setGroupsRefreshTick] = useState(0);

  const selectedConfig = configs.find((c) => c.id === selectedBrokerId) ?? null;
  const isDisconnected = connStatus[selectedBrokerId] === 'disconnected';
  const isActive = selectedBrokerId && !isDisconnected;

  const loadConfigs = async () => {
    const cs = await kafkaApi.listConfigs();
    setConfigs(cs);
  };

  useEffect(() => { loadConfigs(); }, []);

  // Auto-test connection when broker selected (unless disconnected)
  useEffect(() => {
    if (!selectedBrokerId || connStatus[selectedBrokerId] === 'disconnected') return;
    setConnStatus((s) => ({ ...s, [selectedBrokerId]: 'testing' }));
    kafkaApi.testConnection(selectedBrokerId)
      .then(() => setConnStatus((s) => ({ ...s, [selectedBrokerId]: 'ok' })))
      .catch(() => setConnStatus((s) => ({ ...s, [selectedBrokerId]: 'error' })));
  }, [selectedBrokerId]); // eslint-disable-line

  // Load topics
  useEffect(() => {
    if (!isActive) { setTopics([]); return; }
    setTopicsLoading(true);
    kafkaApi.listTopics(selectedBrokerId)
      .then(setTopics)
      .catch(() => setTopics([]))
      .finally(() => setTopicsLoading(false));
  }, [selectedBrokerId, refreshKey, topicsRefreshTick, isActive]); // eslint-disable-line

  // Load groups
  useEffect(() => {
    if (!isActive) { setGroups([]); return; }
    setGroupsLoading(true);
    kafkaApi.listGroups(selectedBrokerId)
      .then(setGroups)
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
  }, [selectedBrokerId, refreshKey, groupsRefreshTick, isActive]); // eslint-disable-line

  const handleSaveBroker = async (config: BrokerConfig) => {
    const saved = await kafkaApi.saveConfig(config);
    await loadConfigs();
    onSelectBroker(saved.id);
    setShowForm(false);
    setEditConfig(null);
  };

  const handleDeleteBroker = async () => {
    if (!selectedBrokerId || !window.confirm(`Delete broker "${selectedConfig?.name}"?`)) return;
    await kafkaApi.deleteConfig(selectedBrokerId);
    await loadConfigs();
    onSelectBroker('');
  };

  const handleDisconnect = () => {
    setConnStatus((s) => ({ ...s, [selectedBrokerId]: 'disconnected' }));
    setTopics([]);
    setGroups([]);
    onSelectTopic(null);
    onSelectGroup(null);
  };

  const handleReconnect = () => {
    setConnStatus((s) => ({ ...s, [selectedBrokerId]: 'testing' }));
    kafkaApi.testConnection(selectedBrokerId)
      .then(() => {
        setConnStatus((s) => ({ ...s, [selectedBrokerId]: 'ok' }));
        setTopicsRefreshTick((k) => k + 1);
        setGroupsRefreshTick((k) => k + 1);
      })
      .catch(() => setConnStatus((s) => ({ ...s, [selectedBrokerId]: 'error' })));
  };

  const handleCreateTopic = async () => {
    if (!newTopicName.trim()) { setCreateError('Name required'); return; }
    const parts = parseInt(newTopicPartitions, 10);
    const rf = parseInt(newTopicRf, 10);
    if (parts < 1) { setCreateError('Partitions must be ≥ 1'); return; }
    if (rf < 1) { setCreateError('Replication factor must be ≥ 1'); return; }
    setCreating(true);
    setCreateError('');
    try {
      await kafkaApi.createTopic(selectedBrokerId, newTopicName.trim(), parts, rf);
      setShowCreateTopic(false);
      setNewTopicName('');
      setNewTopicPartitions('1');
      setNewTopicRf('1');
      setTopicsRefreshTick((k) => k + 1);
    } catch (e) {
      setCreateError(String(e));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteTopic = (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const a = Math.floor(Math.random() * 9) + 1;
    const b = Math.floor(Math.random() * 9) + 1;
    setDeleteConfirm({ name, a, b });
    setDeleteNameInput('');
    setDeleteMathInput('');
  };

  const handleDeleteTopicConfirm = async () => {
    if (!deleteConfirm) return;
    setDeletingTopic(deleteConfirm.name);
    setDeleteConfirm(null);
    try {
      await kafkaApi.deleteTopic(selectedBrokerId, deleteConfirm.name);
      if (selectedTopic === deleteConfirm.name) onSelectTopic(null);
      setTopicsRefreshTick((k) => k + 1);
    } catch (err) {
      alert(String(err));
    } finally {
      setDeletingTopic(null);
    }
  };

  const connIcon = (id: string) => {
    const s = connStatus[id] ?? 'idle';
    if (s === 'testing') return <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />;
    if (s === 'ok') return <CheckCircle className="w-3 h-3 text-green-500" />;
    if (s === 'error') return <XCircle className="w-3 h-3 text-destructive" />;
    if (s === 'disconnected') return <WifiOff className="w-3 h-3 text-muted-foreground" />;
    return <span className="w-3 h-3 rounded-full border border-muted-foreground/30 inline-block shrink-0" />;
  };

  const filteredTopics = topics.filter((t) =>
    !topicSearch || t.name.toLowerCase().includes(topicSearch.toLowerCase())
  );

  return (
    <div className="flex flex-col h-full overflow-hidden text-sm">

      {/* ── Broker section ── */}
      <div className="px-2 pt-2 pb-2 border-b shrink-0 space-y-1.5">
        {/* Dropdown trigger */}
        <div className="relative">
          <button
            className="w-full flex items-center justify-between gap-1 px-2 py-1.5 rounded-md border hover:bg-muted/50 transition-colors text-left"
            onClick={() => setShowBrokerDropdown((v) => !v)}
          >
            <span className="flex items-center gap-1.5 min-w-0">
              {selectedConfig ? connIcon(selectedConfig.id) : <span className="w-3 h-3" />}
              <span className="truncate font-medium text-xs">
                {selectedConfig?.name ?? 'Select broker…'}
              </span>
            </span>
            <ChevronDown className="w-3 h-3 text-muted-foreground shrink-0" />
          </button>

          {showBrokerDropdown && (
            <div className="absolute top-full left-0 right-0 z-20 mt-0.5 bg-popover border rounded-md shadow-lg py-1">
              {configs.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No brokers saved</div>
              )}
              {configs.map((c) => (
                <button
                  key={c.id}
                  className={cn(
                    'w-full flex items-center gap-1.5 px-3 py-1.5 text-xs hover:bg-muted/60 text-left',
                    c.id === selectedBrokerId && 'bg-muted/40 font-medium',
                  )}
                  onClick={() => { onSelectBroker(c.id); setShowBrokerDropdown(false); }}
                >
                  {connIcon(c.id)}
                  <span className="truncate">{c.name}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Broker action buttons */}
        <div className="flex gap-1">
          <button
            className="flex-1 flex items-center justify-center gap-1 py-1 text-xs rounded-md border hover:bg-muted/50 transition-colors"
            onClick={() => { setEditConfig(null); setShowForm(true); setShowBrokerDropdown(false); }}
          >
            <Plus className="w-3 h-3" /> Add
          </button>
          {selectedConfig && (
            <>
              <button
                className="px-2 py-1 text-xs rounded-md border hover:bg-muted/50 transition-colors"
                title="Edit broker"
                onClick={() => { setEditConfig(selectedConfig); setShowForm(true); setShowBrokerDropdown(false); }}
              >
                <Pencil className="w-3 h-3" />
              </button>
              {isDisconnected ? (
                <button
                  className="px-2 py-1 text-xs rounded-md border hover:bg-green-500/10 text-green-600 transition-colors flex items-center gap-1"
                  title="Reconnect"
                  onClick={handleReconnect}
                >
                  <Wifi className="w-3 h-3" />
                </button>
              ) : (
                <button
                  className="px-2 py-1 text-xs rounded-md border hover:bg-muted/50 text-muted-foreground transition-colors"
                  title="Disconnect"
                  onClick={handleDisconnect}
                >
                  <WifiOff className="w-3 h-3" />
                </button>
              )}
              <button
                className="px-2 py-1 text-xs rounded-md border hover:bg-destructive/10 text-destructive transition-colors"
                title="Delete broker"
                onClick={handleDeleteBroker}
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>

        {/* Disconnected hint */}
        {isDisconnected && (
          <p className="text-xs text-muted-foreground px-1">Disconnected — click <Wifi className="w-3 h-3 inline" /> to reconnect</p>
        )}
      </div>

      {/* ── Topics section ── */}
      <div className="flex flex-col border-b" style={{ minHeight: 0, maxHeight: '55%' }}>
        {/* Header row */}
        <div className="flex items-center justify-between px-2 py-1.5 shrink-0">
          <span className="text-xs font-medium text-muted-foreground">
            Topics{topics.length > 0 ? ` (${topics.length})` : ''}
          </span>
          {isActive && (
            <div className="flex items-center gap-1">
              <button
                className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
                title="Refresh topics"
                onClick={() => setTopicsRefreshTick((k) => k + 1)}
                disabled={topicsLoading}
              >
                <RefreshCw className={cn('w-3 h-3', topicsLoading && 'animate-spin')} />
              </button>
              <button
                className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                title="Create topic"
                onClick={() => { setShowCreateTopic((v) => !v); setCreateError(''); }}
              >
                <Plus className="w-3 h-3" /> New
              </button>
            </div>
          )}
        </div>

        {/* Inline create form */}
        {showCreateTopic && (
          <div className="mx-2 mb-1.5 p-2 border rounded-md bg-muted/20 shrink-0 space-y-2">
            <div>
              <Label className="text-xs text-muted-foreground">Topic name</Label>
              <Input
                value={newTopicName}
                onChange={(e) => setNewTopicName(e.target.value)}
                placeholder="my-topic"
                className="h-7 text-xs font-mono mt-0.5"
                onKeyDown={(e) => e.key === 'Enter' && handleCreateTopic()}
                autoFocus
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Partitions</Label>
                <Input
                  type="number"
                  min="1"
                  value={newTopicPartitions}
                  onChange={(e) => setNewTopicPartitions(e.target.value)}
                  className="h-7 text-xs mt-0.5"
                  title="Number of partitions"
                />
              </div>
              <div className="flex-1">
                <Label className="text-xs text-muted-foreground">Replication</Label>
                <Input
                  type="number"
                  min="1"
                  value={newTopicRf}
                  onChange={(e) => setNewTopicRf(e.target.value)}
                  className="h-7 text-xs mt-0.5"
                  title="Replication factor (must be ≤ number of brokers)"
                />
              </div>
            </div>
            <div className="flex gap-1">
              <Button size="sm" className="h-7 text-xs flex-1" onClick={handleCreateTopic} disabled={creating}>
                {creating ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Create'}
              </Button>
              <button
                className="px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => { setShowCreateTopic(false); setCreateError(''); }}
              >✕</button>
            </div>
            {createError && <p className="text-xs text-destructive">{createError}</p>}
          </div>
        )}

        {/* Search */}
        {isActive && (
          <div className="px-2 pb-1 shrink-0">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                value={topicSearch}
                onChange={(e) => setTopicSearch(e.target.value)}
                placeholder="Search topics…"
                className="h-7 text-xs pl-6"
              />
            </div>
          </div>
        )}

        {/* Topic list */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {filteredTopics.map((t) => (
            <div
              key={t.name}
              className={cn(
                'group flex items-center gap-1.5 px-2 py-1 hover:bg-muted/50 transition-colors cursor-pointer',
                selectedTopic === t.name && 'bg-muted',
              )}
              onClick={() => onSelectTopic(t.name)}
            >
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                selectedTopic === t.name ? 'bg-primary' : 'bg-muted-foreground/30',
              )} />
              <span className={cn(
                'truncate font-mono text-xs flex-1',
                selectedTopic === t.name && 'font-medium',
              )}>{t.name}</span>
              <span className="text-xs text-muted-foreground shrink-0 group-hover:hidden">{t.partitionCount}p</span>
              <button
                className="hidden group-hover:flex shrink-0 text-muted-foreground hover:text-destructive transition-colors p-0.5"
                title={`Delete topic "${t.name}"`}
                onClick={(e) => handleDeleteTopic(t.name, e)}
                disabled={deletingTopic === t.name}
              >
                {deletingTopic === t.name
                  ? <Loader2 className="w-3 h-3 animate-spin" />
                  : <Trash2 className="w-3 h-3" />}
              </button>
            </div>
          ))}
          {!topicsLoading && isActive && filteredTopics.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              {topicSearch ? 'No matching topics' : 'No topics'}
            </div>
          )}
        </div>
      </div>

      {/* ── Groups section ── */}
      <div className="flex flex-col flex-1 min-h-0">
        <div className="flex items-center justify-between px-2 py-1.5 shrink-0">
          <span className="text-xs font-medium text-muted-foreground">
            Groups{groups.length > 0 ? ` (${groups.length})` : ''}
          </span>
          {isActive && (
            <button
              className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              title="Refresh groups"
              onClick={() => setGroupsRefreshTick((k) => k + 1)}
              disabled={groupsLoading}
            >
              <RefreshCw className={cn('w-3 h-3', groupsLoading && 'animate-spin')} />
            </button>
          )}
        </div>

        <div className="overflow-y-auto flex-1 min-h-0">
          {groups.map((g) => (
            <button
              key={g.groupId}
              className={cn(
                'w-full flex items-center gap-1.5 px-2 py-1 text-left hover:bg-muted/50 transition-colors',
                selectedGroup === g.groupId && 'bg-muted font-medium',
              )}
              onClick={() => onSelectGroup(g.groupId)}
            >
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                GROUP_STATE_BG[g.state] ?? 'bg-muted-foreground/30',
              )} />
              <span className="truncate text-xs">{g.groupId}</span>
            </button>
          ))}
          {!groupsLoading && isActive && groups.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">No groups</div>
          )}
        </div>
      </div>

      {/* BrokerForm modal */}
      {showForm && (
        <BrokerForm
          initial={editConfig}
          onSave={handleSaveBroker}
          onCancel={() => { setShowForm(false); setEditConfig(null); }}
        />
      )}

      {/* Delete topic confirmation modal */}
      {deleteConfirm && (() => {
        const nameOk = deleteNameInput === deleteConfirm.name;
        const mathOk = parseInt(deleteMathInput, 10) === deleteConfirm.a + deleteConfirm.b;
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-background border rounded-lg shadow-xl w-80 p-4 space-y-4">
              <div>
                <h3 className="text-sm font-semibold text-destructive">Delete topic</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  This permanently deletes all messages. This cannot be undone.
                </p>
              </div>

              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
                <span className="font-mono text-sm text-destructive break-all">{deleteConfirm.name}</span>
              </div>

              <div className="space-y-3">
                <div>
                  <Label className="text-xs text-muted-foreground">Type the topic name to confirm</Label>
                  <Input
                    value={deleteNameInput}
                    onChange={(e) => setDeleteNameInput(e.target.value)}
                    placeholder={deleteConfirm.name}
                    className={cn(
                      'h-8 text-xs font-mono mt-1',
                      deleteNameInput && (nameOk ? 'border-green-500 focus-visible:ring-green-500/30' : 'border-destructive focus-visible:ring-destructive/30'),
                    )}
                    autoFocus
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">
                    What is {deleteConfirm.a} + {deleteConfirm.b}?
                  </Label>
                  <Input
                    type="number"
                    value={deleteMathInput}
                    onChange={(e) => setDeleteMathInput(e.target.value)}
                    placeholder="Answer"
                    className={cn(
                      'h-8 text-xs mt-1 w-24',
                      deleteMathInput && (mathOk ? 'border-green-500 focus-visible:ring-green-500/30' : 'border-destructive focus-visible:ring-destructive/30'),
                    )}
                    onKeyDown={(e) => e.key === 'Enter' && nameOk && mathOk && handleDeleteTopicConfirm()}
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <Button
                  variant="destructive"
                  size="sm"
                  className="flex-1 h-8 text-xs"
                  disabled={!nameOk || !mathOk}
                  onClick={handleDeleteTopicConfirm}
                >
                  Delete permanently
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => setDeleteConfirm(null)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
