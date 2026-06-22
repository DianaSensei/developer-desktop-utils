// Collections sidebar: the tree of collections → folders → requests, with a
// search filter, hover actions, and a Bruno-style right-click context menu.

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  CopyPlus,
  Download,
  FilePlus2,
  FolderPlus,
  Code2,
  Layers,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import type { ApiStore } from './store';
import { type ApiRequest, type Auth, type Collection, type Folder, type RequestScript, type TreeItem, newAuth, normalizeRequest } from './types';
import { importPostman, exportPostman } from './postman';
import { pickJsonFile, saveJsonFile } from './fileio';
import { methodBadgeStyle } from './method-color';
import { NodeSettingsDialog, type NodeSettingsTarget } from './NodeSettingsDialog';
import { ImportCurlDialog } from './ImportCurlDialog';

const emptyScript = (s?: RequestScript): RequestScript => s ?? { req: '', res: '' };
const inheritAuth = (a?: Auth): Auth => a ?? newAuth();

// Flatten all requests under a list of tree items (depth-first), normalized for
// the engine.
function flattenRequests(items: TreeItem[]): ApiRequest[] {
  const out: ApiRequest[] = [];
  for (const it of items) {
    if (it.type === 'request') out.push(normalizeRequest(it));
    else out.push(...flattenRequests(it.items));
  }
  return out;
}

function itemMatches(item: TreeItem, q: string): boolean {
  if (item.type === 'request') return item.name.toLowerCase().includes(q);
  return item.name.toLowerCase().includes(q) || item.items.some((c) => itemMatches(c, q));
}
function collectionMatches(c: Collection, q: string): boolean {
  return c.name.toLowerCase().includes(q) || c.items.some((i) => itemMatches(i, q));
}

// One entry in a context menu. `sep` draws a divider above the item.
interface MenuEntry {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
  sep?: boolean;
}

// Shared bits threaded to every tree node so prop lists stay small. Kept stable
// across renders (see useMemo below) so React.memo'd nodes only re-render when
// their own item changes. `storeRef` holds the latest store without forcing a
// new ctx identity each render; `activeRequestId` is the one reactive field
// nodes read, so it lives directly on ctx.
interface NodeCtx {
  storeRef: React.MutableRefObject<ApiStore>;
  activeRequestId: string | null;
  q: string;
  onError: (m: string | null) => void;
  onSettings: (t: NodeSettingsTarget) => void;
  openMenu: (e: React.MouseEvent, entries: MenuEntry[]) => void;
  editingId: string | null;
  setEditingId: (id: string | null) => void;
  onRun: (title: string, requests: ApiRequest[]) => void;
  dragId: string | null;
  dropTarget: DropTarget | null;
  setDragId: (id: string | null) => void;
  setDropTarget: (t: DropTarget | null) => void;
  onDrop: () => void;
}

type DropTarget = { id: string; where: 'before' | 'after' | 'inside' };

interface Props {
  store: ApiStore;
  searchInputRef?: React.Ref<HTMLInputElement>;
  onRun: (title: string, requests: ApiRequest[]) => void;
}

