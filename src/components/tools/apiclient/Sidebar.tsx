// Collections sidebar: the tree of collections → folders → requests, plus the
// environment selector and Postman import/export controls.

import { useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  CopyPlus,
  Download,
  FilePlus2,
  FolderPlus,
  Code2,
  Layers,
  MoreVertical,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ApiStore } from './store';
import type { ApiRequest, Collection, Folder, RequestScript, TreeItem } from './types';
import { importPostman, exportPostman } from './postman';
import { pickJsonFile, saveJsonFile } from './fileio';
import { methodColor } from './method-color';
import { NodeSettingsDialog, type NodeSettingsTarget } from './NodeSettingsDialog';

const emptyScript = (s?: RequestScript): RequestScript => s ?? { req: '', res: '' };

// Tree-filter predicates: a node is shown when its name (or any descendant's
// name) matches the query.
function itemMatches(item: TreeItem, q: string): boolean {
  if (item.type === 'request') return item.name.toLowerCase().includes(q);
  return item.name.toLowerCase().includes(q) || item.items.some((c) => itemMatches(c, q));
}
function collectionMatches(c: Collection, q: string): boolean {
  return c.name.toLowerCase().includes(q) || c.items.some((i) => itemMatches(i, q));
}

interface Props {
  store: ApiStore;
  searchInputRef?: React.Ref<HTMLInputElement>;
}

export function Sidebar({ store, searchInputRef }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<NodeSettingsTarget | null>(null);
  const [menu, setMenu] = useState(false);
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();

  const handleImport = async () => {
    setError(null);
    setMenu(false);
    try {
      const text = await pickJsonFile();
      if (!text) return;
      store.importCollection(importPostman(text));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const visible = store.collections.filter((c) => !q || collectionMatches(c, q));

  return (
    <div className="flex h-full w-full flex-col">
      {/* header */}
      <div className="flex items-center justify-between gap-1 border-b px-3 py-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          <Boxes className="h-4 w-4" /> Collections
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => store.addCollection()} title="New collection" className="rounded p-1.5 hover:bg-accent">
            <Plus className="h-4 w-4" />
          </button>
          <div className="relative">
            <button onClick={() => setMenu((m) => !m)} title="More" className="rounded p-1.5 hover:bg-accent">
              <MoreVertical className="h-4 w-4" />
            </button>
            {menu && (
              <Menu onClose={() => setMenu(false)}>
                <MenuItem onClick={handleImport}><Upload className="h-3.5 w-3.5" /> Import collection</MenuItem>
              </Menu>
            )}
          </div>
        </div>
      </div>

      {/* search */}
      <div className="border-b px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-md border bg-background px-2">
          <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            ref={searchInputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search"
            className="h-7 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          />
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
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches.</p>
        ) : (
          visible.map((c) => (
            <CollectionNode key={c.id} collection={c} store={store} onError={setError} onSettings={setSettings} q={q} />
          ))
        )}
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
  collection, store, onError, onSettings, q,
}: { collection: Collection; store: ApiStore; onError: (m: string | null) => void; onSettings: (t: NodeSettingsTarget) => void; q: string }) {
  const [menu, setMenu] = useState(false);
  const collapsed = !!collection.collapsed && !q;

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
      {!collapsed && collection.items.filter((it) => !q || itemMatches(it, q)).map((item) => (
        <TreeNode key={item.id} item={item} depth={1} collectionId={collection.id} store={store} onSettings={onSettings} q={q} />
      ))}
    </div>
  );
}

// ─── folder / request node ──────────────────────────────────────────────────

function TreeNode({
  item, depth, collectionId, store, onSettings, q,
}: { item: TreeItem; depth: number; collectionId: string; store: ApiStore; onSettings: (t: NodeSettingsTarget) => void; q: string }) {
  if (item.type === 'folder') return <FolderNode folder={item} depth={depth} collectionId={collectionId} store={store} onSettings={onSettings} q={q} />;
  return <RequestNode request={item} depth={depth} collectionId={collectionId} store={store} />;
}

function FolderNode({
  folder, depth, collectionId, store, onSettings, q,
}: { folder: Folder; depth: number; collectionId: string; store: ApiStore; onSettings: (t: NodeSettingsTarget) => void; q: string }) {
  const collapsed = !!folder.collapsed && !q;
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
      {!collapsed && folder.items.filter((it) => !q || itemMatches(it, q)).map((child) => (
        <TreeNode key={child.id} item={child} depth={depth + 1} collectionId={collectionId} store={store} onSettings={onSettings} q={q} />
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
        <>
          <IconBtn title="Duplicate request" onClick={() => store.duplicateRequest(collectionId, request)}><CopyPlus className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn title="Delete request" onClick={() => store.deleteItem(collectionId, request.id)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
        </>
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
