import { Plus, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { newMatcher, type Matcher, type MatcherOp, type MatcherTarget } from './types';

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
  const update = (id: string, patch: Partial<Matcher>) =>
    onChange(matchers.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const remove = (id: string) => onChange(matchers.filter((m) => m.id !== id));
  const add = () => onChange([...matchers, newMatcher()]);

  return (
    <div className="space-y-2">
      {matchers.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          No extra matchers — the stub matches on method and path alone. Add a matcher to also require a
          query param, header, path param, or body condition.
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
          <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/20 p-2">
            {/* What to look at */}
            <Select value={m.target} onValueChange={onTargetChange}>
              <SelectTrigger className="h-9 w-[112px] shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TARGETS.map((t) => (
                  <SelectItem key={t.value} value={t.value} className="text-xs">
                    {t.label}
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
                <SelectTrigger className="h-9 w-[132px] shrink-0 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="whole" className="text-xs">Whole body</SelectItem>
                  <SelectItem value="field" className="text-xs">JSON field</SelectItem>
                </SelectContent>
              </Select>
            )}

            {/* Key / JSON path */}
            {showField && (
              <Input
                value={m.key}
                onChange={(e) => update(m.id, { key: e.target.value })}
                placeholder={keyPlaceholder}
                className={cn('h-9 min-w-0 font-mono text-xs', isBody ? 'flex-1 basis-[160px]' : 'w-[150px] shrink-0')}
              />
            )}

            {/* Operator */}
            <Select value={m.op} onValueChange={(v) => update(m.id, { op: v as MatcherOp })}>
              <SelectTrigger className="h-9 w-[112px] shrink-0 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {OPS.map((o) => (
                  <SelectItem key={o.value} value={o.value} className="text-xs">
                    {o.label}
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
                className="h-9 min-w-0 flex-1 basis-[140px] font-mono text-xs"
              />
            ) : (
              <div className="flex-1 basis-[140px]" />
            )}

            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
              onClick={() => remove(m.id)}
              aria-label="Remove matcher"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        );
      })}

      {matchers.some((m) => m.target === 'body' && (m.bodyMode ?? (m.key ? 'field' : 'whole')) === 'field') && (
        <p className="text-[11px] text-muted-foreground">
          JSON field paths read the request body as JSON, e.g. <code>user.name</code> or <code>items.0.id</code>.
        </p>
      )}

      <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={add}>
        <Plus className="mr-1 h-3.5 w-3.5" />
        Add matcher
      </Button>
    </div>
  );
}
