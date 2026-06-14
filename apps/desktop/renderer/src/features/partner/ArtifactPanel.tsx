// ArtifactPanel — Partner 三栏之右栏：产物（artifact）。
//
// F048 路径 D：嵌 LiveCanvas sandbox 渲染基底（见记忆 livecanvas_artifact_plan）。
// P1（渲染冒烟）：sandbox ready 时，dev 下挂一个 recharts 测试 artifact 验证整条
// 嵌入链活渲染；未 ready（bundle 未装 / 打包父 origin 待 F055）则回退占位。
// P2 接 artifact store + 真实产物列表/版本；P3 接 agent 生成。

import { FileOutput } from 'lucide-react';
import { useSandboxInfo } from '../artifact/useSandboxInfo';
import { SandboxFrame } from '../artifact/SandboxFrame';
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

  // P1 smoke lives behind the interactive-React tier gate (F056): OFF in shipped
  // builds, so the LC-dependent demo never surfaces in release. The status check
  // also narrows the discriminated union for TypeScript. Real static artifacts
  // (md/code/html/chart/...) wire in via ArtifactView when the store layer lands.
  if (isReactArtifactEnabled() && sandbox.status === 'ready') {
    return (
      <PanelShell>
        <SandboxFrame
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
