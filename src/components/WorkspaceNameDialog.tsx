import { useState } from 'react';
import { ModalShell } from '@/components/ui/modal-shell';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useLocale } from '@/contexts/LocaleContext';

export interface WorkspaceNameDialogProps {
  mode: 'create' | 'rename';
  initialName: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

/**
 * Hộp đặt tên workspace — dùng chung cho tạo mới và đổi tên. Tên để trống vẫn
 * hợp lệ: workspace khi đó hiện tên mặc định theo số thứ tự, nên Enter ngay
 * lập tức là đường nhanh nhất để có một workspace mới.
 */
export function WorkspaceNameDialog({ mode, initialName, onSubmit, onCancel }: WorkspaceNameDialogProps) {
  const { t } = useLocale();
  const [name, setName] = useState(initialName);
  const submit = () => onSubmit(name.slice(0, 40));

  return (
    <ModalShell
      onClose={onCancel}
      title={t(mode === 'create' ? 'shell.workspace.dialogCreate' : 'shell.workspace.dialogRename')}
      description={mode === 'create' ? t('shell.workspace.dialogHint') : undefined}
      width="max-w-sm"
      align="top"
      bodyClassName="p-4"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {t('shell.workspace.cancel')}
          </Button>
          <Button size="sm" onClick={submit}>
            {t(mode === 'create' ? 'shell.workspace.create' : 'shell.workspace.save')}
          </Button>
        </div>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <Input
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('shell.workspace.namePlaceholder')}
          aria-label={t(mode === 'create' ? 'shell.workspace.dialogCreate' : 'shell.workspace.dialogRename')}
        />
      </form>
    </ModalShell>
  );
}
