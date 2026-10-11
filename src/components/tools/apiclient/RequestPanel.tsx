// Request builder: the Params / Headers / Body / Auth editor tabs. The method +
// URL + Send bar lives above the split (see AddressBar). Edits are written
// straight back to the store so the request is always saved (Postman autosave).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Braces, Check, ChevronDown, Code2, Database, File, FileQuestion, FileText,
  FormInput, Hexagon, type LucideIcon, Sparkles, Tag, Trash2, Wand2, X,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SectionLabel } from '@/components/ui/section-label';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Segmented } from '@/components/ui/segmented';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Tabs } from '@/components/ui/tabs';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Callout } from '@/components/ui/callout';
import { EmptyState } from '@/components/ui/empty-state';
import { SettingGroup, SettingRow } from '@/components/ui/setting-row';
import { Badge, InlineCodeField, JavaScriptEditor, JsonEditor, TextEditor } from '@/design-system';
import { KeyValueEditor } from './KeyValueEditor';
import { ResolvedValue, showsResolvedColumn } from './ResolvedValue';
import { MultipartEditor } from './MultipartEditor';
import { AuthEditor } from './AuthEditor';
import { scriptApiExtensions } from './scriptCompletion';
import { scriptCallsNetwork } from './collectionScripts';
import { PRE_REQUEST_SNIPPETS, POST_RESPONSE_SNIPPETS, appendSnippet } from './scriptSnippets';
import { SnippetMenu } from './SnippetMenu';
import { authQueryParam, prettyBody, urlWithParams } from './request';
import {
  type ApiRequest, type Assertion, type AssertOperator, type BodyMode,
  type VarMap, ASSERT_OPERATORS, UNARY_ASSERT_OPERATORS, newAssertion, newKeyValue,
} from './types';
import { t } from './i18n';

export type RequestPanelTab =
  | 'params' | 'body' | 'auth' | 'script' | 'tests' | 'settings';
type Tab = RequestPanelTab;

interface Props {
  request: ApiRequest;
  onChange: (patch: Partial<ApiRequest>) => void;
  vars: VarMap;
  // Controlled by the parent so each open request remembers the tab it was left
  // on — the panel is remounted (keyed by request id) when tabs are switched.
  tab: Tab;
  onTabChange: (tab: Tab) => void;
}

// A count (muted number) and/or a "has content" dot (green, à la the
// Postman-style reference) — replaces the old plain-text " (n)"/" •" suffixes
// baked into the label string itself, which read as part of the tab's name
// rather than as a status indicator.
function tabBadge(count: number | undefined, hasContent: boolean | undefined): ReactNode {
  if (!count && !hasContent) return undefined;
  return (
    <>
      {!!count && <span className="text-fg-mute/70">{count}</span>}
      {hasContent && <span className="inline-block h-1.5 w-1.5 rounded-full bg-ok" />}
    </>
  );
}

