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
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { IconButton } from '@/components/ui/icon-button';
import { SearchInput } from '@/components/ui/search-input';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ContextMenu, useContextMenu, type ContextMenuEntry } from '@/components/ui/context-menu';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ApiStore } from './store';
import { type ApiRequest, type Auth, type Collection, type Folder, type RequestScript, type TreeItem, newAuth, normalizeRequest } from './types';
import { importPostman, exportPostman } from './postman';
import { type ScriptFinding, findScripts, stripScripts } from './collectionScripts';
import { ImportReviewDialog } from './ImportReviewDialog';
import { importOpenApi, isOpenApiDocument, parseSpecText } from './openapi';
import { pickCollectionFile, saveJsonFile } from './fileio';
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

// One entry in a context menu. `sep` draws a divider above the item. Same
// shape as the shared ContextMenu primitive's entries.
type MenuEntry = ContextMenuEntry;

// Options for a pending destructive-action confirmation (see ConfirmDialog below).
interface PendingDelete {
  title: string;
  description: string;
  onConfirm: () => void;
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
  confirmDelete: (opts: PendingDelete) => void;
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
  // Non-fatal notes from the last import (parts of a spec with no equivalent
  // here). Shown until dismissed so an import is never quietly lossy.
  const [notices, setNotices] = useState<string[]>([]);
  const [settings, setSettings] = useState<NodeSettingsTarget | null>(null);
  const [curlOpen, setCurlOpen] = useState(false);
  // Set while the user decides what to do about an import that carries scripts.
  const [pendingImport, setPendingImport] = useState<{ collection: Collection; findings: ScriptFinding[] } | null>(null);
  // Set while a destructive action (delete collection/folder/request) awaits confirmation.
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const menu = useContextMenu();
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

