export type FloatingSurfaceKind =
  | 'anchored_menu'
  | 'dock_sheet'
  | 'review_workspace'
  | 'artifact_workspace'
  | 'terminal_workspace'
  | 'command_overlay'
  | 'blocking_modal'
  | 'toast';

export interface FloatingSurfaceDescriptor {
  readonly id: string;
  readonly kind: FloatingSurfaceKind;
  readonly owner:
    | 'environment_hub'
    | 'task_dock'
    | 'review'
    | 'artifact'
    | 'terminal'
    | 'command'
    | 'approval'
    | 'notification';
  readonly placement:
    | 'trigger_anchored'
    | 'right_docked'
    | 'full_height_workspace'
    | 'center'
    | 'edge_stack';
  readonly modality: 'none' | 'soft_focus' | 'modal';
  readonly canAutoOpen: boolean;
  readonly dismiss:
    | 'outside_or_escape'
    | 'explicit_close'
    | 'decision_required'
    | 'timer_or_manual';
  readonly focus: 'leave_in_place' | 'move_to_surface' | 'trap_and_restore';
  readonly label: string;
}

export type FloatingPopoutKind =
  | 'preview'
  | 'diff'
  | 'terminal'
  | 'tasks'
  | 'plan'
  | 'agents'
  | 'mcp'
  | 'artifact'
  | 'workflow';

export function floatingSurfaceForPopout(kind: FloatingPopoutKind): FloatingSurfaceDescriptor {
  switch (kind) {
    case 'diff':
      return {
        id: 'review-workspace',
        kind: 'review_workspace',
        owner: 'review',
        placement: 'full_height_workspace',
        modality: 'soft_focus',
        canAutoOpen: false,
        dismiss: 'explicit_close',
        focus: 'move_to_surface',
        label: 'Review',
      };
    case 'artifact':
      return {
        id: 'artifact-workspace',
        kind: 'artifact_workspace',
        owner: 'artifact',
        placement: 'full_height_workspace',
        modality: 'soft_focus',
        canAutoOpen: false,
        dismiss: 'explicit_close',
        focus: 'move_to_surface',
        label: 'Artifact',
      };
    case 'terminal':
      return {
        id: 'terminal-workspace',
        kind: 'terminal_workspace',
        owner: 'terminal',
        placement: 'right_docked',
        modality: 'none',
        canAutoOpen: false,
        dismiss: 'explicit_close',
        focus: 'move_to_surface',
        label: 'Terminal',
      };
    case 'plan':
    case 'tasks':
    case 'workflow':
    case 'agents':
    case 'mcp':
      return {
        id: `${kind}-dock-sheet`,
        kind: 'dock_sheet',
        owner: 'task_dock',
        placement: 'right_docked',
        modality: 'none',
        canAutoOpen: false,
        dismiss: 'explicit_close',
        focus: 'move_to_surface',
        label: kind === 'tasks' ? 'Agents' : titleCase(kind),
      };
    case 'preview':
      return {
        id: 'preview-dock-sheet',
        kind: 'dock_sheet',
        owner: 'task_dock',
        placement: 'right_docked',
        modality: 'none',
        canAutoOpen: false,
        dismiss: 'explicit_close',
        focus: 'move_to_surface',
        label: 'Preview',
      };
  }
}

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}
