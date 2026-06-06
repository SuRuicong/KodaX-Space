// Public surface of @kodax-space/space-ipc-schema.
//
// 消费端：
//   - main:     import { invokeChannels, ok, fail } from '@kodax-space/space-ipc-schema'
//   - preload:  import { INVOKE_CHANNEL_NAMES, PUSH_CHANNEL_NAMES } from '...'
//   - renderer: import type { ChannelInput, ChannelOutput, IpcResult } from '...'
//
// FEATURE_001 时这里只有一个最小 versionChannel；FEATURE_002 起完整 envelope + registry。

export {
  IPC_ERROR_CODES,
  ipcErrorSchema,
  ok,
  fail,
  type IpcError,
  type IpcErrorCode,
  type IpcResult,
} from './envelope.js';

export {
  truncateZodError,
  type SafeZodIssue,
  type SafeZodErrorDetails,
} from './utils.js';

export { canonProjectRoot } from './path-canon.js';

export { invokeChannels, pushChannels } from './channels/index.js';
export type { InvokeChannels, PushChannels } from './channels/index.js';

export { versionChannel, type SpaceVersionOutput } from './channels/version.js';

export {
  sessionCreateChannel,
  sessionSendChannel,
  sessionCancelChannel,
  sessionListChannel,
  sessionDeleteChannel,
  sessionSetTitleChannel,
  sessionSetReasoningModeChannel,
  sessionSetProviderChannel,
  sessionSetPermissionModeChannel,
  sessionSetAutoModeEngineChannel,
  sessionSetAgentModeChannel,
  sessionForkChannel,
  sessionRewindChannel,
  sessionAgentsMdChannel,
  sessionAgentsMdSaveChannel,
  type AgentsFileMeta,
  sessionHistoryChannel,
  sessionListRunningChannel,
  type RunningSessionInfoT,
  type SessionHistoryItem,
  sessionEventChannel,
  type PermissionMode,
  type AutoModeEngine,
  type AgentMode,
  type SessionMeta,
  type SessionEvent,
  type SessionEventKind,
} from './channels/session.js';

export {
  projectListChannel,
  projectOpenDialogChannel,
  projectRecentAddChannel,
  projectRecentRemoveChannel,
  projectRecentRenameChannel,
  projectRecentSetArchivedChannel,
  projectGitStatsChannel,
  projectGitStatusChannel,
  projectGitChangesChannel,
  projectFileSearchChannel,
  projectGitDiffChannel,
  type Project,
  type ProjectGitStatsDaily,
} from './channels/project.js';

export {
  askUserRequestChannel,
  askUserReplyChannel,
  askUserCancelledChannel,
  type AskUserVerdict,
  type AskUserSignal,
  type AskUserToolCall,
  type AskUserRequestPayload,
} from './channels/ask-user.js';

export {
  slashDiscoverChannel,
  slashExecChannel,
  type SlashCommandMeta,
  type SlashCommandSource,
} from './channels/slash.js';

export {
  skillDiscoverChannel,
  skillInvokeChannel,
  type SkillMeta,
  type SkillSource,
} from './channels/skill.js';

export {
  agentDiscoverChannel,
  type AgentMeta,
  type AgentSource,
  type AgentFailure,
} from './channels/agent.js';

export {
  mcpDiscoverChannel,
  mcpServersChannel,
  mcpStartChannel,
  mcpStopChannel,
  mcpLogsChannel,
  mcpToolsChannel,
  mcpReloadChannel,
  type McpServerMeta,
  type McpTransport,
  type McpServerStatusT,
  type McpRuntimeStatusT,
} from './channels/mcp.js';

export {
  kodaxGetDefaultsChannel,
  type KodaxUserDefaults,
} from './channels/kodax.js';

export {
  kodaxQueueGetChannel,
  kodaxQueueChangedChannel,
  type QueuedMessageT,
  type MessagePriorityT,
  type MessageModeT,
  type QueueEventKindT,
} from './channels/queue.js';

export {
  permissionRequestChannel,
  permissionCancelledChannel,
  permissionAnswerChannel,
  permissionListChannel,
  permissionRevokeChannel,
  type PermissionRisk,
  type PermissionDecision,
  type PermissionToolCall,
  type PermissionRule,
  type PermissionRequestPayload,
  type PermissionCancelledPayload,
} from './channels/permission.js';

export {
  providerListChannel,
  providerSetKeyChannel,
  providerRemoveKeyChannel,
  providerTestChannel,
  providerSetDefaultChannel,
  providerAddCustomChannel,
  providerRemoveCustomChannel,
  providerModelContextWindowChannel,
  type ProviderInfo,
  type ProviderProtocol,
} from './channels/provider.js';

export {
  filesTreeChannel,
  filesReadChannel,
  filesReadBinaryChannel,
  filesDiffChannel,
  fileNodeSchema,
  MAX_FILE_BYTES,
  MAX_TREE_NODES,
  type FileNodeT,
} from './channels/files.js';

export { titlebarSetOverlayChannel } from './channels/titlebar.js';

export {
  settingsGetChannel,
  settingsSetDefaultWorkspaceChannel,
  type SpaceSettingsT,
} from './channels/settings.js';

export {
  notificationShowChannel,
  notificationClickedChannel,
} from './channels/notification.js';

export {
  updaterCheckChannel,
  updaterInstallChannel,
  updaterStatusChannel,
  type UpdaterStateT,
} from './channels/updater.js';

export {
  mcpbInstallChannel,
  mcpbUninstallChannel,
  mcpbListChannel,
  mcpbChangedChannel,
  type McpbExtensionT,
} from './channels/mcpb.js';

export {
  terminalCreateChannel,
  terminalWriteChannel,
  terminalResizeChannel,
  terminalKillChannel,
  terminalOutputChannel,
  terminalExitChannel,
  type TerminalCreateInput,
  type TerminalCreateOutput,
  type TerminalOutputPayload,
  type TerminalExitPayload,
} from './channels/terminal.js';

export {
  INVOKE_CHANNEL_NAMES,
  PUSH_CHANNEL_NAMES,
  getInvokeChannel,
  getPushChannel,
  type InvokeChannelName,
  type PushChannelName,
  type ChannelInput,
  type ChannelOutput,
  type PushPayload,
} from './registry.js';
