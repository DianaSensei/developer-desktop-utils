// Settings dialog for a collection or folder — edits the inherited pre/post
// request scripts that run for every request nested inside it (Bruno-style
// collection/folder scripts).

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CodeEditor } from './CodeEditor';
import type { RequestScript } from './types';

export interface NodeSettingsTarget {
  collectionId: string;
  nodeId: string | null;   // null = the collection itself
  name: string;
  kind: 'Collection' | 'Folder';
  script: RequestScript;
}

interface Props {
  target: NodeSettingsTarget;
  onSave: (collectionId: string, nodeId: string | null, script: RequestScript) => void;
  onClose: () => void;
}

export function NodeSettingsDialog({ target, onSave, onClose }: Props) {
  const [script, setScript] = useState<RequestScript>(target.script);

  const save = () => {
    onSave(target.collectionId, target.nodeId, script);
    onClose();
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="flex max-w-3xl flex-col gap-0 p-0">
        <DialogHeader className="border-b px-4 py-3">
          <DialogTitle>
            {target.kind} scripts — <span className="font-normal text-muted-foreground">{target.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 p-4">
          <p className="text-[11px] text-muted-foreground">
            These run for every request inside this {target.kind.toLowerCase()} — pre-request before each send, post-response after.
          </p>
          <div className="flex h-48 flex-col gap-1.5">
            <Label className="text-xs">Pre-request</Label>
            <CodeEditor
              value={script.req}
              onChange={(req) => setScript((s) => ({ ...s, req }))}
              placeholder={"bru.setVar('base', 'https://api.example.com');"}
            />
          </div>
          <div className="flex h-48 flex-col gap-1.5">
            <Label className="text-xs">Post-response</Label>
            <CodeEditor
              value={script.res}
              onChange={(res) => setScript((s) => ({ ...s, res }))}
              placeholder={"console.log('done', res.getStatus());"}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t px-4 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