export function RequestPanel({ request, onChange, vars, tab, onTabChange }: Props) {
  const enabledParams = request.params.filter((p) => p.enabled && p.key).length;
  const enabledHeaders = request.headers.filter((h) => h.enabled && h.key).length;

  const hasScript = !!(request.script.req.trim() || request.script.res.trim());
  const enabledAsserts = request.assertions.filter((a) => a.enabled && a.expr).length;

  // Số đếm chỉ tính Query — Path chưa từng tính vào đây (số path param đã lộ
  // rõ ngay trên URL), và giờ Headers cũng theo cùng lý đó: đếm riêng ngay
  // tại nhãn "Headers" bên trong, không gộp vào một con số duy nhất mơ hồ.
  const tabs: { id: Tab; label: string; badge?: ReactNode }[] = [
    { id: 'params', label: t('req.tab.params'), badge: tabBadge(enabledParams, false) },
    { id: 'body', label: t('req.tab.body'), badge: tabBadge(undefined, request.body.mode !== 'none') },
    { id: 'auth', label: t('req.tab.auth'), badge: tabBadge(undefined, request.auth.type !== 'none') },
    { id: 'script', label: t('req.tab.script'), badge: tabBadge(undefined, hasScript) },
    { id: 'tests', label: t('req.tab.tests'), badge: tabBadge(enabledAsserts, !!request.tests.trim()) },
    { id: 'settings', label: t('req.tab.settings'), badge: tabBadge(undefined, request.settings.verifyTls === false) },
  ];

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      {/* tab bar — collapses into » when narrow. bg-bg-2/10: the active tab
          pill is `bg-card`, same as the bright workbench surface this bar
          itself sits on (see ApiClient.tsx's own comment on that) — with no
          dim band behind the strip the pill had nothing to contrast against
          and read as plain text. Matches RequestTabs.tsx's outer strip,
          which uses the same tint for the same reason. */}
      <Tabs
        tabs={tabs}
        active={tab}
        onSelect={(id) => onTabChange(id as Tab)}
        className="bg-bg-2/10"
        right={tab === 'body' ? (
          <div className="flex items-center gap-2">
            {request.body.mode === 'json' && (
              <button
                type="button"
                onClick={() => onChange({ body: { ...request.body, raw: prettyBody(request.body.raw, 'application/json') } })}
                disabled={!request.body.raw.trim()}
                className="flex items-center gap-1 py-2 text-xs font-medium text-fg-mute transition-colors hover:text-fg disabled:pointer-events-none disabled:opacity-40"
                title={t('req.formatJson')}
                aria-label={t('req.formatJson')}
              >
                <Wand2 className="h-3.5 w-3.5" /> Format
              </button>
            )}
            <BodyModeDropdown body={request.body} onChange={onChange} />
          </div>
        ) : undefined}
      />

      {(tab === 'script' || tab === 'tests') && <McpScriptingHint />}

      {/* tab body */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Headers từng là tab riêng — di chuyển vào đây làm phần thứ ba, cùng
            hình dạng với Query/Path (nhãn nhỏ + bảng), thay vì buộc người dùng
            nhảy tab để thấy trọn bộ những gì gắn liền với request này. */}
        {/* No section-level max-w here (there used to be one, `max-w-5xl`):
            in the stacked layout the request pane spans the whole window, and
            capping the whole section left a dead block of empty space beside
            a table that could otherwise have used that width — worse than the
            problem it was solving. The actual fix is on the table's own
            columns (see KeyValueEditor's `gridCols`, capped at the Name/Value
            level), so the table still fills whatever width the pane has, it
            just doesn't hand a 7-character value like `profile` a 600px-wide
            input. */}
        {tab === 'params' && (
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-3">
            <div className="space-y-2">
              <SectionLabel>{t('req.query')}</SectionLabel>
              {/* Editing params rewrites the URL's query string (kept in sync). */}
              <KeyValueEditor rows={request.params} onChange={(params) => onChange({ params, url: urlWithParams(request.url, params) })} vars={vars} duplicateKeyHint="params" />
              <AuthQueryParamRow request={request} />
            </div>
            <PathParamsEditor request={request} onChange={onChange} vars={vars} />
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <SectionLabel>{t('headers')}</SectionLabel>
                {enabledHeaders > 0 && <Badge tone="neutral" pill>{enabledHeaders}</Badge>}
              </div>
              <KeyValueEditor rows={request.headers} onChange={(headers) => onChange({ headers })} keyPlaceholder="Header" vars={vars} duplicateKeyHint="headers" />
            </div>
          </div>
        )}
        {tab === 'body' && <div className="flex min-h-0 flex-1 flex-col p-3"><BodyEditor request={request} onChange={onChange} vars={vars} /></div>}
        {tab === 'auth' && <div className="min-h-0 flex-1 overflow-y-auto p-3"><AuthEditor auth={request.auth} onChange={(auth) => onChange({ auth })} vars={vars} /></div>}
        {tab === 'script' && <ScriptEditor request={request} onChange={onChange} />}
        {tab === 'settings' && <div className="min-h-0 flex-1 overflow-y-auto p-3"><SettingsEditor request={request} onChange={onChange} /></div>}
        {tab === 'tests' && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
            <div className="shrink-0 space-y-1.5">
              <Label className="text-xs">{t('req.assertions')}</Label>
              <AssertEditor request={request} onChange={onChange} />
            </div>
            <div className="flex min-h-0 flex-1 flex-col gap-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">{t('req.testScript')}</Label>
                <SnippetMenu snippets={POST_RESPONSE_SNIPPETS} onInsert={(s) => onChange({ tests: appendSnippet(request.tests, s) })} />
              </div>
              <p className="text-[11px] text-fg-mute">
                {t('req.testHintA')} <code className="rounded bg-bg-2 px-1">test()</code> {t('req.and')} <code className="rounded bg-bg-2 px-1">expect()</code> {t('req.with')} <code className="rounded bg-bg-2 px-1">res</code>, <code className="rounded bg-bg-2 px-1">dt</code>.
              </p>
              <JavaScriptEditor
                value={request.tests}
                onChange={(tests) => onChange({ tests })}
                placeholder={'test("status is 200", function () {\n  expect(res.getStatus()).to.equal(200);\n});'}
                extraExtensions={scriptApiExtensions}
              />
              {scriptCallsNetwork(request.tests) && <NetworkCallNotice />}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── scripts ──────────────────────────────────────────────────────────────────

// Non-blocking heads-up shown under a script editor when its text calls
// fetch/XMLHttpRequest/WebSocket directly — see scriptCallsNetwork.
function NetworkCallNotice() {
  return (
    <Callout tone="warning" size="sm">
      {t('req.networkNotice')}
    </Callout>
  );
}

// A script/test-writing tip, not a warning — kept as a plain muted line
// rather than a Callout so it doesn't compete with NetworkCallNotice above
// for attention. MCP lets an external client (Claude Code, Claude Desktop)
// list/edit/send through this exact store and engine (see mcpBridge.ts), so
// "write this script" and "verify it actually works" both mean the assistant
// can run the real request, not just draft text.
function McpScriptingHint() {
  return (
    <p className="flex shrink-0 items-center gap-1.5 px-3 pt-2 text-[11px] text-fg-mute">
      <Sparkles className="h-3 w-3 shrink-0" />
      {t('req.mcpHint')}{' '}
      <strong className="font-medium text-fg">{t('req.mcpPath')}</strong>
    </p>
  );
}


type ScriptPhase = 'req' | 'res';

// Pre-request và post-response từng đứng CHỒNG NHAU, mỗi bên full-height (chia
// đôi khung dọc) — hai Label, hai đoạn giải thích, hai VarsSection, hai editor
// đều hiện cùng lúc dù người dùng chỉ nhìn một bên tại một thời điểm. Giờ dùng
// Segmented để chuyển pha (đúng công cụ chuyển-chế-độ của kit, xem
// ui/segmented.tsx), một khung nội dung duy nhất được TOÀN BỘ chiều cao — và
// hàng tiêu đề gọn lại giống "Path" ở tab Params: một nhãn nhỏ, không đoạn văn
// luôn hiện.
function ScriptEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const { script } = request;
  const [phase, setPhase] = useState<ScriptPhase>('req');
  const isReq = phase === 'req';

  const phaseScript = isReq ? script.req : script.res;
  const setPhaseScript = (v: string) =>
    onChange({ script: isReq ? { ...script, req: v } : { ...script, res: v } });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          value={phase}
          onValueChange={setPhase}
          size="sm"
          aria-label={t('req.scriptPhase')}
          options={[
            { value: 'req', label: t('req.preRequest') },
            { value: 'res', label: t('req.postResponse') },
          ]}
        />
        <SnippetMenu
          snippets={isReq ? PRE_REQUEST_SNIPPETS : POST_RESPONSE_SNIPPETS}
          onInsert={(s) => onChange({ script: isReq ? { ...script, req: appendSnippet(script.req, s) } : { ...script, res: appendSnippet(script.res, s) } })}
        />
      </div>
      <p className="text-[11px] text-fg-mute">
        {isReq
          ? <>{t('req.preHintA')} <code className="rounded bg-bg-2 px-1">req</code>{t('req.hintSet')} <code className="rounded bg-bg-2 px-1">dt</code> {t('req.hintVars')}</>
          : <>{t('req.postHintA')} <code className="rounded bg-bg-2 px-1">res</code>{t('req.hintSet')} <code className="rounded bg-bg-2 px-1">dt</code> {t('req.hintVars')}</>}
      </p>
      <JavaScriptEditor
        key={phase}
        value={phaseScript}
        onChange={setPhaseScript}
        placeholder={isReq ? "req.setHeader('X-Trace', 'abc');\ndt.setEnvVar('ts', Date.now());" : "dt.setEnvVar('token', res.getBody().token);"}
        extraExtensions={scriptApiExtensions}
      />
      {scriptCallsNetwork(phaseScript) && <NetworkCallNotice />}
    </div>
  );
}

