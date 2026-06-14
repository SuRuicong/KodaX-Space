// ArtifactPanel — Partner 三栏之右栏：产物（artifact）。
//
// F048/F056：渲染走 ArtifactView 注册表。静态 tier（md/code/html/chart/...）LC-free；
// 交互 React tier 经 isReactArtifactEnabled() 门控（发布关、dev 按需开，见 artifactKind）。
// P1 smoke：门控开 + sandbox ready 时,经 ArtifactView 挂一个 recharts 测试 artifact 验活渲染。
// P2 接 artifact store + 真实产物列表/版本。

import { FileOutput } from 'lucide-react';
import { useSandboxInfo } from '../artifact/useSandboxInfo';
import { ArtifactView } from '../artifact/ArtifactView';
import { SMOKE_ARTIFACT_CODE, SMOKE_ARTIFACT_ID } from '../artifact/smokeArtifact';
import { isReactArtifactEnabled } from '../artifact/artifactKind';

function PanelShell({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <aside className="w-72 flex-shrink-0 border-l border-border-default flex flex-col bg-surface">
      <div className="px-3 h-9 flex items-center gap-2 border-b border-border-default flex-shrink-0">
        <FileOutput className="w-3.5 h-3.5 text-fg-muted" strokeWidth={1.75} aria-hidden />
        <span className="text-[11px] uppercase tracking-wider text-fg-muted">Artifact</span>
      </div>
      {children}
    </aside>
  );
}

export function ArtifactPanel(): JSX.Element {
  const sandbox = useSandboxInfo();

  // Interactive-React smoke lives behind the tier gate (F056): OFF in shipped
  // builds, dev-on-demand. Routed through ArtifactView so SandboxFrame (and its
  // LC dependency) is only ever the DEV-only lazy chunk — never in the release
  // bundle. Real static artifacts wire in here when the store layer lands.
  if (isReactArtifactEnabled() && sandbox.status === 'ready') {
    return (
      <PanelShell>
        <ArtifactView
          kind="react"
          indexUrl={sandbox.sandbox.indexUrl}
          sandboxOrigin={sandbox.sandbox.sandboxOrigin}
          code={SMOKE_ARTIFACT_CODE}
          artifactId={SMOKE_ARTIFACT_ID}
        />
      </PanelShell>
    );
  }

  return (
    <PanelShell>
      <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center">
        <FileOutput className="w-6 h-6 text-fg-muted" strokeWidth={1.5} aria-hidden />
        <div className="text-[12px] text-fg-secondary font-medium">产出会显示在这里</div>
        <div className="text-[11px] text-fg-muted leading-relaxed max-w-[200px]">
          报告 / slides / 表格等产物可预览、迭代、导出。
        </div>
      </div>
    </PanelShell>
  );
}