  // Importing a collection that carries scripts is a decision to run someone
  // else's code on the next Send, so it goes through a review step instead of
  // landing silently. Script-free collections import as before.
  const handleImport = async () => {
    setError(null);
    setNotices([]);
    try {
      const file = await pickCollectionFile();
      if (!file) return;
      // A Postman export and an OpenAPI spec are both usually named `.json`, so
      // the format is decided by what the document contains, not its extension.
      const doc = await parseSpecText(file.text);
      let collection: Collection;
      if (isOpenApiDocument(doc)) {
        const result = importOpenApi(doc);
        collection = result.collection;
        setNotices(result.warnings);
      } else if (doc && typeof doc === 'object' && Array.isArray((doc as { item?: unknown }).item)) {
        collection = importPostman(file.text);
      } else {
        throw new Error(`${file.name} is neither a Postman collection nor an OpenAPI/Swagger spec`);
      }
      const findings = findScripts(collection);
      if (findings.length === 0) {
        store.importCollection(collection);
        return;
      }
      setPendingImport({ collection, findings });
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const confirmDelete = useCallback((opts: PendingDelete) => setPendingDelete(opts), []);

  // Environment variables, for {{var}} highlighting in collection/folder auth.
  // Secret-flagged variables stay masked here too — same rule as everywhere
  // else a value only ever needs to be recognized, not displayed.
  const envVars = useMemo(() => {
    const m: Record<string, string> = {};
    if (store.activeEnv) for (const v of store.activeEnv.variables) if (v.enabled && v.key) m[v.key] = v.secret ? '••••••••' : v.value;
    return m;
  }, [store.activeEnv]);

  const nodeCtx: NodeCtx = useMemo(() => ({
    storeRef, activeRequestId: store.activeRequestId, q, onError: setError, onSettings: setSettings,
    openMenu: menu.open, confirmDelete, editingId, setEditingId, onRun, dragId, dropTarget, setDragId, setDropTarget, onDrop,
  }), [store.activeRequestId, q, menu.open, confirmDelete, editingId, onRun, dragId, dropTarget, onDrop]);
  const visible = store.collections.filter((c) => !q || collectionMatches(c, q));

  return (
    <div className="flex h-full w-full flex-col">
      {/* header */}
      <div className="flex items-center justify-between gap-1 border-b border-line px-3 py-2">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-fg-mute/70">
          <Boxes className="h-3.5 w-3.5" /> Collections
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton size="sm" title="New collection" onClick={() => store.addCollection()}>
            <Plus className="h-4 w-4" />
          </IconButton>
          <DropdownMenu>
            <DropdownMenuTrigger title="More" className="rounded-md p-1.5 text-fg-mute transition-colors hover:bg-acc hover:text-fg">
              <MoreVertical className="h-4 w-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem onClick={handleImport} icon={<Upload className="h-3.5 w-3.5" />}>Import collection / OpenAPI</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setCurlOpen(true)} icon={<Code2 className="h-3.5 w-3.5" />}>Import cURL</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* search */}
      <div className="border-b border-line px-2 py-1.5">
        <SearchInput ref={searchInputRef} value={query} onChange={setQuery} placeholder="Search" className="h-ctl text-xs" />
      </div>

      {error && (
        <div className="border-b border-bad/20 bg-bad/8 px-3 py-1.5 text-[11px] text-bad">{error}</div>
      )}

      {notices.length > 0 && (
        <div className="flex items-start gap-2 border-b border-warn/20 bg-warn/8 px-3 py-1.5 text-[11px] text-fg-mute">
          <ul className="max-h-32 min-w-0 flex-1 space-y-1 overflow-y-auto">
            {notices.map((n) => <li key={n} className="break-words">{n}</li>)}
          </ul>
          <IconButton size="sm" title="Dismiss" onClick={() => setNotices([])}>
            <X className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      )}

      {/* tree */}
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        {store.collections.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-fg-mute">
            No collections yet. Create one, or import a Postman file or OpenAPI spec.
          </p>
        ) : visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-fg-mute">No matches.</p>
        ) : (
          visible.map((c) => <CollectionNode key={c.id} collection={c} ctx={nodeCtx} />)
        )}
      </div>

      {settings && (
        <NodeSettingsDialog target={settings} onSave={store.setNodeScript} onSaveAuth={store.setNodeAuth} onClose={() => setSettings(null)} vars={envVars} />
      )}
      {menu.state && <ContextMenu state={menu.state} onClose={menu.close} />}
      {pendingDelete && (
        <ConfirmDialog
          open
          onOpenChange={(o) => { if (!o) setPendingDelete(null); }}
          title={pendingDelete.title}
          description={pendingDelete.description}
          confirmLabel="Delete"
          onConfirm={pendingDelete.onConfirm}
        />
      )}
      <ImportCurlDialog store={store} open={curlOpen} onClose={() => setCurlOpen(false)} />
      {pendingImport && (
        <ImportReviewDialog
          open
          collectionName={pendingImport.collection.name}
          findings={pendingImport.findings}
          onImportWithScripts={() => { store.importCollection(pendingImport.collection); setPendingImport(null); }}
          onImportWithoutScripts={() => { store.importCollection(stripScripts(pendingImport.collection)); setPendingImport(null); }}
          onCancel={() => setPendingImport(null)}
        />
      )}
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

  const removeCollection = () => ctx.confirmDelete({
    title: 'Delete collection?',
    description: `This removes "${collection.name}" and everything inside it. This can't be undone.`,
    onConfirm: () => store.deleteCollection(collection.id),
  });

  const entries: MenuEntry[] = [
    { icon: <FilePlus2 className="h-3.5 w-3.5" />, label: 'New Request', onClick: () => store.addItem(collection.id, 'request') },
    { icon: <FolderPlus className="h-3.5 w-3.5" />, label: 'New Folder', onClick: () => store.addItem(collection.id, 'folder') },
    { icon: <Play className="h-3.5 w-3.5" />, label: 'Run', sep: true, onClick: () => ctx.onRun(collection.name, flattenRequests(collection.items)) },
    { icon: <CopyPlus className="h-3.5 w-3.5" />, label: 'Clone', sep: true, onClick: () => store.cloneCollection(collection.id) },
    { icon: <Pencil className="h-3.5 w-3.5" />, label: 'Rename', onClick: () => ctx.setEditingId(collection.id) },
    { icon: <Download className="h-3.5 w-3.5" />, label: 'Export (Postman)', onClick: handleExport },
    { icon: <Code2 className="h-3.5 w-3.5" />, label: 'Settings…', onClick: () => ctx.onSettings({ collectionId: collection.id, nodeId: null, name: collection.name, kind: 'Collection', script: emptyScript(collection.script), auth: inheritAuth(collection.auth) }) },
    { icon: <ChevronsDownUp className="h-3.5 w-3.5" />, label: collapsed ? 'Expand' : 'Collapse', onClick: () => store.toggleCollapse(collection.id) },
    { icon: <X className="h-3.5 w-3.5" />, label: 'Remove', danger: true, sep: true, onClick: removeCollection },
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
        icon={<Layers className="h-3.5 w-3.5 text-fg-mute" />}
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

  const removeFolder = () => ctx.confirmDelete({
    title: 'Delete folder?',
    description: `This removes "${folder.name}" and everything inside it. This can't be undone.`,
    onConfirm: () => store.deleteItem(collectionId, folder.id),
  });

  const entries: MenuEntry[] = [
    { icon: <FilePlus2 className="h-3.5 w-3.5" />, label: 'New Request', onClick: () => store.addItem(collectionId, 'request', folder.id) },
    { icon: <FolderPlus className="h-3.5 w-3.5" />, label: 'New Folder', onClick: () => store.addItem(collectionId, 'folder', folder.id) },
    { icon: <Play className="h-3.5 w-3.5" />, label: 'Run', sep: true, onClick: () => ctx.onRun(folder.name, flattenRequests(folder.items)) },
    { icon: <CopyPlus className="h-3.5 w-3.5" />, label: 'Clone', sep: true, onClick: () => store.cloneItem(collectionId, folder.id) },
    { icon: <Pencil className="h-3.5 w-3.5" />, label: 'Rename', onClick: () => ctx.setEditingId(folder.id) },
    { icon: <Code2 className="h-3.5 w-3.5" />, label: 'Settings…', onClick: () => ctx.onSettings({ collectionId, nodeId: folder.id, name: folder.name, kind: 'Folder', script: emptyScript(folder.script), auth: inheritAuth(folder.auth) }) },
    { icon: <ChevronsDownUp className="h-3.5 w-3.5" />, label: collapsed ? 'Expand' : 'Collapse', onClick: () => store.toggleCollapse(collectionId, folder.id) },
    { icon: <X className="h-3.5 w-3.5" />, label: 'Remove', danger: true, sep: true, onClick: removeFolder },
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

  const removeRequest = () => ctx.confirmDelete({
    title: 'Delete request?',
    description: `This removes "${request.name}". This can't be undone.`,
    onConfirm: () => store.deleteItem(collectionId, request.id),
  });

  const entries: MenuEntry[] = [
    { icon: <CopyPlus className="h-3.5 w-3.5" />, label: 'Clone', onClick: () => store.cloneItem(collectionId, request.id) },
    { icon: <Pencil className="h-3.5 w-3.5" />, label: 'Rename', onClick: () => ctx.setEditingId(request.id) },
    { icon: <X className="h-3.5 w-3.5" />, label: 'Remove', danger: true, sep: true, onClick: removeRequest },
  ];

  return (
    <Row
      ctx={ctx}
      id={request.id}
      depth={depth}
      active={active}
      badge={
        <span className={cn('shrink-0 rounded px-1 py-px text-[11px] font-bold uppercase tracking-wide', methodBadgeStyle(request.method))}>
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
          <IconBtn title="Remove" onClick={removeRequest}><Trash2 className="h-3.5 w-3.5" /></IconBtn>
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
        'group relative flex items-center gap-1.5 py-[5px] pr-1 text-xs cursor-pointer transition-colors hover:bg-acc/60',
        active && 'bg-acc/80 text-fg',
        dragging && 'opacity-40',
        dt?.where === 'inside' && 'bg-acc/10 ring-1 ring-inset ring-acc/40',
      )}
      style={{ paddingLeft: 6 + depth * 12 }}
      onClick={hasChildren ? onToggle : onClick}
      onContextMenu={(e) => ctx.openMenu(e, entries)}
    >
      {/* Bruno-style left accent stripe on the active request */}
      {active && <span className="pointer-events-none absolute inset-y-0 left-0 w-0.5 rounded-r-full bg-acc" />}
      {dt?.where === 'before' && <span className="pointer-events-none absolute inset-x-0 top-0 h-0.5 bg-acc" />}
      {dt?.where === 'after' && <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-acc" />}
      {hasChildren ? (
        collapsed ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
          : <ChevronDown className="h-3.5 w-3.5 shrink-0 text-fg-mute" />
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

// Thin wrapper around the shared IconButton with the sidebar's own hover tone
// (the panel background differs from the app chrome IconButton defaults to).
function IconBtn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <IconButton size="sm" title={title} onClick={onClick} className="hover:bg-bg">
      {children}
    </IconButton>
  );
}
