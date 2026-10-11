import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { newMatcher, type Matcher, type MatcherOp, type MatcherTarget } from './types';
import { useMessages } from '@/contexts/LocaleContext';
import MESSAGES from '@/components/tools/mockserver/MockServer.messages';

const TARGETS: { value: MatcherTarget; label: string }[] = [
  { value: 'query', label: 'Query' },
  { value: 'header', label: 'Header' },
  { value: 'path', label: 'Path param' },
  { value: 'body', label: 'Body' },
];

const OPS: { value: MatcherOp; label: string }[] = [
  { value: 'equals', label: 'equals' },
  { value: 'contains', label: 'contains' },
  { value: 'regex', label: 'regex' },
  { value: 'exists', label: 'exists' },
];

interface Props {
  matchers: Matcher[];
  onChange: (matchers: Matcher[]) => void;
}

export function MatcherEditor({ matchers, onChange }: Props) {
  const tr = useMessages(MESSAGES);
  const update = (id: string, patch: Partial<Matcher>) =>
    onChange(matchers.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const remove = (id: string) => onChange(matchers.filter((m) => m.id !== id));
  const add = () => onChange([...matchers, newMatcher()]);

  return (
    <div className="space-y-2">
      {matchers.length === 0 && (
        <p className="text-[11px] text-fg-mute">
          {tr('noMatchers')}
        </p>
      )}

      {matchers.map((m) => {
        const needsValue = m.op !== 'exists';
        const isBody = m.target === 'body';
        const bodyMode = isBody ? m.bodyMode ?? (m.key ? 'field' : 'whole') : undefined;
        const showField = !isBody || bodyMode === 'field';
        const keyPlaceholder =
          m.target === 'header' ? 'header name' : m.target === 'path' ? ':param name' : m.target === 'body' ? 'e.g. user.name' : 'param name';

        const onTargetChange = (v: string) => {
          const target = v as MatcherTarget;
          if (target === 'body') update(m.id, { target, key: '', bodyMode: 'whole' });
          else update(m.id, { target, bodyMode: undefined });
        };

        return (
          <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-bg-2/20 p-2">
            {/* What to look at */}
            <Select value={m.target} onValueChange={onTargetChange}>
              <SelectTrigger className="h-ctl w-[112px] shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGETS.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {tr(`target.${t.value}` as 'target.query')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Body: explicit whole-body vs JSON-field scope */}
            {isBody && (
              <Select
                value={bodyMode}
                onValueChange={(v) =>
                  v === 'whole' ? update(m.id, { bodyMode: 'whole', key: '' }) : update(m.id, { bodyMode: 'field' })
                }
              >
                <SelectTrigger className="h-ctl w-[132px] shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whole" className="text-xs">{tr('wholeBody')}</SelectItem>
                  <SelectItem value="field" className="text-xs">{tr('jsonField')}</SelectItem>
                </SelectContent>
              </Select>
            )}

            {/* Key / JSON path */}
            {showField && (
              <Input
                value={m.key}
                onChange={(e) => update(m.id, { key: e.target.value })}
                placeholder={keyPlaceholder}
                className={cn('h-ctl min-w-0 font-mono text-xs', isBody ? 'flex-1 basis-[160px]' : 'w-[150px] shrink-0')}
              />
            )}

            {/* Operator */}
            <Select value={m.op} onValueChange={(v) => update(m.id, { op: v as MatcherOp })}>
              <SelectTrigger className="h-ctl w-[112px] shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {tr(`op.${o.value}` as 'op.equals')}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Value */}
            {needsValue ? (
              <Input
                value={m.value}
                onChange={(e) => update(m.id, { value: e.target.value })}
                placeholder={m.op === 'regex' ? '^pattern$' : 'expected value'}
                className="h-ctl min-w-0 flex-1 basis-[140px] font-mono text-xs"
              />
            ) : (
              <div className="flex-1 basis-[140px]" />
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-ctl w-ctl shrink-0 text-fg-mute hover:text-bad"
              onClick={() => remove(m.id)}
              aria-label={tr('removeMatcher')}
              title={tr('removeMatcher')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      {matchers.some((m) => m.target === 'body' && (m.bodyMode ?? (m.key ? 'field' : 'whole')) === 'field') && (
        <p className="text-[11px] text-fg-mute">
          {tr('jsonFieldHintA')} <code>user.name</code> {tr('or')} <code>items.0.id</code>.
        </p>
      )}

      <Button type="button" variant="outline" size="sm" className="h-ctl text-xs" onClick={add}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        {tr('addMatcher')}
      </Button>
    </div>
  );
}