export function Sidebar({ store, searchInputRef, onRun }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [settings, setSettings] = useState<NodeSettingsTarget | null>(null);
  const [headerMenu, setHeaderMenu] = useState(false);
  const [curlOpen, setCurlOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; entries: MenuEntry[] } | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const q = query.trim().toLowerCase();

  // Latest store kept in a ref so the node context's identity doesn't change on
  // every render (store is a fresh object each render). Nodes read the current
  // store via storeRef.current when they actually render.
  const storeRef = useRef(store);
  storeRef.current = store;

  const onDrop = useCallback(() => {
    if (dragId && dropTarget) storeRef.current.moveItem(dragId, dropTarget.id, dropTarget.where);
    setDragId(null);
    setDropTarget(null);
  }, [dragId, dropTarget]);

  const handleImport = async () => {
    setError(null);
    setHeaderMenu(false);
    try {
      const text = await pickJsonFile();
      if (!text) return;
      store.importCollection(importPostman(text));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const openMenu = useCallback((e: React.MouseEvent, entries: MenuEntry[]) => {
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, entries });
  }, []);

  // Environment variables, for {{var}} highlighting in collection/folder auth.
  const envVars = useMemo(() => {
    const m: Record<string, string> = {};
    if (store.activeEnv) for (const v of store.activeEnv.variables) if (v.enabled && v.key) m[v.key] = v.value;
    return m;
  }, [store.activeEnv]);

  const nodeCtx: NodeCtx = useMemo(() => ({
    storeRef, activeRequestId: store.activeRequestId, q, onError: setError, onSettings: setSettings,
    openMenu, editingId, setEditingId, onRun, dragId, dropTarget, setDragId, setDropTarget, onDrop,
  }), [store.activeRequestId, q, openMenu, editingId, onRun, dragId, dropTarget, onDrop]);
  const visible = store.collections.filter((c) => !q || collectionMatches(c, q));

  return (
    <div className="flex h-full w-full flex-col">
      {/* header */}
      <div className="flex items-center justify-between gap-1 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/70">
          <Boxes className="h-3.5 w-3.5" /> Collections
        </div>
        <div className="flex items-center gap-0.5">
          <button onClick={() => store.addCollection()} title="New collection" className="rounded p-1.5 hover:bg-accent">
            <Plus className="h-4 w-4" />
          </button>
          <div className="relative">
            <button onClick={() => setHeaderMenu((m) => !m)} title="More" className="rounded p-1.5 hover:bg-accent">
              <MoreVertical className="h-4 w-4" />
            </button>
            {headerMenu && (
              <Menu onClose={() => setHeaderMenu(false)}>
                <MenuItem onClick={handleImport}><Upload className="h-3.5 w-3.5" /> Import collection</MenuItem>
                <MenuItem onClick={() => { setHeaderMenu(false); setCurlOpen(true); }}><Code2 className="h-3.5 w-3.5" /> Import cURL</MenuItem>
              </Menu>
            )}
          </div>
        </div>
      </div>

      {/* search */}
      <div className="border-b border-border px-2 py-1.5">
        <div className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2">
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
        <div className="border-b border-destructive/20 bg-destructive/8 px-3 py-1.5 text-[11px] text-destructive">{error}</div>
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
          visible.map((c) => <CollectionNode key={c.id} collection={c} ctx={nodeCtx} />)
        )}
      </div>

      {settings && (
        <NodeSettingsDialog target={settings} onSave={store.setNodeScript} onSaveAuth={store.setNodeAuth} onClose={() => setSettings(null)} vars={envVars} />
      )}
      {ctx && <ContextMenu x={ctx.x} y={ctx.y} entries={ctx.entries} onClose={() => setCtx(null)} />}
      <ImportCurlDialog store={store} open={curlOpen} onClose={() => setCurlOpen(false)} />
    </div>
  );
}

// ─── collection node ────────────────────────────────────────────────────────

