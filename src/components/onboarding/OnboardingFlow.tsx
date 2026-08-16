import { useEffect, useState } from 'react';
import { Check, Sparkles } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { AppLogo } from '@/components/AppLogo';
import { cn } from '@/lib/utils';
import { useOnboarding } from '@/contexts/OnboardingContext';
import { useFeatures } from '@/contexts/FeatureContext';
import { ONBOARDING_TOOL_GROUPS } from '@/lib/onboardingToolGroups';

type Step = 'welcome' | 'tools' | 'done';
const STEPS: Step[] = ['welcome', 'tools', 'done'];

function selectedGroupsFromCurrentFeatures(isFeatureEnabled: (id: string) => boolean, isFavorite: (id: string) => boolean) {
  return new Set(
    ONBOARDING_TOOL_GROUPS.filter((g) => g.toolIds.some((id) => isFeatureEnabled(id) || isFavorite(id))).map((g) => g.id)
  );
}

export function OnboardingFlow() {
  const { show, completed, close } = useOnboarding();
  const { toggleFeature, toggleFavorite, isFeatureEnabled, isFavorite } = useFeatures();
  const [step, setStep] = useState<Step>('welcome');
  // Pre-check groups whose tools are already enabled/favorited, so re-opening
  // from Settings after customization doesn't look like a reset.
  const [selected, setSelected] = useState<Set<string>>(() => selectedGroupsFromCurrentFeatures(isFeatureEnabled, isFavorite));

  // Re-sync on every open (not just first mount, since this component stays
  // mounted for the app's lifetime): a reopen from Settings skips straight to
  // the tool picker (already know the app) and reflects whatever's enabled
  // right now, not a stale snapshot from the very first time it was shown.
  useEffect(() => {
    if (!show) return;
    setStep(completed ? 'tools' : 'welcome');
    setSelected(selectedGroupsFromCurrentFeatures(isFeatureEnabled, isFavorite));
    // Only re-sync when the dialog transitions to open, not on every keystroke/toggle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show]);

  const stepIndex = STEPS.indexOf(step);

  const toggleGroup = (groupId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const applySelection = () => {
    for (const group of ONBOARDING_TOOL_GROUPS) {
      if (!selected.has(group.id)) continue;
      for (const toolId of group.toolIds) {
        if (!isFeatureEnabled(toolId)) toggleFeature(toolId);
        if (!isFavorite(toolId)) toggleFavorite(toolId);
      }
    }
    setStep('done');
  };

  const handleOpenChange = (open: boolean) => {
    if (!open) close(); // Esc / overlay click behaves like Skip
  };

  return (
    <Dialog open={show} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg" hideClose>
        <div className="flex items-center justify-center gap-1.5" aria-hidden>
          {STEPS.map((s, i) => (
            <span
              key={s}
              className={cn(
                'h-1.5 rounded-full transition-all',
                i === stepIndex ? 'w-6 bg-acc' : 'w-1.5 bg-fg-mute/25'
              )}
            />
          ))}
        </div>

        {step === 'welcome' && (
          <>
            <DialogHeader className="items-center text-center">
              <AppLogo size={48} className="mb-2" />
              <DialogTitle className="text-lg">Chào mừng đến với DevTool</DialogTitle>
              <DialogDescription>
                Bộ công cụ dành cho developer: xử lý text, encode/hash, API client, mock server,
                Kafka/RabbitMQ và nhiều hơn nữa — tất cả chạy ngay trên máy bạn, không cần server.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={close}>Bỏ qua</Button>
              <Button onClick={() => setStep('tools')}>Bắt đầu</Button>
            </DialogFooter>
          </>
        )}

        {step === 'tools' && (
          <>
            <DialogHeader>
              <DialogTitle>Bạn quan tâm tới nhóm công cụ nào?</DialogTitle>
              <DialogDescription>
                Các tool trong nhóm bạn chọn sẽ được bật và ghim lên đầu sidebar. Bạn có thể đổi lại bất cứ lúc nào trong Settings.
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-2">
              {ONBOARDING_TOOL_GROUPS.map((group) => {
                const active = selected.has(group.id);
                const Icon = group.icon;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-pressed={active}
                    className={cn(
                      'flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors',
                      active
                        ? 'border-acc/50 bg-acc/10 text-fg'
                        : 'border-border hover:bg-muted/50 text-fg-mute hover:text-fg'
                    )}
                  >
                    <Icon className={cn('h-4 w-4 shrink-0', active ? 'text-acc' : 'text-fg-mute')} />
                    <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
                    {active && <Check className="h-3.5 w-3.5 shrink-0 text-acc" />}
                  </button>
                );
              })}
            </div>
            <DialogFooter className="sm:justify-between">
              <Button variant="ghost" onClick={close}>Bỏ qua</Button>
              <Button onClick={applySelection}>Tiếp tục</Button>
            </DialogFooter>
          </>
        )}

        {step === 'done' && (
          <>
            <DialogHeader className="items-center text-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-acc/10">
                <Sparkles className="h-6 w-6 text-acc" />
              </div>
              <DialogTitle className="text-lg">Sẵn sàng rồi!</DialogTitle>
              <DialogDescription>
                Các tool bạn chọn đã lên đầu sidebar. Bấm nút <span className="font-medium text-fg">?</span> ở góc trên mỗi tool bất
                cứ lúc nào để xem hướng dẫn sử dụng chi tiết.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={close} className="w-full">Bắt đầu sử dụng DevTool</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
