// ChipBar — F011-revised
//
// 输入框上方的 working context 提示行：
//   📍 Local · 📁 KodaX-Space · 🌿 main · ☑ worktree
//
// alpha.1 只显示 Local + project name + 占位 branch（v0.1.x 加 git lookup）。

import { useAppStore } from '../store/appStore.js';

export function ChipBar(): JSX.Element | null {
  const projectPath = useAppStore((s) => s.currentProjectPath);

  if (!projectPath) return null;
  const projectName = projectPath.split(/[\\/]/).filter(Boolean).pop() ?? projectPath;

  return (
    <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
      <Chip icon="📍" label="Local" />
      <Chip icon="📁" label={projectName} title={projectPath} />
      <Chip icon="🌿" label="main" hint="branch detection v0.1.x" />
    </div>
  );
}

function Chip({ icon, label, title, hint }: { icon: string; label: string; title?: string; hint?: string }): JSX.Element {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-900 border border-zinc-800"
      title={title ?? hint}
    >
      <span aria-hidden>{icon}</span>
      <span className="truncate max-w-[120px]">{label}</span>
    </span>
  );
}
