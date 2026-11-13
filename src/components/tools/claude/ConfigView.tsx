import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, Save, Undo2 } from 'lucide-react';
import {
  Badge, Button, Callout, ConfirmDialog, CopyButton, DataTable, DropdownMenu, DropdownMenuContent,
  DropdownMenuItem, DropdownMenuTrigger, IconButton, JsonEditor, LoadingRow, SectionLabel, Select, SelectContent,
  SelectItem, SelectTrigger, SelectValue, Tbody, Td, TextEditor, Th, Thead, Tr, buttonVariants,
} from '@/design-system';
import { useMessages } from '@/contexts/LocaleContext';
import { usePluginSdkFor } from '@/platform';
import MESSAGES from './ClaudeManager.messages';
import { DEFAULT_PROFILE, launchCommand, type Profile } from './usage';

type M = ReturnType<typeof useMessages<typeof MESSAGES>>;

// Mirrors src-tauri/src/claude_config.rs.
interface TextFile {
  exists: boolean;
  text: string;
  mtimeMs: number;
}
interface McpServer {
  name: string;
  scope: string;
  transport: string;
  target: string;
  envKeys: string[];
  headerKeys: string[];
}
interface Item {
  name: string;
  description: string | null;
}
interface ConfigSnapshot {
  settings: TextFile;
  memory: TextFile;
  mcpServers: McpServer[];
  agents: Item[];
  commands: Item[];
  skills: Item[];
}

type FileId = 'settings' | 'memory';
const FILE_NAME: Record<FileId, string> = { settings: 'settings.json', memory: 'CLAUDE.md' };

export interface HookRow {
  event: string;
  matcher: string;
  command: string;
}

export interface SettingsSummary {
  model: string | null;
  allow: number;
  deny: number;
  envKeys: string[];
  hooks: HookRow[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/**
 * What a `settings.json` sets, for the summary above the editor. Returns
 * `null` when the text is not a JSON object (the editor shows why).
 */
export function summarizeSettings(text: string): SettingsSummary | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim() || '{}');
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  const permissions = isRecord(parsed.permissions) ? parsed.permissions : {};
  const hooks: HookRow[] = [];
  for (const [event, groups] of Object.entries(isRecord(parsed.hooks) ? parsed.hooks : {})) {
    for (const group of asArray(groups)) {
      if (!isRecord(group)) continue;
      for (const hook of asArray(group.hooks)) {
        if (!isRecord(hook)) continue;
        hooks.push({
          event,
          matcher: typeof group.matcher === 'string' && group.matcher ? group.matcher : '*',
          command: String(hook.command ?? hook.prompt ?? hook.url ?? hook.type ?? ''),
        });
      }
    }
  }
  return {
    model: typeof parsed.model === 'string' ? parsed.model : null,
    allow: asArray(permissions.allow).length,
    deny: asArray(permissions.deny).length,
    envKeys: Object.keys(isRecord(parsed.env) ? parsed.env : {}),
    hooks,
  };
}

/** Turns the Rust error codes into something a person can act on. */
function saveError(m: M, raw: string): string {
  if (raw === 'conflict') return m('saveConflict');
  if (raw.startsWith('invalid-json')) return m('saveInvalidJson', { detail: raw.replace(/^invalid-json:\s*/, '') });
  if (raw === 'not-config-dir') return m('saveNotConfigDir');
  return raw;
}

function ItemList({ title, items, empty }: { title: string; items: Item[]; empty: string }) {
  return (
    <section className="min-w-0 space-y-2">
      <SectionLabel count={items.length}>{title}</SectionLabel>
      {items.length === 0
        ? <p className="text-[11px] text-fg-mute">{empty}</p>
        : (
          <ul className="space-y-1.5">
            {items.map((item) => (
              <li key={item.name} className="min-w-0">
                <div className="truncate font-mono text-xs">{item.name}</div>
                {item.description && <div className="line-clamp-2 text-[11px] text-fg-mute">{item.description}</div>}
              </li>
            ))}
          </ul>
        )}
    </section>
  );
}

interface FileEditorProps {
  file: FileId;
  loaded: TextFile;
  profile: Profile;
  others: Profile[];
  /** Saves `text` into `target`'s directory; resolves to an error message or null. */
  onSave: (file: FileId, text: string, target: Profile) => Promise<string | null>;
  m: M;
}

