import { useEffect, useState } from 'react';
import { Globe, ShieldCheck, Terminal } from 'lucide-react';
import { useFeatures } from '@/contexts/FeatureContext';
import { useLocale } from '@/contexts/LocaleContext';
import { cn } from '@/lib/utils';
import { PLUGINS, SDK_VERSION, pluginAudit, vaultStatus, type AuditEntry, type VaultStatus } from '@/platform';
import { SettingsExtensionInstaller } from '@/components/SettingsExtensionInstaller';

/**
 * Settings → Plugin: cái nhìn duy nhất cho người dùng vào Platform.
 *
 * Hai bảng, trả lời hai câu hỏi khác nhau và cố ý KHÔNG gộp: manifest nói plugin
 * ĐƯỢC PHÉP làm gì (tĩnh, đọc từ code), nhật ký nói nó ĐÃ làm gì (động, theo
 * phiên). Chỉ có bảng thứ nhất thì quyền mãi là lời hứa; chỉ có bảng thứ hai thì
 * không có gì để đối chiếu xem hành vi có vượt khai báo hay không.
 */

const MAX_ROWS = 80;

function timeOf(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function SettingsPlugins() {
  const { t } = useLocale();
  const { isFeatureEnabled } = useFeatures();
  const [entries, setEntries] = useState<AuditEntry[]>(() => pluginAudit.recent(MAX_ROWS));
  const [vault, setVault] = useState<VaultStatus | null>(null);

  useEffect(() => {
    // Nhật ký được ghi cả khi Settings đang đóng, nên đọc lại một lần lúc mount
    // rồi mới nghe tiếp — nếu chỉ nghe, panel sẽ mở ra trống trơn dù đã có lịch sử.
    setEntries(pluginAudit.recent(MAX_ROWS));
    return pluginAudit.subscribe(() => setEntries(pluginAudit.recent(MAX_ROWS)));
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Mức bảo vệ của kho bí mật khác nhau giữa các máy (keychain hay file dự
    // phòng). Người dùng có quyền biết máy mình đang ở chế độ nào thay vì phải
    // suy đoán, nên nó hiện ngay ở đây chứ không nằm trong log.
    void vaultStatus()
      .then((s) => !cancelled && setVault(s))
      .catch(() => !cancelled && setVault(null));
    return () => {
      cancelled = true;
    };
  }, []);

  const enabledCount = PLUGINS.filter((p) => isFeatureEnabled(p.id)).length;

  return (
    <section className="space-y-3">
      <p className="text-[11px] text-fg-mute -mt-1">{t('settings.plugins.description')}</p>
      <p className="text-[11px] text-fg-mute/70">
        {t('settings.plugins.count', {
          enabled: String(enabledCount),
          total: String(PLUGINS.length),
          sdk: SDK_VERSION,
        })}
      </p>

      {vault && (
        <p className={cn('text-[11px]', vault.readable ? 'text-fg-mute' : 'text-warn')}>
          {!vault.readable
            ? t('settings.plugins.vaultUnreadable')
            : vault.keyMode === 'keychain'
              ? t('settings.plugins.vaultKeychain')
              : t('settings.plugins.vaultFile')}
        </p>
      )}

      <SettingsExtensionInstaller />

      <div className="rounded-lg border divide-y">
        {PLUGINS.map((p) => {
          const Icon = p.icon;
          const on = isFeatureEnabled(p.id);
          return (
            <div
              key={p.id}
              data-plugin={p.id}
              className={cn('flex items-start gap-3 px-4 py-3', !on && 'opacity-55')}
            >
              <Icon className="h-4 w-4 shrink-0 mt-0.5 text-acc" />
              <div className="flex-1 min-w-0 space-y-1.5">
                <p className="text-xs font-medium">
                  {p.label} <span className="font-mono text-fg-mute/60">{p.id}</span>
                  {!on && <span className="ml-1.5 text-fg-mute/60">· {t('settings.plugins.off')}</span>}
                </p>

                {p.permissions.length === 0 ? (
                  <p className="text-[11px] text-fg-mute">{t('settings.plugins.noPermissions')}</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {p.permissions.map((perm) => (
                      <span
                        key={perm}
                        className="inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[11px] text-fg-mute"
                      >
                        <ShieldCheck className="h-3 w-3 text-acc/70" />
                        {perm}
                      </span>
                    ))}
                  </div>
                )}

                {p.hosts && p.hosts.length > 0 && (
                  <p className="flex items-baseline gap-1.5 text-[11px] text-fg-mute">
                    <Globe className="h-3 w-3 shrink-0 translate-y-0.5 text-fg-mute/60" />
                    <span>
                      {t('settings.plugins.hosts')}:{' '}
                      <code className="font-mono text-fg-mute/80">{p.hosts.join(' · ')}</code>
                    </span>
                  </p>
                )}

                {p.commands.length > 0 && (
                  <p className="flex items-baseline gap-1.5 text-[11px] text-fg-mute">
                    <Terminal className="h-3 w-3 shrink-0 translate-y-0.5 text-fg-mute/60" />
                    <span>
                      {t('settings.plugins.commands')}:{' '}
                      <code className="font-mono text-fg-mute/80">{p.commands.join(' · ')}</code>
                    </span>
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-1.5 pt-1">
        <p className="text-xs font-medium">{t('settings.plugins.audit')}</p>
        <p className="text-[11px] text-fg-mute">{t('settings.plugins.auditDescription')}</p>
      </div>

      <div className="rounded-lg border divide-y">
        {entries.length === 0 ? (
          <p className="px-4 py-3 text-[11px] text-fg-mute">{t('settings.plugins.auditEmpty')}</p>
        ) : (
          entries.map((e, i) => (
            <div key={`${e.ts}-${i}`} className="flex items-baseline gap-2 px-4 py-1.5 font-mono text-[11px]">
              <span className="text-fg-mute/50 tabular-nums">{timeOf(e.ts)}</span>
              <span className="min-w-0 truncate text-fg-mute/80">{e.pluginId}</span>
              <span className="text-fg-mute/50">{e.channel}</span>
              <span className="min-w-0 flex-1 truncate">{e.action}</span>
              {e.detail && <span className="hidden sm:inline truncate text-fg-mute/60">{e.detail}</span>}
              {!e.allowed && (
                <span className="shrink-0 text-warn">
                  {t('settings.plugins.auditDenied')}
                  {e.missingPermission ? ` · ${e.missingPermission}` : ''}
                </span>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
