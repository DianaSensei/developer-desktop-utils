import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/contexts/LocaleContext';

/** Tools the user already agreed to open this session. */
const confirmedThisSession = new Set<string>();

/**
 * Consent screen an experimental tool's route is wrapped in. Asked once per
 * app session per tool — not on every visit: open tools now stay mounted
 * across tab switches, and re-asking each time a user came back was an
 * interruption without new information. Not persisted, so a restart (which
 * may bring a changed experimental tool) asks again.
 */
export function ExperimentalGate({ label, children }: { label: string; children: React.ReactNode }) {
  const [confirmed, setConfirmed] = useState(() => confirmedThisSession.has(label));
  const { t } = useLocale();
  const navigate = useNavigate();

  if (confirmed) return <>{children}</>;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 px-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-warn-tint">
        <FlaskConical className="h-6 w-6 text-warn" />
      </div>
      <div className="space-y-1 max-w-md">
        <p className="text-sm font-medium">{t('shell.experimental.consentTitle', { label })}</p>
        <p className="text-xs text-fg-mute">{t('shell.experimental.consentBody')}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>{t('shell.experimental.cancel')}</Button>
        <Button onClick={() => { confirmedThisSession.add(label); setConfirmed(true); }}>{t('shell.experimental.continue')}</Button>
      </div>
    </div>
  );
}
