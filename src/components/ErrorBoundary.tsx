import { Component, useState, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CopyButton } from '@/components/ui/copy-button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useLocale } from '@/contexts/LocaleContext';
import { storageKeys, storageRemove } from '@/lib/persistentStore';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Changing this resets the boundary (e.g. the active route path). */
  resetKey?: unknown;
  /** Plugin id of the tool inside, for "Clear this tool's data". */
  toolId?: string;
  /** Tool name for the confirmation dialog. */
  toolLabel?: string;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/**
 * Catches render errors in a subtree so one crashing tool shows a recoverable
 * message instead of unmounting the whole app (a blank window). Resets when
 * `resetKey` changes — e.g. when navigating to another tool.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the stack in the dev console; there's no remote reporting.
    console.error('Tool crashed:', error, info.componentStack);
  }

  componentDidUpdate(prev: ErrorBoundaryProps) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: null });
    }
  }

  render() {
    if (this.state.error) {
      return (
        <ToolErrorFallback
          error={this.state.error}
          toolId={this.props.toolId}
          toolLabel={this.props.toolLabel}
          onRetry={() => this.setState({ error: null })}
        />
      );
    }
    return this.props.children;
  }
}

/** Removes every persisted `devtool:<toolId>:*` key (not the secret vault). */
export function clearToolData(toolId: string) {
  const prefix = `devtool:${toolId}:`;
  for (const key of storageKeys()) {
    if (key.startsWith(prefix)) storageRemove(key);
  }
}

function ToolErrorFallback({ error, toolId, toolLabel, onRetry }: {
  error: Error;
  toolId?: string;
  toolLabel?: string;
  onRetry: () => void;
}) {
  const { t } = useLocale();
  const [confirmClear, setConfirmClear] = useState(false);
  // A crash caused by saved input repeats on every retry; clearing the
  // tool's own namespace is the way out short of wiping the whole app.
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6 text-center">
      <AlertTriangle className="h-ctl w-ctl text-warn" />
      <div>
        <p className="text-sm font-semibold">{t('shell.error.title')}</p>
        <p className="mt-1 max-w-md text-xs text-fg-mute break-words">
          {error.message || t('shell.error.fallback')}
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button variant="outline" size="sm" onClick={onRetry} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> {t('shell.error.retry')}
        </Button>
        <CopyButton
          variant="ghost"
          size="sm"
          value={() => `${error.name}: ${error.message}\n${error.stack ?? ''}`}
          label={t('shell.error.copyDetails')}
        />
      </div>
      {toolId && (
        <>
          <p className="max-w-md text-[11px] text-fg-mute">{t('shell.error.clearHint')}</p>
          <Button variant="ghost" size="sm" onClick={() => setConfirmClear(true)} className="gap-1.5 text-bad">
            <Trash2 className="h-3.5 w-3.5" /> {t('shell.error.clearData')}
          </Button>
          <ConfirmDialog
            open={confirmClear}
            onOpenChange={setConfirmClear}
            title={t('shell.error.clearTitle', { label: toolLabel ?? toolId })}
            description={t('shell.error.clearBody')}
            confirmLabel={t('shell.error.clearConfirm')}
            onConfirm={() => { clearToolData(toolId); onRetry(); }}
          />
        </>
      )}
    </div>
  );
}