function FileEditor({ file, loaded, profile, others, onSave, m }: FileEditorProps) {
  const [draft, setDraft] = useState(loaded.text);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copyTo, setCopyTo] = useState<Profile | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // A reload or a save replaces what is on disk: start again from it.
  useEffect(() => {
    setDraft(loaded.text);
    setError(null);
  }, [loaded]);

  const dirty = draft !== loaded.text;
  const summary = useMemo(() => (file === 'settings' ? summarizeSettings(draft) : null), [file, draft]);
  const invalid = file === 'settings' && summary === null;

  const save = async (target: Profile) => {
    setSaving(true);
    const failed = await onSave(file, draft, target);
    setSaving(false);
    setError(failed);
    if (!failed && target.id !== profile.id) setCopied(target.label);
  };

  const Editor = file === 'settings' ? JsonEditor : TextEditor;
  return (
    <section className="space-y-2">
      <SectionLabel
        actions={(
          <div className="flex items-center gap-1.5">
            {others.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger className={buttonVariants({ variant: 'outline', size: 'sm' })} disabled={invalid || saving}>
                  {m('copyToAccount')}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {others.map((p) => (
                    <DropdownMenuItem key={p.id} onClick={() => setCopyTo(p)}>{p.label}</DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button size="sm" variant="outline" disabled={!dirty || saving} onClick={() => setDraft(loaded.text)}>
              <Undo2 className="mr-1.5 h-3.5 w-3.5" />{m('revert')}
            </Button>
            <Button size="sm" disabled={!dirty || invalid || saving} onClick={() => void save(profile)}>
              <Save className="mr-1.5 h-3.5 w-3.5" />{m('save')}
            </Button>
          </div>
        )}
      >
        {FILE_NAME[file]}
        {!loaded.exists && <span className="ml-2 normal-case text-fg-mute">{m('fileNotCreated')}</span>}
      </SectionLabel>

      {summary && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge mono>{m('summaryModel', { model: summary.model ?? m('summaryDefault') })}</Badge>
          <Badge>{m('summaryPermissions', { allow: summary.allow, deny: summary.deny })}</Badge>
          <Badge>{m('summaryHooks', { count: summary.hooks.length })}</Badge>
          <Badge>{m('summaryEnv', { count: summary.envKeys.length })}</Badge>
        </div>
      )}

      <div className="flex h-72 flex-col overflow-hidden rounded-md border border-line">
        <Editor value={draft} onChange={setDraft} ariaLabel={FILE_NAME[file]} placeholder={m(file === 'settings' ? 'settingsPlaceholder' : 'memoryPlaceholder')} />
      </div>
      {invalid && <Callout tone="warning" size="sm">{m('settingsNotObject')}</Callout>}
      {error && <Callout tone="error" size="sm">{error}</Callout>}
      {copied && !error && <Callout tone="success" size="sm">{m('copiedTo', { file: FILE_NAME[file], label: copied })}</Callout>}

      {summary && summary.hooks.length > 0 && (
        <DataTable density="compact">
          <Thead>
            <Tr>
              <Th>{m('colHookEvent')}</Th>
              <Th>{m('colHookMatcher')}</Th>
              <Th>{m('colHookCommand')}</Th>
            </Tr>
          </Thead>
          <Tbody>
            {summary.hooks.map((h, i) => (
              <Tr key={`${h.event}:${h.matcher}:${i}`}>
                <Td className="whitespace-nowrap">{h.event}</Td>
                <Td mono className="whitespace-nowrap">{h.matcher}</Td>
                <Td mono className="break-all">{h.command}</Td>
              </Tr>
            ))}
          </Tbody>
        </DataTable>
      )}

      <ConfirmDialog
        open={copyTo !== null}
        onOpenChange={(open) => { if (!open) setCopyTo(null); }}
        title={m('copyToTitle', { file: FILE_NAME[file], label: copyTo?.label ?? '' })}
        description={m('copyToBody', { file: FILE_NAME[file] })}
        confirmLabel={m('copyToConfirm')}
        onConfirm={async () => {
          const target = copyTo;
          setCopyTo(null);
          if (target) await save(target);
        }}
      />
    </section>
  );
}

export function ConfigView({ profiles }: { profiles: Profile[] }) {
  const m = useMessages(MESSAGES);
  const sdk = usePluginSdkFor('claude-manager');
  const [selected, setSelected] = useState(profiles[0]?.id ?? DEFAULT_PROFILE.id);
  const profile = profiles.find((p) => p.id === selected) ?? profiles[0] ?? DEFAULT_PROFILE;
  const [config, setConfig] = useState<ConfigSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const read = useCallback(
    (dir: string) => sdk.native.invoke<ConfigSnapshot>('claude_monitor_config', { dir }),
    [sdk],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setConfig(await read(profile.configDir));
      setError(null);
    } catch (e) {
      setConfig(null);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [read, profile.configDir]);

  useEffect(() => { void reload(); }, [reload]);

  const onSave = useCallback(async (file: FileId, text: string, target: Profile): Promise<string | null> => {
    try {
      // Saving here uses what was loaded; copying elsewhere reads the
      // target first, so its own newer edit is noticed rather than lost.
      const current = target.id === profile.id ? config : await read(target.configDir);
      const expectedMtimeMs = current?.[file].exists ? current[file].mtimeMs : null;
      const saved = await sdk.native.invoke<TextFile>('claude_monitor_write_config', {
        dir: target.configDir, file, text, expectedMtimeMs,
      });
      if (target.id === profile.id) setConfig((c) => (c ? { ...c, [file]: saved } : c));
      return null;
    } catch (e) {
      return saveError(m, e instanceof Error ? e.message : String(e));
    }
  }, [sdk, read, profile.id, config, m]);

  const others = profiles.filter((p) => p.id !== profile.id);
  const prefix = launchCommand(profile);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {profiles.length > 1 && (
          <Select value={profile.id} onValueChange={setSelected}>
            <SelectTrigger className="w-52" aria-label={m('accountFilter')}><SelectValue /></SelectTrigger>
            <SelectContent>
              {profiles.map((p) => <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <span className="min-w-0 truncate font-mono text-xs text-fg-mute">{profile.configDir}</span>
        <IconButton className="ml-auto" title={m('reloadConfig')} aria-label={m('reloadConfig')} busy={loading} onClick={() => void reload()}>
          <RefreshCw className="h-4 w-4" />
        </IconButton>
      </div>
      <Callout tone="info" size="sm">{m('configIntro')}</Callout>
      {error && <Callout tone="error" size="sm">{error}</Callout>}
      {config === null && loading && <LoadingRow label={m('loadingConfig')} />}

      {config && (
        <>
          <FileEditor key={`settings:${profile.id}`} file="settings" loaded={config.settings} profile={profile} others={others} onSave={onSave} m={m} />
          <FileEditor key={`memory:${profile.id}`} file="memory" loaded={config.memory} profile={profile} others={others} onSave={onSave} m={m} />

          <section className="space-y-2">
            <SectionLabel count={config.mcpServers.length}>{m('mcpServers')}</SectionLabel>
            <p className="text-[11px] text-fg-mute">{m('mcpHint')}</p>
            {config.mcpServers.length > 0 && (
              <DataTable density="compact">
                <Thead>
                  <Tr>
                    <Th>{m('colMcpName')}</Th>
                    <Th>{m('colMcpScope')}</Th>
                    <Th>{m('colMcpTarget')}</Th>
                    <Th>{m('colMcpSecrets')}</Th>
                    <Th />
                  </Tr>
                </Thead>
                <Tbody>
                  {config.mcpServers.map((s) => {
                    const user = s.scope === 'user';
                    const keys = [...s.envKeys, ...s.headerKeys];
                    return (
                      <Tr key={`${s.scope}:${s.name}`}>
                        <Td className="whitespace-nowrap font-medium">{s.name} <Badge mono>{s.transport}</Badge></Td>
                        <Td className="max-w-[12rem] truncate" title={s.scope}>
                          {user ? m('mcpScopeUser') : s.scope.replace(/[\\/]+$/, '').split(/[\\/]/).pop()}
                        </Td>
                        <Td mono className="break-all">{s.target}</Td>
                        <Td>
                          {keys.length === 0
                            ? <span className="text-fg-mute">—</span>
                            : <span className="flex flex-wrap gap-1">{keys.map((k) => <Badge key={k} mono>{k}</Badge>)}</span>}
                        </Td>
                        <Td align="right">
                          {user && (
                            <CopyButton
                              value={`${prefix} mcp remove ${s.name} --scope user`}
                              title={m('copyMcpRemove')}
                              aria-label={m('copyMcpRemove')}
                              iconClassName="h-3.5 w-3.5"
                            />
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </Tbody>
              </DataTable>
            )}
          </section>

          <div className="grid gap-5 @2xl:grid-cols-3">
            <ItemList title={m('agents')} items={config.agents} empty={m('noneConfigured')} />
            <ItemList title={m('commands')} items={config.commands} empty={m('noneConfigured')} />
            <ItemList title={m('skills')} items={config.skills} empty={m('noneConfigured')} />
          </div>
        </>
      )}
    </>
  );
}
