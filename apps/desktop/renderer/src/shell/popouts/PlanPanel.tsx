// PlanPanel — F011-revised / alpha.1
//
// 装 KodaX Scout-seeded todo list（KodaXEvents.onTodoUpdate → session.event 'todo_update'）。
// 列表是 Scout phase 决定的多步任务，Worker 跑步骤时 status 在 pending/in_progress/completed 间流转。
// 列表全量替换（每次 onTodoUpdate 都发完整列表），渲染不需要 reducer 合并。

import { ListChecks } from 'lucide-react';
import { useAppStore } from '../../store/appStore.js';

export function PlanPanel(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);
  const todos = useAppStore((s) =>
    currentSessionId ? s.todoListBySession[currentSessionId] : undefined,
  );

  if (!currentSessionId) {
    return (
      <div className="h-full flex items-center justify-center text-fg-faint text-xs">
        No active session.
      </div>
    );
  }

  if (!todos || todos.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-fg-faint text-xs p-4 gap-2">
        <ListChecks className="w-7 h-7 text-fg-faint" strokeWidth={1.5} aria-hidden />
        <div className="text-fg-muted">No plan yet</div>
        <div className="text-center max-w-[260px]">
          Send a multi-step request. KodaX Scout will seed the todo list when planning is needed.
        </div>
      </div>
    );
  }

  const total = todos.length;
  const done = todos.filter((t) => t.status === 'completed').length;
  const running = todos.find((t) => t.status === 'in_progress');

  return (
    <div className="h-full flex flex-col text-xs">
      <header className="px-3 py-2 border-b border-border-default/60 flex items-center justify-between">
        <div className="text-fg-secondary font-medium">
          Plan{' '}
          <span className="text-fg-muted font-normal">
            ({done}/{total})
          </span>
        </div>
        {running?.activeForm && (
          <div className="text-fg-muted text-[11px] truncate ml-2 max-w-[160px]">
            {running.activeForm}
          </div>
        )}
      </header>

      <ul className="flex-1 overflow-y-auto p-2 space-y-1">
        {todos.map((todo) => (
          <li
            key={todo.id}
            className={
              'flex items-start gap-2 px-2 py-1.5 rounded ' +
              (todo.status === 'in_progress'
                ? 'bg-run/40'
                : todo.status === 'completed'
                  ? 'opacity-60'
                  : '')
            }
          >
            <span
              className={
                'flex-shrink-0 w-3 h-3 rounded-full mt-0.5 border ' +
                (todo.status === 'completed'
                  ? 'bg-ok border-ok'
                  : todo.status === 'in_progress'
                    ? 'border-run bg-run/30 animate-pulse'
                    : 'border-border-strong')
              }
              aria-label={`status: ${todo.status}`}
            />
            <span
              className={
                todo.status === 'completed' ? 'text-fg-muted line-through' : 'text-fg-primary'
              }
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
