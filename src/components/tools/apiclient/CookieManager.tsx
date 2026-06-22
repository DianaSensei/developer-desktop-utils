// Cookie manager (Bruno-style): view, add, edit, and delete the cookies the jar
// has captured, grouped by domain. Reached from the status-bar "Cookies" button.

import { useState } from 'react';
import { Cookie as CookieIcon, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { ApiStore } from './store';
import { type Cookie, groupByDomain } from './cookies';

interface Props {
  store: ApiStore;
  open: boolean;
  onClose: () => void;
}

const fmtExpires = (c: Cookie) =>
  c.expires === undefined ? 'Session' : new Date(c.expires).toLocaleString();

export function CookieManager({ store, open, onClose }: Props) {
  const groups = groupByDomain(store.cookies);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex h-[70vh] max-w-2xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle className="flex items-center justify-between">
            <span className="flex items-center gap-2"><CookieIcon className="h-4 w-4" /> Cookies</span>
            <div className="flex items-center gap-4 text-xs font-normal">
              <label className="flex items-center gap-2 text-muted-foreground">
                Enabled
                <Switch checked={store.cookiesEnabled} onCheckedChange={store.setCookiesEnabled} aria-label="Cookie jar enabled" />
              </label>
              {store.cookies.length > 0 && (
                <button onClick={store.clearCookies} className="text-destructive hover:underline">Clear all</button>
              )}
            </div>
          </DialogTitle>
        </DialogHeader>

        {!store.cookiesEnabled && (
          <div className="border-b bg-amber-400/10 px-4 py-1.5 text-[11px] text-amber-600 dark:text-amber-400">
            The cookie jar is off — cookies below won't be sent or captured until you enable it.
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto">
          {groups.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-muted-foreground">
              No cookies yet. They're captured automatically from response <code className="rounded bg-muted px-1">Set-Cookie</code> headers, or add one below.
            </p>
          ) : (
            groups.map(([domain, cookies]) => (
              <div key={domain} className="border-b">
                <div className="flex items-center justify-between bg-muted/30 px-4 py-1.5">
                  <span className="font-mono text-xs font-semibold">{domain}</span>
                  <button
                    onClick={() => store.clearDomainCookies(domain)}
                    title="Remove all cookies for this domain"
                    className="rounded p-1 text-muted-foreground/60 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="divide-y">
                  {cookies.map((c) => (
                    <CookieRow key={`${c.path} ${c.name}`} cookie={c} store={store} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <AddCookie store={store} />
      </DialogContent>
    </Dialog>
  );
}

function CookieRow({ cookie, store }: { cookie: Cookie; store: ApiStore }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(cookie.value);

  const save = () => {
    if (value !== cookie.value) store.upsertCookie({ ...cookie, value }, cookie);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-3 px-4 py-1.5 text-xs">
      <span className="w-40 shrink-0 truncate font-mono font-medium" title={cookie.name}>{cookie.name}</span>
      {editing ? (
        <Input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setValue(cookie.value); setEditing(false); } }}
          className="h-6 flex-1 font-mono text-xs"
        />
      ) : (
        <span
          className="min-w-0 flex-1 cursor-text truncate font-mono text-muted-foreground"
          title={cookie.value}
          onDoubleClick={() => setEditing(true)}
        >
          {cookie.value}
        </span>
      )}
      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/70" title="Path">{cookie.path}</span>
      <span className="w-36 shrink-0 text-right text-[10px] text-muted-foreground/70" title="Expires">{fmtExpires(cookie)}</span>
      <div className="flex shrink-0 items-center gap-1">
        {cookie.secure && <span className="rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">secure</span>}
        {cookie.httpOnly && <span className="rounded bg-muted px-1 text-[9px] uppercase text-muted-foreground">http</span>}
        <button onClick={() => store.deleteCookie(cookie)} title="Delete" className="rounded p-1 text-muted-foreground/50 hover:text-destructive">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function AddCookie({ store }: { store: ApiStore }) {
  const [domain, setDomain] = useState('');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [path, setPath] = useState('/');

  const add = () => {
    const d = domain.trim().replace(/^\./, '').toLowerCase();
    const n = name.trim();
    if (!d || !n) return;
    store.upsertCookie({ name: n, value, domain: d, path: path.trim() || '/' });
    setName(''); setValue('');
  };

  const cls = 'h-8 text-xs font-mono';
  return (
    <div className="flex items-end gap-2 border-t px-4 py-3">
      <Field label="Domain" className="flex-1"><Input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="api.example.com" className={cls} /></Field>
      <Field label="Name" className="w-32"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="session" className={cls} /></Field>
      <Field label="Value" className="flex-1"><Input value={value} onChange={(e) => setValue(e.target.value)} placeholder="…" className={cls} /></Field>
      <Field label="Path" className="w-20"><Input value={path} onChange={(e) => setPath(e.target.value)} className={cls} /></Field>
      <Button size="sm" onClick={add} disabled={!domain.trim() || !name.trim()} className="h-8 gap-1.5">
        <Plus className="h-3.5 w-3.5" /> Add
      </Button>
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label className="mb-1 block text-[10px] uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}