const CollectionNode = memo(function CollectionNode({ collection, ctx }: { collection: Collection; ctx: NodeCtx }) {
  const store = ctx.storeRef.current;
  const collapsed = !!collection.collapsed && !ctx.q;

  const handleExport = async () => {
    ctx.onError(null);
    try {
      const json = JSON.stringify(exportPostman(collection), null, 2);
      await saveJsonFile(`${collection.name || 'collection'}.postman_collection.json`, json);
    } catch (e) {
      ctx.onError((e as Error).message);
    }
  };

  const entries: MenuEntry[] = [
    { icon: <FilePlus2 className="h-3.5 w-3.5" />, label: 'New Request', onClick: () => store.addItem(collection.id, 'request') },
    { icon: <FolderPlus className="h-3.5 w-3.5" />, label: 'New Folder', onClick: () => store.addItem(collection.id, 'folder') },
    { icon: <Play className="h-3.5 w-3.5" />, label: 'Run', sep: true, onClick: () => ctx.onRun(collection.name, flattenRequests(collection.items)) },
    { icon: <CopyPlus className="h-3.5 w-3.5" />, label: 'Clone', sep: true, onClick: () => store.cloneCollection(collection.id) },
    { icon: <Pencil className="h-3.5 w-3.5" />, label: 'Rename', onClick: () => ctx.setEditingId(collection.id) },
    { icon: <Download className="h-3.5 w-3.5" />, label: 'Export (Postman)', onClick: handleExport },
    { icon: <Code2 className="h-3.5 w-3.5" />, label: 'Settings…', onClick: () => ctx.onSettings({ collectionId: collection.id, nodeId: null, name: collection.name, kind: 'Collection', script: emptyScript(collection.script), auth: inheritAuth(collection.auth) }) },
    { icon: <ChevronsDownUp className="h-3.5 w-3.5" />, label: collapsed ? 'Expand' : 'Collapse', onClick: () => store.toggleCollapse(collection.id) },
    { icon: <X className="h-3.5 w-3.5" />, label: 'Remove', danger: true, sep: true, onClick: () => store.deleteCollection(collection.id) },
  ];

  return (
    <div>
      <Row
        ctx={ctx}
        id={collection.id}
        container
        depth={0}
        collapsed={collapsed}
        hasChildren
        icon={<Layers className="h-3.5 w-3.5 text-muted-foreground" />}
        name={collection.name}
        onToggle={() => store.toggleCollapse(collection.id)}
        onRename={(name) => store.renameCollection(collection.id, name)}
        entries={entries}
        actions={
          <>
            <IconBtn title="Add request" onClick={() => store.addItem(collection.id, 'request')}><FilePlus2 className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Add folder" onClick={() => store.addItem(collection.id, 'folder')}><FolderPlus className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="More" onClick={(e) => ctx.openMenu(e, entries)}><MoreVertical className="h-3.5 w-3.5" /></IconBtn>
          </>
        }
      />
      {!collapsed && collection.items.filter((it) => !ctx.q || itemMatches(it, ctx.q)).map((item) => (
        <TreeNode key={item.id} item={item} depth={1} collectionId={collection.id} ctx={ctx} />
      ))}
    </div>
  );
});

// ─── folder / request node ──────────────────────────────────────────────────

function TreeNode({ item, depth, collectionId, ctx }: { item: TreeItem; depth: number; collectionId: string; ctx: NodeCtx }) {
  if (item.type === 'folder') return <FolderNode folder={item} depth={depth} collectionId={collectionId} ctx={ctx} />;
  return <RequestNode request={item} depth={depth} collectionId={collectionId} ctx={ctx} />;
}

