// Collections sidebar: the tree of collections → folders → requests, plus the
// environment selector and Postman import/export controls.

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FilePlus2,
  FolderPlus,
  Code2,
  Layers,
  MoreVertical,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import type { ApiStore } from './store';
import type { ApiRequest, Collection, Folder, RequestScript, TreeItem } from './types';
import { importPostman, exportPostman } from './postman';
import { pickJsonFile, saveJsonFile } from './fileio';
import { methodColor } from './method-color';
import { NodeSettingsDialog, type NodeSettingsTarget } from './NodeSettingsDialog';

const emptyScript = (s?: RequestScript): RequestScript => s ?? { req: '', res: '' };

interface Props {
  store: ApiStore;
  onManageEnvironments: () => void;
}

export function Sidebar({ store, onManageEnvironments }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<NodeSettingsTarget | null>(null);

  const handleImport = async () => {
    setError(null);
    try {
      const text = await pickJsonFile();
      if (!text) return;
      store.importCollection(importPostman(text));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r">
      {/* header */}
      <div className="flex items-center justify-between gap-1 border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Collections</span>
        <div className="flex items-center gap-0.5">
          <button onClick={handleImport} title="Import Postman collection" className="rounded p-1.5 hover:bg-accent">
            <Upload className="h-4 w-4" />
          </button>
          <button onClick={() => store.addCollection()} title="New collection" className="rounded p-1.5 hover:bg-accent">
            <Plus className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <div className="border-b bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">{error}</div>
      )}

      {/* tree */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {store.collections.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">
            No collections yet. Create one or import a Postman file.
          </p>
        ) : (
          store.collections.map((c) => (
            <CollectionNode key={c.id} collection={c} store={store} onError={setError} onSettings={setSettings} />
          ))
        )}
      </div>

      {/* environment selector */}
      <div className="border-t p-2">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Environment</span>
          <button onClick={onManageEnvironments} className="text-[11px] text-primary hover:underline">Manage</button>
        </div>
        <Select
          value={store.activeEnvId ?? 'none'}
          onValueChange={(v) => store.setActiveEnvId(v === 'none' ? null : v)}
        >
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder="No environment" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No environment</SelectItem>
            {store.environments.map((e) => (
              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {settings && (
        <NodeSettingsDialog
          target={settings}
          onSave={store.setNodeScript}
          onClose={() => setSettings(null)}
        />
      )}
    </div>
  );
}

// ─── collection node ────────────────────────────────────────────────────────

function CollectionNode({
  collection, store, onError, onSettings,
}: { collection: Collection; store: ApiStore; onError: (m: string | null) => void; onSettings: (t: NodeSettingsTarget) => void }) {
  const [menu, setMenu] = useState(false);
  const collapsed = !!collection.collapsed;

  const handleExport = async () => {
    onError(null);
    try {
      const json = JSON.stringify(exportPostman(collection), null, 2);
      await saveJsonFile(`${collection.name || 'collection'}.postman_collection.json`, json);
    } catch (e) {
      onError((e as Error).message);
    }
    setMenu(false);
  };

  return (
    <div>
      <Row
        depth={0}
        collapsed={collapsed}
        hasChildren
        icon={<Layers className="h-3.5 w-3.5 text-muted-foreground" />}
        name={collection.name}
        onToggle={() => store.toggleCollapse(collection.id)}
        onRename={(name) => store.renameCollection(collection.id, name)}
        actions={
          <>
            <IconBtn title="Add request" onClick={() => store.addItem(collection.id, 'request')}><FilePlus2 className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Add folder" onClick={() => store.addItem(collection.id, 'folder')}><FolderPlus className="h-3.5 w-3.5" /></IconBtn>
            <div className="relative">
              <IconBtn title="More" onClick={() => setMenu((m) => !m)}><MoreVertical className="h-3.5 w-3.5" /></IconBtn>
              {menu && (
                <Menu onClose={() => setMenu(false)}>
                  <MenuItem onClick={() => { onSettings({ collectionId: collection.id, nodeId: null, name: collection.name, kind: 'Collection', script: emptyScript(collection.script) }); setMenu(false); }}>
                    <Code2 className="h-3.5 w-3.5" /> Scripts…
                  </MenuItem>
                  <MenuItem onClick={handleExport}><Download className="h-3.5 w-3.5" /> Export (Postman)</MenuItem>
                  <MenuItem destructive onClick={() => { store.deleteCollection(collection.id); setMenu(false); }}>
                    <Trash2 className="h-3.5 w-3.5" /> Delete collection
                  </MenuItem>
                </Menu>
              )}
            </div>
          </>
        }
      />
      {!collapsed && collection.items.map((item) => (
        <TreeNode key={item.id} item={item} depth={1} collectionId={collection.id} store={store} onSettings={onSettings} />
      ))}
    </div>
  );
}

// ─── folder / request node ──────────────────────────────────────────────────

function TreeNode({
  item, depth, collectionId, store, onSettings,
}: { item: TreeItem; depth: number; collectionId: string; store: ApiStore; onSettings: (t: NodeSettingsTarget) => void }) {
  if (item.type === 'folder') return <FolderNode folder={item} depth={depth} collectionId={collectionId} store={store} onSettings={onSettings} />;
  return <RequestNode request={item} depth={depth} collectionId={collectionId} store={store} />;
}

function FolderNode({
  folder, depth, collectionId, store, onSettings,
}: { folder: Folder; depth: number; collectionId: string; store: ApiStore; onSettings: (t: NodeSettingsTarget) => void }) {
  const collapsed = !!folder.collapsed;
  return (
    <div>
      <Row
        depth={depth}
        collapsed={collapsed}
        hasChildren
        icon={<ChevronRight className="hidden" />}
        name={folder.name}
        onToggle={() => store.toggleCollapse(collectionId, folder.id)}
        onRename={(name) => store.renameItem(folder.id, name)}
        actions={
          <>
            <IconBtn title="Add request" onClick={() => store.addItem(collectionId, 'request', folder.id)}><FilePlus2 className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Add folder" onClick={() => store.addItem(collectionId, 'folder', folder.id)}><FolderPlus className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Folder scripts" onClick={() => onSettings({ collectionId, nodeId: folder.id, name: folder.name, kind: 'Folder', script: emptyScript(folder.script) })}><Code2 className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Delete folder" onClick={() => store.deleteItem(collectionId, folder.id)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
          </>
        }
      />
      {!collapsed && folder.items.map((child) => (
        <TreeNode key={child.id} item={child} depth={depth + 1} collectionId={collectionId} store={store} onSettings={onSettings} />
      ))}
    </div>
  );
}

function RequestNode({
  request, depth, collectionId, store,
}: { request: ApiRequest; depth: number; collectionId: string; store: ApiStore }) {
  const active = store.activeRequestId === request.id;
  return (
    <Row
      depth={depth}
      active={active}
      badge={<span className={cn('w-10 shrink-0 text-[9px] font-bold uppercase', methodColor(request.method))}>{request.method}</span>}
      name={request.name}
      onClick={() => store.selectRequest(request.id)}
      onRename={(name) => store.renameItem(request.id, name)}
      actions={
        <IconBtn title="Delete request" onClick={() => store.deleteItem(collectionId, request.id)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
      }
    />
  );
}

// ─── generic row (selectable + inline-renamable) ────────────────────────────

interface RowProps {
  depth: number;
  name: string;
  onRename: (name: string) => void;
  active?: boolean;
  collapsed?: boolean;
  hasChildren?: boolean;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  onToggle?: () => void;
}

function Row({
  depth, name, onRename, active, collapsed, hasChildren, icon, badge, actions, onClick, onToggle,
}: RowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== name) onRename(v);
    else setDraft(name);
    setEditing(false);
  };

  return (
    <div
      className={cn(
        'group flex items-center gap-1 py-1 pr-1 text-xs cursor-pointer hover:bg-accent/60',
        active && 'bg-accent',
      )}
      style={{ paddingLeft: 6 + depth * 12 }}
      onClick={hasChildren ? onToggle : onClick}
    >
      {hasChildren ? (
        collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <span className="w-0 shrink-0" />
      )}
      {icon}
      {badge}
      {editing ? (
        <Input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') { setDraft(name); setEditing(false); }
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-6 flex-1 px-1 text-xs"
        />
      ) : (
        <span
          className="flex-1 truncate"
          onDoubleClick={(e) => { e.stopPropagation(); setDraft(name); setEditing(true); }}
        >
          {name}
        </span>
      )}
      <div className="flex items-center opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        {actions}
      </div>
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button type="button" title={title} onClick={onClick} className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground">
      {children}
    </button>
  );
}

// Tiny popover menu with a click-away backdrop.
function Menu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 z-50 mt-1 w-44 rounded-md border bg-popover p-1 shadow-md">{children}</div>
    </>
  );
}

function MenuItem({ children, onClick, destructive }: { children: React.ReactNode; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent',
        destructive && 'text-destructive',
      )}
    >
      {children}
    </button>
  );
}
