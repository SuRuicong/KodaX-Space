// PartnerWorkspace — F045 路由目标（最小占位）。
//
// F045 立 surface 路由：切到 Partner 时主区渲染本组件，证明 surface 切换不重启
// runtime、不丢 session 列表。三栏实体（Sources | 对话+任务进度 | Artifact 预览）
// 由 F046 填充；工具白名单 / 非 git 作用域由 F047；Artifact 由 F048。
//
// 占位刻意诚实：呈现将要到来的三栏轮廓 + 空态文案，不假装已有能力。

import { Handshake, FolderOpen, MessageSquare, FileOutput } from 'lucide-react';

interface ColumnStubProps {
  Icon: typeof Handshake;
  title: string;
  hint: string;
}

function ColumnStub({ Icon, title, hint }: ColumnStubProps): JSX.Element {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 p-6 text-center border-r border-border-default last:border-r-0">
      <Icon className="w-6 h-6 text-fg-muted" strokeWidth={1.5} aria-hidden />
      <div className="text-[13px] text-fg-secondary font-medium">{title}</div>
      <div className="text-[11px] text-fg-muted leading-relaxed max-w-[200px]">{hint}</div>
    </div>
  );
}

export function PartnerWorkspace(): JSX.Element {
  return (
    <div className="flex-1 flex flex-col min-w-0">
      <div className="flex items-center gap-2 px-4 h-10 border-b border-border-default flex-shrink-0">
        <Handshake className="w-4 h-4 text-accent-ink" strokeWidth={1.75} aria-hidden />
        <span className="text-[13px] text-fg-primary font-medium">Partner</span>
        <span className="text-[11px] text-fg-muted">doc-workspace · 知识工作</span>
      </div>
      <div className="flex flex-1 min-h-0">
        <ColumnStub
          Icon={FolderOpen}
          title="Sources"
          hint="知识源（文件 / 目录 / URL）将在这里列出。F047 接入非 git 作用域。"
        />
        <ColumnStub
          Icon={MessageSquare}
          title="对话 + 任务进度"
          hint="与 Partner 的多步文档事务对话。F046 接入对话流。"
        />
        <ColumnStub
          Icon={FileOutput}
          title="Artifact"
          hint="产出（报告 / slides / 表格）会显示在这里，可迭代、可导出。F048 接入。"
        />
      </div>
    </div>
  );
}