const FolderNode = memo(function FolderNode({ folder, depth, collectionId, ctx }: { folder: Folder; depth: number; collectionId: string; ctx: NodeCtx }) {
  const store = ctx.storeRef.current;
  const collapsed = !!folder.collapsed && !ctx.q;

  const entries: MenuEntry[] = [
    { icon: <FilePlus2 className="h-3.5 w-3.5" />, label: 'New Request', onClick: () => store.addItem(collectionId, 'request', folder.id) },
    { icon: <FolderPlus className="h-3.5 w-3.5" />, label: 'New Folder', onClick: () => store.addItem(collectionId, 'folder', folder.id) },
    { icon: <Play className="h-3.5 w-3.5" />, label: 'Run', sep: true, onClick: () => ctx.onRun(folder.name, flattenRequests(folder.items)) },
    { icon: <CopyPlus className="h-3.5 w-3.5" />, label: 'Clone', sep: true, onClick: () => store.cloneItem(collectionId, folder.id) },
    { icon: <Pencil className="h-3.5 w-3.5" />, label: 'Rename', onClick: () => ctx.setEditingId(folder.id) },
    { icon: <Code2 className="h-3.5 w-3.5" />, label: 'Settings…', onClick: () => ctx.onSettings({ collectionId, nodeId: folder.id, name: folder.name, kind: 'Folder', script: emptyScript(folder.script), auth: inheritAuth(folder.auth) }) },
    { icon: <ChevronsDownUp className="h-3.5 w-3.5" />, label: collapsed ? 'Expand' : 'Collapse', onClick: () => store.toggleCollapse(collectionId, folder.id) },
    { icon: <X className="h-3.5 w-3.5" />, label: 'Remove', danger: true, sep: true, onClick: () => store.deleteItem(collectionId, folder.id) },
  ];

  return (
    <div>
      <Row
        ctx={ctx}
        id={folder.id}
        container
        depth={depth}
        collapsed={collapsed}
        hasChildren
        name={folder.name}
        onToggle={() => store.toggleCollapse(collectionId, folder.id)}
        onRename={(name) => store.renameItem(folder.id, name)}
        entries={entries}
        actions={
          <>
            <IconBtn title="Add request" onClick={() => store.addItem(collectionId, 'request', folder.id)}><FilePlus2 className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="Add folder" onClick={() => store.addItem(collectionId, 'folder', folder.id)}><FolderPlus className="h-3.5 w-3.5" /></IconBtn>
            <IconBtn title="More" onClick={(e) => ctx.openMenu(e, entries)}><MoreVertical className="h-3.5 w-3.5" /></IconBtn>
          </>
        }
      />
      {!collapsed && folder.items.filter((it) => !ctx.q || itemMatches(it, ctx.q)).map((child) => (
        <TreeNode key={child.id} item={child} depth={depth + 1} collectionId={collectionId} ctx={ctx} />
      ))}
    </div>
  );
});

const RequestNode = memo(function RequestNode({ request, depth, collectionId, ctx }: { request: ApiRequest; depth: number; collectionId: string; ctx: NodeCtx }) {
  const store = ctx.storeRef.current;
  const active = ctx.activeRequestId === request.id;

  const entries: MenuEntry[] = [
    { icon: <CopyPlus className="h-3.5 w-3.5" />, label: 'Clone', onClick: () => store.cloneItem(collectionId, request.id) },
    { icon: <Pencil className="h-3.5 w-3.5" />, label: 'Rename', onClick: () => ctx.setEditingId(request.id) },
    { icon: <X className="h-3.5 w-3.5" />, label: 'Remove', danger: true, sep: true, onClick: () => store.deleteItem(collectionId, request.id) },
  ];

  return (
    <Row
      ctx={ctx}
      id={request.id}
      depth={depth}
      active={active}
      badge={
        <span className={cn('shrink-0 rounded px-1 py-px text-[9px] font-bold uppercase tracking-wide', methodBadgeStyle(request.method))}>
          {request.method}
        </span>
      }
      name={request.name}
      onClick={() => store.selectRequest(request.id)}
      onRename={(name) => store.renameItem(request.id, name)}
      entries={entries}
      actions={
        <>
          <IconBtn title="Clone" onClick={() => store.cloneItem(collectionId, request.id)}><CopyPlus className="h-3.5 w-3.5" /></IconBtn>
          <IconBtn title="Remove" onClick={() => store.deleteItem(collectionId, request.id)}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
        </>
      }
    />
  );
});

// ─── generic row (selectable + inline-renamable) ────────────────────────────

interface RowProps {
  ctx: NodeCtx;
  id: string;
  depth: number;
  name: string;
  onRename: (name: string) => void;
  entries: MenuEntry[];
  active?: boolean;
  container?: boolean;
  collapsed?: boolean;
  hasChildren?: boolean;
  icon?: React.ReactNode;
  badge?: React.ReactNode;
  actions?: React.ReactNode;
  onClick?: () => void;
  onToggle?: () => void;
}