// ─── assertions (declarative) ─────────────────────────────────────────────────

const assertInputCls = 'h-ctl border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0 focus-visible:ring-offset-0';

function AssertEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const { assertions } = request;
  const ghostRef = useRef(newAssertion());

  const isFilled = (a: Assertion) => a.expr !== '' || a.value !== '';
  const realRows = assertions.filter(isFilled);
  const ghost = ghostRef.current;
  const displayRows = [...realRows, ghost];

  const editRow = (id: string, patch: Partial<Assertion>) => {
    if (id === ghost.id) {
      const materialized = { ...ghost, ...patch };
      ghostRef.current = newAssertion();
      onChange({ assertions: [...realRows, materialized] });
      return;
    }
    onChange({ assertions: realRows.map((a) => (a.id === id ? { ...a, ...patch } : a)).filter(isFilled) });
  };
  const removeRow = (id: string) => onChange({ assertions: realRows.filter((a) => a.id !== id) });

  return (
    // The Operator column is a fixed 12rem Select; Expression/Value are each
    // capped at 28rem (not a bare `1fr`) so a wide/stacked request pane can't
    // stretch a short expression like `res.status` into a 600px-wide input —
    // they still shrink together in a narrow pane (floor of 0), collapsing to
    // ~30px at a ~300px pane, too small to read an expression in. Below the
    // min width the table scrolls sideways instead (the pattern
    // docs/ai/CLAUDE.md prescribes for horizontal data tables) so every cell
    // stays usable.
    <div className="overflow-x-auto overflow-y-hidden rounded-md border text-xs">
      <div className="min-w-[24rem]">
      {/* header */}
      {/* Same header treatment as KeyValueEditor's tables, so the three
          tables a request shows (Query, Headers, Assertions) read as one
          family instead of two styles. */}
      <div className="grid grid-cols-[minmax(0,28rem)_9.5rem_minmax(0,28rem)_2rem] border-b bg-bg-2/40 text-[11px] font-semibold uppercase tracking-wide text-fg-mute">
        <div className="border-r px-3 py-1.5">{t('req.expression')}</div>
        <div className="border-r px-3 py-1.5">{t('req.operator')}</div>
        <div className="border-r px-3 py-1.5">{t('value')}</div>
        <div />
      </div>

      {displayRows.map((a) => {
        const isGhost = a.id === ghost.id;
        const unary = UNARY_ASSERT_OPERATORS.includes(a.operator);
        return (
          <div key={a.id} className="group grid grid-cols-[minmax(0,28rem)_9.5rem_minmax(0,28rem)_2rem] border-b last:border-b-0 hover:bg-bg-2/20 focus-within:bg-bg-2/20 focus-within:ring-[3px] focus-within:ring-inset focus-within:ring-focus transition-colors">
            {/* expr cell with enable checkbox */}
            <div className="flex min-w-0 items-center gap-1.5 border-r px-2">
              <button
                type="button"
                onClick={() => !isGhost && editRow(a.id, { enabled: !a.enabled })}
                className={cn(
                  'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors',
                  isGhost ? 'invisible' : a.enabled ? 'border-acc bg-acc text-acc-fg' : 'border-line',
                )}
                title={a.enabled ? t('enabled') : t('req.disabled')}
              >
                {!isGhost && a.enabled && <Check className="h-2.5 w-2.5" />}
              </button>
              <Input
                value={a.expr}
                onChange={(e) => editRow(a.id, { expr: e.target.value })}
                placeholder="res.status"
                className={cn(assertInputCls, !isGhost && !a.enabled && 'opacity-50')}
                spellCheck={false}
              />
            </div>

            {/* operator cell */}
            <div className="flex items-center border-r">
              <Select value={a.operator} onValueChange={(v) => editRow(a.id, { operator: v as AssertOperator })}>
                <SelectTrigger className="h-ctl w-full border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-72">
                  {ASSERT_OPERATORS.map((op) => <SelectItem key={op} value={op}>{op}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {/* value cell (hidden for unary operators) */}
            <div className="border-r px-2">
              {!unary && (
                <Input
                  value={a.value}
                  onChange={(e) => editRow(a.id, { value: e.target.value })}
                  placeholder="200"
                  className={cn(assertInputCls, !isGhost && !a.enabled && 'opacity-50')}
                  spellCheck={false}
                />
              )}
            </div>

            {/* action cell */}
            <div className="flex items-center justify-center">
              {!isGhost && (
                <button type="button" onClick={() => removeRow(a.id)} title={t('remove')} aria-label={t('remove')} className="rounded p-1 text-fg-mute/40 opacity-0 transition-all group-hover:opacity-100 focus-visible:opacity-100 hover:text-bad">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ─── auth-as-query-param ────────────────────────────────────────────────────────

// The API-key auth entry, when placed as a query param (Auth tab), is folded
// into the outgoing query string at send time without ever appearing in the
// params table — shown here as a derived, read-only row so it isn't invisible.
function AuthQueryParamRow({ request }: { request: ApiRequest }) {
  const derived = authQueryParam(request);
  if (!derived) return null;
  return (
    <div className="overflow-hidden rounded-md border text-xs">
      <div className="grid grid-cols-[1rem_minmax(0,1fr)_minmax(0,1fr)_2rem] border-b bg-bg-2/40 text-[11px] font-semibold uppercase tracking-wide text-fg-mute/70">
        <div />
        <div className="border-r px-3 py-1.5">{t('req.fromAuth')}</div>
        <div className="px-3 py-1.5" />
        <div />
      </div>
      <div className="grid grid-cols-[1rem_minmax(0,1fr)_minmax(0,1fr)_2rem]">
        <div className="flex items-center justify-center">
          <span className="h-2 w-2 shrink-0 rounded-full bg-acc" title={t('req.derivedFromAuth')} />
        </div>
        {/* min-w-0 + truncate: these cells hold raw text, and a grid `1fr`
            track's automatic minimum is its content's width — an API key long
            enough (a JWT, say) would otherwise stretch the Value track past the
            pane, squeeze Name to nothing, and get clipped by the wrapper's
            overflow-hidden with no way to scroll to it. */}
        <div className="flex h-ctl min-w-0 items-center border-r px-2.5 font-mono text-fg-mute">
          <span className="truncate" title={derived.key}>{derived.key}</span>
        </div>
        <div className="flex h-ctl min-w-0 items-center px-2.5 font-mono text-fg-mute">
          {derived.value
            ? <span className="truncate" title={derived.value}>{derived.value}</span>
            : <span className="opacity-50">{t('req.empty')}</span>}
        </div>
        <div />
      </div>
    </div>
  );
}

// ─── path params ──────────────────────────────────────────────────────────────

function PathParamsEditor({ request, onChange, vars }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void; vars: VarMap }) {
  // Path params are the :placeholders that follow a '/' in the URL.
  const names = useMemo(() => {
    const found: string[] = [];
    const re = /\/:([A-Za-z_]\w*)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(request.url))) if (!found.includes(m[1])) found.push(m[1]);
    return found;
  }, [request.url]);

  // Drop pathParams rows whose :name no longer appears in the URL — otherwise
  // a renamed/removed placeholder leaves a stale row behind forever (it just
  // stops rendering, unlike query params, which paramsFromUrl already
  // reconciles the same way on every URL edit).
  useEffect(() => {
    if (request.pathParams.every((p) => names.includes(p.key))) return;
    onChange({ pathParams: request.pathParams.filter((p) => names.includes(p.key)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names, request.pathParams]);

  if (names.length === 0) return null;

  const rowOf = (name: string) => request.pathParams.find((p) => p.key === name);
  const valueOf = (name: string) => rowOf(name)?.value ?? '';
  const enabledOf = (name: string) => rowOf(name)?.enabled ?? true;
  const showResolved = showsResolvedColumn(names.map(valueOf), vars);
  const gridCols = showResolved
    ? 'grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_2rem]'
    : 'grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_2rem]';
  const setValue = (name: string, value: string) => {
    const exists = request.pathParams.some((p) => p.key === name);
    const next = exists
      ? request.pathParams.map((p) => (p.key === name ? { ...p, value } : p))
      : [...request.pathParams, newKeyValue(name, value)];
    onChange({ pathParams: next });
  };
  const toggleEnabled = (name: string) => {
    const exists = request.pathParams.some((p) => p.key === name);
    const next = exists
      ? request.pathParams.map((p) => (p.key === name ? { ...p, enabled: !p.enabled } : p))
      : [...request.pathParams, { ...newKeyValue(name, ''), enabled: false }];
    onChange({ pathParams: next });
  };

  return (
    <div className="space-y-2">
      <SectionLabel>{t('req.path')}</SectionLabel>
      {/* Same four-track grid as KeyValueEditor (the trailing 2rem is
          empty here — path params can't be removed, only disabled) so this
          table's Value column starts at exactly the same x as the Query and
          Headers tables above and below it — including the Resolved column
          when either table has tokens to resolve. */}
      <div className="overflow-hidden rounded-md border text-xs">
        <div className={cn('grid border-b bg-bg-2/40 text-[11px] font-semibold uppercase tracking-wide text-fg-mute', gridCols)}>
          <div />
          <div className="border-r px-3 py-1.5">{t('name')}</div>
          <div className="border-r px-3 py-1.5">{t('value')}</div>
          {showResolved && <div className="border-r px-3 py-1.5">{t('req.resolved')}</div>}
          <div />
        </div>
        {names.map((name, i) => {
          const enabled = enabledOf(name);
          return (
            <div key={name} className={cn('group grid border-b last:border-b-0 hover:bg-bg-2/40 focus-within:bg-bg-2/40 focus-within:ring-[3px] focus-within:ring-inset focus-within:ring-focus transition-colors duration-fast ease-out-soft', i % 2 === 1 && 'bg-bg-2/20', gridCols)}>
              {/* Toggle target is the whole cell, not just the checkbox glyph —
                  same change as KeyValueEditor's, and the Name cell below joins
                  it: unlike the Name column there, this one is read-only text
                  (the name comes from the URL), so a click on it has nothing to
                  edit and can mean "toggle this param" instead. */}
              <div className="flex items-stretch">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={enabled}
                  aria-label={`:${name} — ${enabled ? 'enabled' : 'disabled'}`}
                  onClick={() => toggleEnabled(name)}
                  className="group/toggle flex w-full cursor-pointer items-center justify-center transition-colors hover:bg-bg-2/60 focus-visible:outline-hidden focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-focus"
                  title={enabled ? t('req.disable') : t('req.enable')}
                >
                  <span
                    className={cn(
                      'flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-colors',
                      enabled
                        ? 'border-acc bg-acc text-acc-fg group-hover/toggle:border-acc-hi group-hover/toggle:bg-acc-hi'
                        : 'border-line bg-bg group-hover/toggle:border-fg-mute',
                    )}
                  >
                    {enabled && <Check className="h-2.5 w-2.5" strokeWidth={3} />}
                  </span>
                </button>
              </div>
              {/* Same reason as AuthQueryParamRow above: a long placeholder name
                  (OpenAPI specs produce plenty) would otherwise claim the whole
                  row and leave the Value field unusably narrow. */}
              <div
                onClick={() => toggleEnabled(name)}
                title={enabled ? t('req.disablePathParam') : t('req.enablePathParam')}
                className={cn(
                  'flex min-w-0 cursor-pointer select-none items-center border-r px-3 py-1 font-mono text-fg-mute transition-colors hover:bg-bg-2/60',
                  !enabled && 'opacity-40 line-through',
                )}
              >
                <span className="truncate">:{name}</span>
              </div>
              <div className="flex h-ctl min-w-0 items-center border-r px-1.5">
                <InlineCodeField
                  value={valueOf(name)}
                  onChange={(v) => setValue(name, v)}
                  vars={vars}
                  placeholder={t('value')}
                />
              </div>
              {showResolved && (
                <div className={cn('flex min-w-0 items-center border-r px-2.5', !enabled && 'opacity-40')}>
                  <ResolvedValue value={valueOf(name)} vars={vars} />
                </div>
              )}
              <div />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── settings ─────────────────────────────────────────────────────────────────

function SettingsEditor({ request, onChange }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void }) {
  const settings = request.settings;
  const set = (patch: Partial<typeof settings>) => onChange({ settings: { ...settings, ...patch } });
  const [tagDraft, setTagDraft] = useState('');

  const addTag = (raw: string) => {
    const tag = raw.trim().replace(/,$/, '').trim();
    if (tag && !settings.tags.includes(tag)) set({ tags: [...settings.tags, tag] });
    setTagDraft('');
  };

  return (
    // SettingGroup + SettingRow, the app's own shape for a panel of
    // configuration, instead of the hand-rolled label/hint/Switch row this
    // pane used to repeat. The rows now sit on one surface separated by
    // hairlines rather than floating free in a column, and they read the
    // same as the app's Settings page — which is what this pane is, scoped
    // to one request.
    <div className="max-w-xl space-y-5">
      <div className="space-y-2">
        <Label className="flex items-center gap-1.5 text-xs"><Tag className="h-3.5 w-3.5" /> {t('req.tags')}</Label>
        <div className="flex flex-wrap items-center gap-1.5 rounded-md border bg-bg px-2 py-1.5 focus-within:ring-[3px] focus-within:ring-focus">
          {settings.tags.map((tag) => (
            <span key={tag} className="flex items-center gap-1 rounded bg-bg-2 px-1.5 py-0.5 text-[11px]">
              {tag}
              <button onClick={() => set({ tags: settings.tags.filter((x) => x !== tag) })} className="text-fg-mute hover:text-bad" title={t('req.removeTag', { tag })} aria-label={t('req.removeTag', { tag })}>
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <input
            value={tagDraft}
            onChange={(e) => setTagDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTag(tagDraft); }
              if (e.key === 'Backspace' && !tagDraft && settings.tags.length) set({ tags: settings.tags.slice(0, -1) });
            }}
            onBlur={() => addTag(tagDraft)}
            placeholder={settings.tags.length ? '' : 'e.g., smoke, regression'}
            className="min-w-[8rem] flex-1 bg-transparent text-xs outline-hidden placeholder:text-fg-mute"
            spellCheck={false}
          />
        </div>
      </div>

      <SettingGroup title={t('req.groupRequest')}>
        <SettingRow
          title={t('req.urlEncoding')}
          description={t('req.urlEncodingDesc')}
          control={<Switch checked={settings.encodeUrl} onCheckedChange={(encodeUrl) => set({ encodeUrl })} aria-label={t('req.urlEncoding')} />}
        />
        <SettingRow
          title={t('req.followRedirects')}
          description={t('req.followRedirectsDesc')}
          control={<Switch checked={settings.followRedirects} onCheckedChange={(followRedirects) => set({ followRedirects })} aria-label={t('req.followRedirects')} />}
        />
        <SettingRow
          title={t('req.maxRedirects')}
          description={t('req.maxRedirectsDesc')}
          disabled={!settings.followRedirects}
          control={<NumberField value={settings.maxRedirects} onChange={(maxRedirects) => set({ maxRedirects })} label={t('req.maxRedirects')} />}
        />
        <SettingRow
          title={t('req.timeout')}
          description={t('req.timeoutDesc')}
          control={<NumberField value={settings.timeout} onChange={(timeout) => set({ timeout })} label={t('req.timeoutMs')} clearable />}
        />
      </SettingGroup>

      <SettingGroup title={t('req.security')}>
        <SettingRow
          title={t('req.sslVerify')}
          description={t('req.sslVerifyDesc')}
          control={<Switch checked={settings.verifyTls} onCheckedChange={(verifyTls) => set({ verifyTls })} aria-label={t('req.sslVerify')} />}
        />
      </SettingGroup>
      {!settings.verifyTls && (
        <Callout tone="warning" size="sm">
          {t('req.sslOffWarning')}
        </Callout>
      )}
    </div>
  );
}

// The number control inside a SettingRow — `clearable` adds the reset-to-0
// affordance the Timeout row needs (0 meaning "no limit" is not something you
// can type your way back to once a value is in the field on every platform's
// number input).
function NumberField({ value, onChange, label, clearable }: {
  value: number; onChange: (v: number) => void; label: string; clearable?: boolean;
}) {
  return (
    <div className="relative w-28">
      <Input
        type="number"
        min={0}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
        className="h-ctl text-xs"
      />
      {clearable && value > 0 && (
        <button onClick={() => onChange(0)} title={t('req.clear')} aria-label={t('req.clear')} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-fg-mute hover:text-fg">
          <X className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

// ─── body ───────────────────────────────────────────────────────────────────

// Hàm chứ không phải hằng: đọc ngôn ngữ lúc render (xem apiclient/i18n.ts).
const bodyLabel = (mode: BodyMode): string => ({
  none: t('req.noBody'),
  json: 'JSON', xml: 'XML', text: 'TEXT', sparql: 'SPARQL',
  graphql: 'GraphQL',
  multipart: t('req.multipartForm'), urlencoded: t('req.formUrlEncoded'),
  file: t('req.fileBinary'),
} satisfies Record<BodyMode, string>)[mode];

const RAW_PLACEHOLDER: Partial<Record<BodyMode, string>> = {
  json: '{\n  "key": "value"\n}',
  xml: '<root>\n  <key>value</key>\n</root>',
  sparql: 'SELECT * WHERE { ?s ?p ?o } LIMIT 10',
};

const BODY_GROUPS: { label: string; items: { id: BodyMode; icon: LucideIcon }[] }[] = [
  { label: 'Form', items: [{ id: 'multipart', icon: FormInput }, { id: 'urlencoded', icon: FormInput }] },
  { label: 'Raw', items: [{ id: 'json', icon: Braces }, { id: 'xml', icon: Code2 }, { id: 'text', icon: FileText }, { id: 'sparql', icon: Database }] },
  { label: 'GraphQL', items: [{ id: 'graphql', icon: Hexagon }] },
  { label: 'Other', items: [{ id: 'file', icon: File }, { id: 'none', icon: X }] },
];

// The grouped body-type selector that sits at the right of the request tab bar.
function BodyModeDropdown({ body, onChange }: { body: ApiRequest['body']; onChange: (p: Partial<ApiRequest>) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-1.5 py-2 text-xs font-medium text-acc-ink transition-colors hover:text-acc">
        {bodyLabel(body.mode)} <ChevronDown className="h-3.5 w-3.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56 p-1.5">
        {BODY_GROUPS.map((group) => (
          <div key={group.label} className="py-1">
            <DropdownMenuLabel>{t(`req.group.${group.label}` as 'req.group.Raw')}</DropdownMenuLabel>
            {group.items.map(({ id, icon: Icon }) => {
              const active = body.mode === id;
              return (
                <DropdownMenuItem
                  key={id}
                  onClick={() => onChange({ body: { ...body, mode: id } })}
                  className={cn(active && 'bg-acc-tint text-acc-ink')}
                  icon={<Icon className="h-3.5 w-3.5 shrink-0" />}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    {bodyLabel(id)}
                    {active && <Check className="h-3.5 w-3.5 text-acc-ink" />}
                  </span>
                </DropdownMenuItem>
              );
            })}
          </div>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function BodyEditor({ request, onChange, vars }: { request: ApiRequest; onChange: (p: Partial<ApiRequest>) => void; vars: VarMap }) {
  const { body } = request;
  const setBody = (patch: Partial<typeof body>) => onChange({ body: { ...body, ...patch } });

  if (body.mode === 'none') {
    // A GET with no body is a perfectly finished state, so this is a neutral
    // empty state, not a warning — but when a body IS wanted, pointing at a
    // menu in the tab bar cost a hunt plus two clicks. The two types that
    // cover almost every case get a button right here; the rest stay in the
    // menu, named so the pointer knows where to go.
    return (
      <EmptyState
        icon={FileQuestion}
        title={t('req.noRequestBody')}
        description={t('req.noRequestBodyDesc')}
        action={{ label: 'JSON', onClick: () => setBody({ mode: 'json' }) }}
        secondaryAction={{ label: t('req.formData'), onClick: () => setBody({ mode: 'multipart' }) }}
        className="px-4 py-10"
      />
    );
  }
  if (body.mode === 'multipart') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <MultipartEditor rows={body.form} onChange={(form) => setBody({ form })} vars={vars} />
      </div>
    );
  }
  if (body.mode === 'urlencoded') {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <KeyValueEditor rows={body.form} onChange={(form) => setBody({ form })} keyPlaceholder="Key" valueLabel="Value" vars={vars} />
      </div>
    );
  }
  if (body.mode === 'file') {
    return <FileBody body={body} setBody={setBody} />;
  }
  if (body.mode === 'graphql') {
    const g = body.graphql ?? { query: '', variables: '' };
    const setG = (patch: Partial<typeof g>) => setBody({ graphql: { ...g, ...patch } });
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex min-h-0 flex-[2] flex-col gap-1.5">
          <SectionLabel>{t('req.query')}</SectionLabel>
          <TextEditor value={g.query} onChange={(query) => setG({ query })} placeholder={'query {\n  field\n}'} vars={vars} />
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-1.5">
          <SectionLabel>{t('req.variables')}</SectionLabel>
          <JsonEditor value={g.variables} onChange={(variables) => setG({ variables })} placeholder={'{\n  "id": 1\n}'} vars={vars} />
        </div>
      </div>
    );
  }
  // raw text modes (json / xml / text / sparql) — only JSON gets its own
  // editor (grammar + inline lint); the others have no CodeMirror language
  // package, so they're plain text.
  const RawEditor = body.mode === 'json' ? JsonEditor : TextEditor;
  return (
    <div className="flex flex-col min-h-0 flex-1">
      <RawEditor
        value={body.raw}
        onChange={(raw) => setBody({ raw })}
        placeholder={body.mode === 'text' ? t('req.rawBody') : RAW_PLACEHOLDER[body.mode]}
        vars={vars}
      />
    </div>
  );
}

function FileBody({ body, setBody }: { body: ApiRequest['body']; setBody: (p: Partial<ApiRequest['body']>) => void }) {
  const pick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const base64 = String(reader.result).split(',')[1] ?? '';
        setBody({ fileName: file.name, fileType: file.type, fileContent: base64 });
      };
      reader.readAsDataURL(file);
    };
    input.click();
  };

  return (
    <div className="space-y-3 text-xs">
      {body.fileName ? (
        <div className="flex items-center gap-2 rounded-md border px-3 py-2">
          <File className="h-4 w-4 shrink-0 text-fg-mute" />
          <span className="truncate font-medium">{body.fileName}</span>
          {body.fileType && <span className="text-fg-mute">{body.fileType}</span>}
          <div className="ml-auto flex items-center gap-1">
            <Button variant="outline" size="sm" className="h-ctl" onClick={pick}>{t('req.change')}</Button>
            <button
              onClick={() => setBody({ fileName: undefined, fileType: undefined, fileContent: undefined })}
              className="rounded p-1 text-fg-mute/60 hover:text-bad"
              title={t('remove')}
              aria-label={t('remove')}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={pick}>{t('req.chooseFile')}</Button>
      )}
    </div>
  );
}

