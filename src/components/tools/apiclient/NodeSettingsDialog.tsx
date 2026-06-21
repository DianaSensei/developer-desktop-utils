// Settings dialog for a collection or folder — edits the inherited pre/post
// request scripts and the inherited auth that apply to every request nested
// inside it (Bruno-style collection/folder settings).

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CodeEditor } from './CodeEditor';
import { AuthEditor } from './AuthEditor';
import { type Auth, type RequestScript, type VarMap, newAuth } from './types';

export interface NodeSettingsTarget {
  collectionId: string;
  nodeId: string | null;   // null = the collection itself
  name: string;
  kind: 'Collection' | 'Folder';
  script: RequestScript;
  auth: Auth;
}

interface Props {
  target: NodeSettingsTarget;
  onSave: (collectionId: string, nodeId: string | null, script: RequestScript) => void;
  onSaveAuth: (collectionId: string, nodeId: string | null, auth: Auth) => void;
  onClose: () => void;
  vars?: VarMap;
}

export function NodeSettingsDialog({ target, onSave, onSaveAuth, onClose, vars }: Props) {
  const [tab, setTab] = useState<'scripts' | 'auth'>('scripts');
  const [script, setScript] = useState<RequestScript>(target.script);
  const [auth, setAuth] = useState<Auth>(target.auth ?? newAuth());

  const save = () => {
    onSave(target.collectionId, target.nodeId, script);
    onSaveAuth(target.collectionId, target.nodeId, auth);
    onClose();
  };

  const TabBtn = ({ id, label }: { id: typeof tab; label: string }) => (
    <button
      onClick={() => setTab(id)}
      className={cn('border-b-2 py-2 text-xs font-medium transition-colors', tab === id ? 'border-amber-400 text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}
    >
      {label}
    </button>
  );

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>
            {target.kind} settings — <span className="font-normal text-muted-foreground">{target.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4 border-b px-4">
          <TabBtn id="scripts" label="Scripts" />
          <TabBtn id="auth" label="Auth" />
        </div>

        {tab === 'scripts' ? (
          <div className="flex flex-col gap-4 p-4">
            <p className="text-[11px] text-muted-foreground">
              These run for every request inside this {target.kind.toLowerCase()} — pre-request before each send, post-response after.
            </p>
            <div className="flex h-44 flex-col gap-1.5">
              <Label className="text-xs">Pre-request</Label>
              <CodeEditor value={script.req} onChange={(req) => setScript((s) => ({ ...s, req }))} placeholder={"bru.setVar('base', 'https://api.example.com');"} />
            </div>
            <div className="flex h-44 flex-col gap-1.5">
              <Label className="text-xs">Post-response</Label>
              <CodeEditor value={script.res} onChange={(res) => setScript((s) => ({ ...s, res }))} placeholder={"console.log('done', res.getStatus());"} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-3 p-4">
            <p className="text-[11px] text-muted-foreground">
              Requests with “Inherit” auth use this {target.kind.toLowerCase()}’s authorization.
            </p>
            <AuthEditor auth={auth} onChange={setAuth} allowInherit={false} vars={vars} />
          </div>
        )}

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