function Row({
  ctx, id, depth, name, onRename, entries, active, container, collapsed, hasChildren, icon, badge, actions, onClick, onToggle,
}: RowProps) {
  const editing = ctx.editingId === id;
  const [draft, setDraft] = useState(name);

  useEffect(() => { if (editing) setDraft(name); }, [editing, name]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== name) onRename(v);
    ctx.setEditingId(null);
  };

  const dragging = ctx.dragId === id;
  const dt = ctx.dragId && ctx.dropTarget?.id === id ? ctx.dropTarget : null;

  return (
    <div
      draggable={!editing}
      onDragStart={(e) => { e.stopPropagation(); ctx.setDragId(id); e.dataTransfer.effectAllowed = 'move'; }}
      onDragEnd={() => { ctx.setDragId(null); ctx.setDropTarget(null); }}
      onDragOver={(e) => {
        if (!ctx.dragId || ctx.dragId === id) return;
        e.preventDefault();
        let where: DropTarget['where'] = 'after';
        if (container) where = 'inside';
        else { const r = e.currentTarget.getBoundingClientRect(); where = e.clientY < r.top + r.height / 2 ? 'before' : 'after'; }
        if (ctx.dropTarget?.id !== id || ctx.dropTarget?.where !== where) ctx.setDropTarget({ id, where });
      }}
      onDrop={(e) => { e.preventDefault(); e.stopPropagation(); ctx.onDrop(); }}
      className={cn(
        'group relative flex items-center gap-1.5 py-[5px] pr-1 text-xs cursor-pointer transition-colors hover:bg-accent/60',
        active && 'bg-accent/80 text-foreground',
        dragging && 'opacity-40',
        dt?.where === 'inside' && 'bg-primary/10 ring-1 ring-inset ring-primary/40',
      )}
      style={{ paddingLeft: 6 + depth * 12 }}
      onClick={hasChildren ? onToggle : onClick}
      onContextMenu={(e) => ctx.openMenu(e, entries)}
    >
      {/* Bruno-style left accent stripe on the active request */}
      {active && <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-r-full bg-amber-400" />}
      {dt?.where === 'before' && <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-primary" />}
      {dt?.where === 'after' && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary" />}
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
            if (e.key === 'Escape') ctx.setEditingId(null);
          }}
          onClick={(e) => e.stopPropagation()}
          className="h-6 flex-1 px-1 text-xs"
        />
      ) : (
        <span className="flex-1 truncate" onDoubleClick={(e) => { e.stopPropagation(); ctx.setEditingId(id); }}>
          {name}
        </span>
      )}
      <div className="flex items-center opacity-0 group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        {actions}
      </div>
    </div>
  );
}

function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button type="button" title={title} onClick={onClick} className="rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground">
      {children}
    </button>
  );
}

// ─── context menu (right-click / “more”) ─────────────────────────────────────

function ContextMenu({ x, y, entries, onClose }: { x: number; y: number; entries: MenuEntry[]; onClose: () => void }) {
  const width = 220;
  const height = entries.length * 32 + 8;
  const left = Math.min(x, window.innerWidth - width - 8);
  const top = Math.min(y, Math.max(8, window.innerHeight - height - 8));
  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} onContextMenu={(e) => { e.preventDefault(); onClose(); }} />
      <div className="fixed z-[61] rounded-lg border border-border bg-popover p-1 shadow-lg" style={{ left, top, width }}>
        {entries.map((en, i) => (
          <div key={i}>
            {en.sep && i > 0 && <div className="my-1 border-t" />}
            <button
              type="button"
              onClick={() => { en.onClick(); onClose(); }}
              className={cn(
                'flex w-full items-center gap-2.5 rounded px-2 py-1.5 text-left text-xs hover:bg-accent',
                en.danger && 'text-destructive',
              )}
            >
              {en.icon}{en.label}
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

// Tiny popover menu with a click-away backdrop (header "more").
function Menu({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 z-50 mt-1 w-44 rounded-lg border border-border bg-popover p-1 shadow-md">{children}</div>
    </>
  );
}

function MenuItem({ children, onClick }: { children: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-accent">
      {children}
    </button>
  );
}
