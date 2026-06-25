import { useState, useEffect } from 'react';
import {
  CheckCircle, XCircle, Loader2, Pencil, Trash2, Plus,
  ChevronDown, Search, RefreshCw, WifiOff, Wifi, Filter, List, Users,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { usePersistentState } from '@/hooks/usePersistentState';
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
  const [brokerDeleteArmed, setBrokerDeleteArmed] = useState(false);
  const [deleteError, setDeleteError] = useState('');

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

  // Topic filter — patterns persisted; "search all" toggle is local (resets to off on reopen)
  const [favouritePatterns, setFavouritePatterns] = usePersistentState<string[]>('devtool:kafka:favouritePatterns', []);
  const [showAllTopics, setShowAllTopics] = useState(false);
  const [showFavEditor, setShowFavEditor] = useState(false);
  const [newPattern, setNewPattern] = useState('');
  const [patternError, setPatternError] = useState('');

  // Groups
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsRefreshTick, setGroupsRefreshTick] = useState(0);
  const [activeList, setActiveList] = useState<'topics' | 'groups'>('topics');

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

  // Two-step delete: first click arms (button turns red), second confirms.
  const handleDeleteBroker = async () => {
    if (!selectedBrokerId) return;
    if (!brokerDeleteArmed) { setBrokerDeleteArmed(true); return; }
    setBrokerDeleteArmed(false);
    await kafkaApi.deleteConfig(selectedBrokerId);
    await loadConfigs();
    onSelectBroker('');
  };

  // Reset the armed state after a few seconds, or when the selection changes.
  useEffect(() => {
    if (!brokerDeleteArmed) return;
    const t = window.setTimeout(() => setBrokerDeleteArmed(false), 3000);
    return () => window.clearTimeout(t);
  }, [brokerDeleteArmed]);
  useEffect(() => { setBrokerDeleteArmed(false); }, [selectedBrokerId]);

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
      setDeleteError(String(err));
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

  // Detect if the search input contains regex metacharacters → treat as regex, else prefix match
  const SEARCH_REGEX_CHARS = /[\\^$.*+?()[\]{}|]/;
  const searchIsRegex = topicSearch.length > 0 && SEARCH_REGEX_CHARS.test(topicSearch);
  const searchRegexValid = searchIsRegex
    ? (() => { try { new RegExp(topicSearch, 'i'); return true; } catch { return false; } })()
    : true;

  // ── Three-layer pipeline ──
  // (1) `topics`          — every topic fetched from the broker
  // (2) `modeTopics`      — mode layer: "Filtered" keeps only topics matching a saved
  //                         regex (OR); "All topics" keeps everything. Filtered mode
  //                         requires ≥1 pattern, so with none it intentionally yields
  //                         nothing — you must opt in to seeing topics.
  // (3) `filteredTopics`  — search layer applied on top of (2)
  const inFilteredMode = !showAllTopics;
  const needsPatternSetup = inFilteredMode && favouritePatterns.length === 0;

  const modeTopics = inFilteredMode
    ? topics.filter((t) => favouritePatterns.some((p) => {
        try { return new RegExp(p).test(t.name); } catch { return false; }
      }))
    : topics;

  const filteredTopics = modeTopics.filter((t) => {
    if (!topicSearch) return true;
    // Prefix match for plain text; regex (case-insensitive) when metacharacters are present
    if (searchIsRegex) {
      if (!searchRegexValid) return false;
      try { return new RegExp(topicSearch, 'i').test(t.name); } catch { return false; }
    }
    return t.name.toLowerCase().startsWith(topicSearch.toLowerCase());
  });

  // Switch between "Filtered" and "All topics". Filtered mode needs ≥1 pattern, so
  // entering it with none open the editor; All mode hides the regex-filter UI entirely.
  const setFilterMode = (allTopics: boolean) => {
    setShowAllTopics(allTopics);
    if (allTopics) {
      setShowFavEditor(false);
    } else if (favouritePatterns.length === 0) {
      setShowFavEditor(true);
    }
  };

  const addFavPattern = () => {
    const p = newPattern.trim();
    if (!p) return;
    try { new RegExp(p); } catch { setPatternError('Invalid regex'); return; }
    setPatternError('');
    if (!favouritePatterns.includes(p)) setFavouritePatterns([...favouritePatterns, p]);
    setNewPattern('');
  };

  const removeFavPattern = (p: string) => {
    setFavouritePatterns(favouritePatterns.filter((x) => x !== p));
  };

  return (
    <div className="flex flex-col h-full overflow-hidden text-sm">

      {/* ── Broker section ── */}
      <div className="px-2 pt-2 pb-2 border-b border-border shrink-0 space-y-1.5">
        {/* Dropdown trigger */}
        <div className="relative">
          <button
            className="w-full flex items-center justify-between gap-1 px-2 py-1.5 rounded-lg border border-border hover:bg-muted/50 transition-colors text-left"
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
            <div className="absolute top-full left-0 right-0 z-20 mt-0.5 bg-popover border border-border rounded-lg shadow-lg py-1">
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
            className="flex-1 flex items-center justify-center gap-1 py-1 text-xs rounded-lg border border-border hover:bg-muted/50 transition-colors"
            onClick={() => { setEditConfig(null); setShowForm(true); setShowBrokerDropdown(false); }}
          >
            <Plus className="w-3 h-3" /> Add
          </button>
          {selectedConfig && (
            <>
              <button
                className="px-2 py-1 text-xs rounded-lg border border-border hover:bg-muted/50 transition-colors"
                title="Edit broker"
                onClick={() => { setEditConfig(selectedConfig); setShowForm(true); setShowBrokerDropdown(false); }}
              >
                <Pencil className="w-3 h-3" />
              </button>
              {isDisconnected ? (
                <button
                  className="px-2 py-1 text-xs rounded-lg border border-border hover:bg-green-500/10 text-green-600 transition-colors flex items-center gap-1"
                  title="Reconnect"
                  onClick={handleReconnect}
                >
                  <Wifi className="w-3 h-3" />
                </button>
              ) : (
                <button
                  className="px-2 py-1 text-xs rounded-lg border border-border hover:bg-muted/50 text-muted-foreground transition-colors"
                  title="Disconnect"
                  onClick={handleDisconnect}
                >
                  <WifiOff className="w-3 h-3" />
                </button>
              )}
              <button
                className={cn(
                  'px-2 py-1 text-xs rounded-lg border border-border transition-colors flex items-center gap-1',
                  brokerDeleteArmed
                    ? 'bg-destructive/10 border-destructive/40 text-destructive'
                    : 'hover:bg-destructive/10 text-destructive',
                )}
                title={brokerDeleteArmed ? 'Click again to confirm' : 'Delete broker'}
                onClick={handleDeleteBroker}
              >
                <Trash2 className="w-3 h-3" />
                {brokerDeleteArmed && <span>Confirm</span>}
              </button>
            </>
          )}
        </div>

        {/* Disconnected hint */}
        {isDisconnected && (
          <p className="text-xs text-muted-foreground px-1">Disconnected — click <Wifi className="w-3 h-3 inline" /> to reconnect</p>
        )}
      </div>

      {/* ── Tab bar: Topics | Groups (replaces the old bottom-pinned groups list) ── */}
      <div className="flex items-end justify-between px-2 pt-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1">
          <button
            className={cn(
              'flex items-center gap-1.5 px-2 pb-2 border-b-2 -mb-px transition-colors',
              activeList === 'topics'
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setActiveList('topics')}
          >
            <List className="w-3.5 h-3.5" />
            <span className="text-xs">Topics</span>
            {topics.length > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {filteredTopics.length !== topics.length ? `${filteredTopics.length}/${topics.length}` : topics.length}
              </span>
            )}
          </button>
          <button
            className={cn(
              'flex items-center gap-1.5 px-2 pb-2 border-b-2 -mb-px transition-colors',
              activeList === 'groups'
                ? 'border-primary text-foreground font-medium'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setActiveList('groups')}
          >
            <Users className="w-3.5 h-3.5" />
            <span className="text-xs">Groups</span>
            {groups.length > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">{groups.length}</span>
            )}
          </button>
        </div>
        <div className="flex items-center gap-1 pb-1.5">
          {isActive && (
            <button
              className="p-0.5 text-muted-foreground hover:text-foreground transition-colors"
              title={activeList === 'topics' ? 'Refresh topics' : 'Refresh groups'}
              onClick={() => activeList === 'topics'
                ? setTopicsRefreshTick((k) => k + 1)
                : setGroupsRefreshTick((k) => k + 1)}
              disabled={activeList === 'topics' ? topicsLoading : groupsLoading}
            >
              <RefreshCw className={cn(
                'w-3 h-3',
                (activeList === 'topics' ? topicsLoading : groupsLoading) && 'animate-spin',
              )} />
            </button>
          )}
        </div>
      </div>

      {/* ── List area: shows the active tab's content ── */}
      <div className="flex flex-col flex-1 min-h-0">
        {activeList === 'topics' && (
        <div className="flex flex-col flex-1 min-h-0">

        {/* Filter mode toggle with merged edit button — sets which topic set search runs against */}
        {isActive && (
          <div className="px-2 pt-2 pb-1.5 shrink-0">
            <div className="flex items-center w-full rounded-lg border border-border bg-muted/30 p-1 gap-1 text-xs">
              {/* Filtered side: tab + inline edit pencil share one card */}
              <div className={cn(
                'flex-1 flex items-center rounded-md transition-all',
                inFilteredMode && 'bg-background shadow-sm',
              )}>
                <button
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-1.5 pl-2.5 rounded-md transition-colors',
                    inFilteredMode ? 'text-foreground font-medium' : 'text-muted-foreground hover:text-foreground/80',
                  )}
                  title="Show only topics matching your filter patterns"
                  onClick={() => setFilterMode(false)}
                >
                  <Filter className="w-3.5 h-3.5 shrink-0" />
                  Filtered
                  {favouritePatterns.length > 0 && (
                    <span className={cn(
                      'inline-flex items-center justify-center min-w-[17px] h-[17px] px-1 rounded-full text-[10px] leading-none transition-colors',
                      inFilteredMode ? 'bg-primary text-primary-foreground' : 'bg-muted-foreground/20 text-muted-foreground',
                    )}>
                      {favouritePatterns.length}
                    </span>
                  )}
                </button>
                {inFilteredMode && (
                  <button
                    className={cn(
                      'shrink-0 flex items-center justify-center w-7 h-7 mr-0.5 rounded-md transition-colors',
                      showFavEditor ? 'bg-primary/15 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-muted/60',
                    )}
                    title={showFavEditor ? 'Close pattern editor' : 'Edit filter patterns'}
                    onClick={() => setShowFavEditor((v) => !v)}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {/* All side */}
              <button
                className={cn(
                  'flex-1 py-1.5 rounded-md transition-all',
                  !inFilteredMode
                    ? 'bg-background shadow-sm text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground/80',
                )}
                title="Show every topic in the cluster"
                onClick={() => setFilterMode(true)}
              >
                All
              </button>
            </div>
          </div>
        )}

        {/* Setup nudge — sits directly under the toggle when filtered mode has no patterns */}
        {isActive && needsPatternSetup && !showFavEditor && (
          <div className="mx-2 mb-1.5 flex items-center gap-2 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1.5 shrink-0">
            <Filter className="w-3 h-3 text-amber-500 shrink-0" />
            <span className="text-xs text-amber-600/90 flex-1">Add a filter pattern, or switch to All topics</span>
            <button
              className="text-xs font-medium text-amber-600 hover:text-amber-700 shrink-0"
              onClick={() => setShowFavEditor(true)}
            >
              Add
            </button>
          </div>
        )}

        {/* Filter pattern editor — placed directly below the toggle it belongs to */}
        {isActive && inFilteredMode && showFavEditor && (
          <div className="mx-2 mb-1.5 p-2 border border-border rounded-lg bg-muted/10 shrink-0 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">Topic filters <span className="text-muted-foreground font-normal">(regex, OR)</span></span>
              <button className="text-muted-foreground hover:text-foreground text-xs" onClick={() => setShowFavEditor(false)}>✕</button>
            </div>
            {favouritePatterns.length === 0 && (
              <p className="text-xs text-muted-foreground">Add patterns — only matching topics will be shown by default.</p>
            )}
            {favouritePatterns.map((p) => {
              const matchCount = topics.filter((t) => { try { return new RegExp(p).test(t.name); } catch { return false; } }).length;
              return (
                <div key={p} className="flex items-center gap-1.5 rounded-md bg-muted/40 px-2 py-1">
                  <span className="font-mono text-xs flex-1 truncate text-foreground">{p}</span>
                  {topics.length > 0 && (
                    <span className="text-[10px] text-muted-foreground shrink-0" title={`${matchCount} topic${matchCount !== 1 ? 's' : ''} match this pattern`}>
                      {matchCount}t
                    </span>
                  )}
                  <button
                    className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                    onClick={() => removeFavPattern(p)}
                    title="Remove pattern"
                  >
                    <XCircle className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
            <div className="flex gap-1">
              <Input
                value={newPattern}
                onChange={(e) => { setNewPattern(e.target.value); setPatternError(''); }}
                placeholder="e.g. ^prod\. or \.events$"
                className="h-7 text-xs font-mono flex-1"
                onKeyDown={(e) => e.key === 'Enter' && addFavPattern()}
                autoFocus={favouritePatterns.length === 0}
              />
              <Button size="sm" className="h-7 text-xs px-2 shrink-0" onClick={addFavPattern}>Add</Button>
            </div>
            {patternError && <p className="text-xs text-destructive">{patternError}</p>}
          </div>
        )}

        {/* Search + create — topic-only actions, kept under the Topics tab */}
        {isActive && (
          <div className="flex items-center gap-1.5 px-2 pb-1 shrink-0">
            <div className="relative flex-1">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
              <Input
                value={topicSearch}
                onChange={(e) => setTopicSearch(e.target.value)}
                placeholder="Search topics…"
                className={cn(
                  'h-7 text-xs pl-6',
                  topicSearch ? 'pr-16' : '',
                  searchIsRegex && !searchRegexValid && 'border-destructive/60 focus-visible:ring-destructive/20',
                )}
                onKeyDown={(e) => { if (e.key === 'Escape') setTopicSearch(''); }}
              />
              {topicSearch && (
                <span
                  className={cn(
                    'absolute right-1.5 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded-md text-[10px] font-medium leading-none cursor-pointer select-none transition-colors',
                    searchIsRegex
                      ? searchRegexValid
                        ? 'bg-violet-500/15 text-violet-400 hover:bg-violet-500/25'
                        : 'bg-destructive/15 text-destructive hover:bg-destructive/25'
                      : 'bg-muted text-muted-foreground hover:bg-muted/60',
                  )}
                  title="Click to clear"
                  onClick={() => setTopicSearch('')}
                >
                  {searchIsRegex ? (searchRegexValid ? '.*' : '!regex') : 'ab|'}
                </span>
              )}
            </div>
            <button
              className={cn(
                'shrink-0 flex items-center gap-1 h-7 px-2 rounded-md border text-xs transition-colors',
                showCreateTopic
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border text-muted-foreground hover:text-foreground hover:bg-muted/60',
              )}
              title="Create topic"
              onClick={() => { setShowCreateTopic((v) => !v); setCreateError(''); }}
            >
              <Plus className="w-3.5 h-3.5" /> New
            </button>
          </div>
        )}

        {/* Inline create form — opens right under the New button */}
        {isActive && showCreateTopic && (
          <div className="mx-2 mb-1.5 p-2 border border-border rounded-lg bg-muted/10 shrink-0 space-y-2">
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

        {/* Delete error banner */}
        {deleteError && (
          <div className="mx-2 mb-1.5 flex items-start gap-1.5 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-1.5 shrink-0">
            <XCircle className="w-3 h-3 mt-0.5 shrink-0 text-destructive" />
            <span className="flex-1 text-xs text-destructive break-words">{deleteError}</span>
            <button
              className="shrink-0 text-destructive/70 hover:text-destructive transition-colors"
              title="Dismiss"
              onClick={() => setDeleteError('')}
            >
              ✕
            </button>
          </div>
        )}

        {/* Topic list */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {filteredTopics.map((t) => (
            <div
              key={t.name}
              className={cn(
                'group flex items-center gap-2 px-2 py-1.5 hover:bg-muted/50 transition-colors cursor-pointer',
                selectedTopic === t.name && 'bg-muted',
              )}
              onClick={() => onSelectTopic(t.name)}
            >
              <span className={cn(
                'w-1.5 h-1.5 rounded-full shrink-0',
                selectedTopic === t.name ? 'bg-primary' : 'bg-muted-foreground/30',
              )} />
              <span className={cn(
                'truncate font-mono text-xs flex-1 text-foreground',
                selectedTopic === t.name && 'font-medium',
              )}>{t.name}</span>
              <span className="text-[11px] text-muted-foreground/70 shrink-0 group-hover:hidden">{t.partitionCount}p</span>
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
              {topicSearch && !searchRegexValid
                ? <span className="text-destructive">Invalid regex pattern</span>
                : needsPatternSetup
                  ? <span><button className="underline hover:text-foreground" onClick={() => setShowFavEditor(true)}>Add a filter pattern</button> or <button className="underline hover:text-foreground" onClick={() => setFilterMode(true)}>show all topics</button></span>
                  : topicSearch
                    ? 'No topics match this search'
                    : inFilteredMode
                      ? <span>No topics match your filters — <button className="underline hover:text-foreground" onClick={() => setFilterMode(true)}>show all</button></span>
                      : 'No topics'}
            </div>
          )}
        </div>
        </div>
        )}

        {/* Groups tab content */}
        {activeList === 'groups' && (
          <div className="overflow-y-auto flex-1 min-h-0">
            {groups.map((g) => (
              <button
                key={g.groupId}
                className={cn(
                  'w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted/50 transition-colors',
                  selectedGroup === g.groupId && 'bg-muted font-medium',
                )}
                onClick={() => onSelectGroup(g.groupId)}
                title={g.state}
              >
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  GROUP_STATE_BG[g.state] ?? 'bg-muted-foreground/30',
                )} />
                <span className="truncate text-xs font-mono flex-1">{g.groupId}</span>
                <span className="text-[10px] text-muted-foreground shrink-0">{g.state}</span>
              </button>
            ))}
            {groupsLoading && (
              <div className="px-3 py-2 text-xs text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading groups…
              </div>
            )}
            {!groupsLoading && isActive && groups.length === 0 && (
              <div className="px-3 py-2 text-xs text-muted-foreground">No consumer groups</div>
            )}
          </div>
        )}
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
