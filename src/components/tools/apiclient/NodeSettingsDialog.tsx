// Settings dialog for a collection or folder — edits the inherited pre/post
// request scripts and the inherited auth that apply to every request nested
// inside it (Bruno-style collection/folder settings).

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/callout';
import { JavaScriptEditor } from '@/design-system';
import { AuthEditor } from './AuthEditor';
import { KeyValueEditor } from './KeyValueEditor';
import { scriptApiExtensions } from './scriptCompletion';
import { scriptCallsNetwork } from './collectionScripts';
import { type Auth, type KeyValue, type RequestScript, type VarMap, newAuth } from './types';

export interface NodeSettingsTarget {
  collectionId: string;
  nodeId: string | null;   // null = the collection itself
  name: string;
  kind: 'Collection' | 'Folder';
  script: RequestScript;
  auth: Auth;
  headers: KeyValue[];
}

interface Props {
  target: NodeSettingsTarget;
  onSave: (collectionId: string, nodeId: string | null, script: RequestScript) => void;
  onSaveAuth: (collectionId: string, nodeId: string | null, auth: Auth) => void;
  onSaveHeaders: (collectionId: string, nodeId: string | null, headers: KeyValue[]) => void;
  onClose: () => void;
  vars?: VarMap;
}

export function NodeSettingsDialog({ target, onSave, onSaveAuth, onSaveHeaders, onClose, vars }: Props) {
  const [tab, setTab] = useState<'scripts' | 'auth' | 'headers'>('scripts');
  const [script, setScript] = useState<RequestScript>(target.script);
  const [auth, setAuth] = useState<Auth>(target.auth ?? newAuth());
  const [headers, setHeaders] = useState<KeyValue[]>(target.headers);

  const save = () => {
    onSave(target.collectionId, target.nodeId, script);
    onSaveAuth(target.collectionId, target.nodeId, auth);
    onSaveHeaders(target.collectionId, target.nodeId, headers);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent size="xl" scrollable>
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>
            {target.kind} settings — <span className="font-normal text-fg-mute">{target.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-4 border-b px-4">
          <TabBtn id="scripts" label="Scripts" active={tab} onSelect={setTab} />
          <TabBtn id="auth" label="Auth" active={tab} onSelect={setTab} />
          <TabBtn id="headers" label="Headers" active={tab} onSelect={setTab} />
        </div>

        {tab === 'scripts' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <p className="text-[11px] text-fg-mute">
              These run for every request inside this {target.kind.toLowerCase()} — pre-request before each send, post-response after.
            </p>
            <div className="flex h-44 flex-col gap-1.5">
              <Label className="text-xs">Pre-request</Label>
              <JavaScriptEditor value={script.req} onChange={(req) => setScript((s) => ({ ...s, req }))} placeholder={"bru.setVar('base', 'https://api.example.com');"} extraExtensions={scriptApiExtensions} />
              {scriptCallsNetwork(script.req) && (
                <Callout tone="warning" size="sm">
                  This script can make its own network request, separate from the Send button — review
                  it before running scripts from a source you don't fully trust.
                </Callout>
              )}
            </div>
            <div className="flex h-44 flex-col gap-1.5">
              <Label className="text-xs">Post-response</Label>
              <JavaScriptEditor value={script.res} onChange={(res) => setScript((s) => ({ ...s, res }))} placeholder={"console.log('done', res.getStatus());"} extraExtensions={scriptApiExtensions} />
              {scriptCallsNetwork(script.res) && (
                <Callout tone="warning" size="sm">
                  This script can make its own network request, separate from the Send button — review
                  it before running scripts from a source you don't fully trust.
                </Callout>
              )}
            </div>
          </div>
        ) : tab === 'auth' ? (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <p className="text-[11px] text-fg-mute">
              Requests with “Inherit” auth use this {target.kind.toLowerCase()}’s authorization.
            </p>
            <AuthEditor auth={auth} onChange={setAuth} allowInherit={false} vars={vars} />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            <p className="text-[11px] text-fg-mute">
              Added to every request inside this {target.kind.toLowerCase()}. A request's own header
              with the same name overrides it.
            </p>
            <KeyValueEditor rows={headers} onChange={setHeaders} keyPlaceholder="Header" valuePlaceholder="Value" />
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

// Hoisted out of NodeSettingsDialog: a component declared inside render gets a
// new identity on every keystroke in the script editors, so React remounts the
// button and it loses focus mid-keyboard-navigation.
function TabBtn({ id, label, active, onSelect }: {
  id: 'scripts' | 'auth' | 'headers'; label: string; active: string; onSelect: (id: 'scripts' | 'auth' | 'headers') => void;
}) {
  return (
    <button
      onClick={() => onSelect(id)}
      className={cn('border-b-2 py-2 text-xs font-medium transition-colors', active === id ? 'border-acc text-fg' : 'border-transparent text-fg-mute hover:text-fg')}
    >
      {label}
    </button>
  );
}
