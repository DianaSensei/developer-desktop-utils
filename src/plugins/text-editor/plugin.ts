import { SquareCode } from 'lucide-react';
import { definePlugin } from '@/platform';

export default definePlugin({
  id: 'text-editor',
  label: 'Text Editor',
  icon: SquareCode,
  description:
    'VS Code-style editor: open folders, browse the file tree, edit with syntax highlighting, and create, rename, move or delete files.',
  keywords: ['editor', 'code editor', 'vscode', 'ide', 'file', 'folder', 'explorer', 'workspace', 'open file', 'notepad', 'text'],
  route: '/text-editor',
  order: 220,
  defaultEnabled: true,
  // `clipboard:write` is Copy Path. `native` reaches only the editor_*
  // commands, and those only touch folders the user picked in the OS folder
  // dialog — see src-tauri/src/editor.rs.
  permissions: ['storage', 'clipboard:write', 'native'],
  commands: ['editor_'],
  sdk: '^1.0.0',
  load: () => import('@/components/tools/editor/WorkspaceEditor').then((m) => m.WorkspaceEditor),
});
