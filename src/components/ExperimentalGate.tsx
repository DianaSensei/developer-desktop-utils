import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/contexts/LocaleContext';

/**
 * Consent screen an experimental tool's route is wrapped in. Deliberately
 * NOT persisted anywhere (no localStorage, no context) — `confirmed` is
 * local `useState`, and every tool in this app already remounts on each
 * sidebar navigation (see the `cachedConnections` module-scope-cache comment
 * in RedisClient.tsx and its siblings), so leaving the tool and coming back
 * naturally re-asks. That's the point: the user consents per visit, not once
 * ever, because an experimental tool's behavior can change between visits.
 */
export function ExperimentalGate({ label, children }: { label: string; children: React.ReactNode }) {
  const [confirmed, setConfirmed] = useState(false);
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
        <Button onClick={() => setConfirmed(true)}>{t('shell.experimental.continue')}</Button>
      </div>
    </div>
  );
}
