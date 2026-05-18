// PlanPanel — F011-revised placeholder
//
// Claude Desktop 中的 "Plan" popout 大致是：agent 跑 multi-step 任务时显示分解的 todo list +
// 已完成/进行中/待办状态。KodaX 内核已有 harness profile H2_PLAN_EXECUTE_EVAL 的"plan 步骤"概念，
// 等 Real adapter 接入后从那里取数据填充。alpha.1 留 placeholder。

export function PlanPanel(): JSX.Element {
  return (
    <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs p-4 gap-2">
      <span aria-hidden className="text-2xl">☰</span>
      <div className="text-zinc-500">Plan popout</div>
      <div className="text-center max-w-[280px]">
        Multi-step todo 视图 — Real adapter 接入后从 KodaX harness H2 plan 步骤取数据。alpha.1 placeholder。
      </div>
    </div>
  );
}
