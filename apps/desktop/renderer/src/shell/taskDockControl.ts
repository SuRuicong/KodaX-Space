export type TaskDockSectionId =
  | 'run'
  | 'plan'
  | 'agents'
  | 'workflow'
  | 'changes'
  | 'sources'
  | 'artifacts'
  | 'context';

export const TASK_DOCK_FOCUS_EVENT = 'kodax-space.task-dock-focus';

export interface TaskDockFocusRequest {
  readonly section: TaskDockSectionId;
}

export interface TaskDockFocusState {
  readonly section: TaskDockSectionId | null;
  readonly nonce: number;
}

export function requestTaskDockFocus(section: TaskDockSectionId): void {
  window.dispatchEvent(
    new CustomEvent<TaskDockFocusRequest>(TASK_DOCK_FOCUS_EVENT, {
      detail: { section },
    }),
  );
}
