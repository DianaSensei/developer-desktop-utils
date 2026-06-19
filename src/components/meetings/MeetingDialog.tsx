import { useState } from 'react';
import { Trash2, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { copyToClipboard } from '@/lib/clipboard';
import { buildMeetingMarkdown, useMeetings } from '@/lib/meetings';
import { Modal } from '@/components/tools/clockify/ui';
import { MeetingFields } from './MeetingFields';

// Dialog editor used from the Time Tracker calendar & schedule. Edits the shared
// meeting record, so changes are instantly reflected in the Meeting Notes tool.
export function MeetingDialog({ meetingId, onClose }: { meetingId: string; onClose: () => void }) {
  const { getMeeting, updateMeeting, deleteMeeting } = useMeetings();
  const meeting = getMeeting(meetingId);
  const [copied, setCopied] = useState(false);

  if (!meeting) return null;

  const copyMarkdown = async () => {
    await copyToClipboard(buildMeetingMarkdown(meeting));
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <Modal open onClose={onClose} title="Meeting" width="max-w-lg">
      <div className="space-y-3">
        <MeetingFields meeting={meeting} onChange={(patch) => updateMeeting(meeting.id, patch)} variant="dialog" />
        <div className="flex items-center justify-between gap-2 border-t pt-3">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-red-500 hover:bg-red-500/10 hover:text-red-500"
            onClick={() => { deleteMeeting(meeting.id); onClose(); }}
          >
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="gap-1.5" onClick={copyMarkdown}>
              {copied ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
              {copied ? 'Copied' : 'Copy markdown'}
            </Button>
            <Button size="sm" onClick={onClose}>Done</Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
