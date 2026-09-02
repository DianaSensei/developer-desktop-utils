// Settings dialog for a collection or folder — edits the inherited pre/post
// request scripts and the inherited auth that apply to every request nested
// inside it (Bruno-style collection/folder settings).

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Segmented } from '@/components/ui/segmented';
import { Tabs } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Callout } from '@/components/ui/callout';
import { JavaScriptEditor } from '@/design-system';
import { AuthEditor } from './AuthEditor';
import { KeyValueEditor } from './KeyValueEditor';
import { scriptApiExtensions } from './scriptCompletion';
import { scriptCallsNetwork } from './collectionScripts';
import { PRE_REQUEST_SNIPPETS, POST_RESPONSE_SNIPPETS, appendSnippet } from './scriptSnippets';
import { SnippetMenu } from './SnippetMenu';
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

type NodeTab = 'scripts' | 'auth' | 'headers';
type ScriptPhase = 'req' | 'res';

export function NodeSettingsDialog({ target, onSave, onSaveAuth, onSaveHeaders, onClose, vars }: Props) {
  const [tab, setTab] = useState<NodeTab>('scripts');
  const [phase, setPhase] = useState<ScriptPhase>('req');
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

        {/* The shared Tabs strip, not a hand-rolled trio of underline buttons
            — same control the request and response panels use, so a
            collection's tabs behave (and collapse into ») like every other
            tab strip in the tool. */}
        <Tabs
          tabs={[{ id: 'scripts', label: 'Scripts' }, { id: 'auth', label: 'Auth' }, { id: 'headers', label: 'Headers' }]}
          active={tab}
          onSelect={(id) => setTab(id as NodeTab)}
          className="px-4"
        />

        {tab === 'scripts' ? (
          // One editor at full height behind a phase switch, the same shape
          // the request's own Script tab settled on — the two editors used to
          // stand stacked, each capped at h-44, so both were too short to
          // read a real script in while only one was ever being edited.
          <ScriptPane
            kind={target.kind}
            phase={phase}
            onPhaseChange={setPhase}
            script={script}
            onScriptChange={setScript}
          />
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
            <KeyValueEditor rows={headers} onChange={setHeaders} keyPlaceholder="Header" valuePlaceholder="Value" vars={vars} />
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

// Hoisted out of NodeSettingsDialog for the same reason the old TabBtn was: a
// component declared inside render gets a new identity on every keystroke, so
// React tears down and rebuilds the CodeMirror instance on each character.
function ScriptPane({ kind, phase, onPhaseChange, script, onScriptChange }: {
  kind: NodeSettingsTarget['kind'];
  phase: ScriptPhase;
  onPhaseChange: (p: ScriptPhase) => void;
  script: RequestScript;
  onScriptChange: (fn: (s: RequestScript) => RequestScript) => void;
}) {
  const isReq = phase === 'req';
  const value = isReq ? script.req : script.res;
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          value={phase}
          onValueChange={onPhaseChange}
          size="sm"
          aria-label="Script phase"
          options={[{ value: 'req', label: 'Pre-request' }, { value: 'res', label: 'Post-response' }]}
        />
        <SnippetMenu
          snippets={isReq ? PRE_REQUEST_SNIPPETS : POST_RESPONSE_SNIPPETS}
          onInsert={(sn) => onScriptChange((v) => (isReq
            ? { ...v, req: appendSnippet(v.req, sn) }
            : { ...v, res: appendSnippet(v.res, sn) }))}
        />
      </div>
      <Label className="text-[11px] font-normal text-fg-mute">
        Runs for every request inside this {kind.toLowerCase()}
        {isReq ? ', before each send.' : ', after each response.'}
      </Label>
      <div className="flex h-72 flex-col">
        <JavaScriptEditor
          key={phase}
          value={value}
          onChange={(v) => onScriptChange((s) => (isReq ? { ...s, req: v } : { ...s, res: v }))}
          placeholder={isReq ? "bru.setEnvVar('base', 'https://api.example.com');" : "console.log('done', res.getStatus());"}
          extraExtensions={scriptApiExtensions}
        />
      </div>
      {scriptCallsNetwork(value) && (
        <Callout tone="warning" size="sm">
          This script can make its own network request, separate from the Send button — review
          it before running scripts from a source you don't fully trust.
        </Callout>
      )}
    </div>
  );
}
