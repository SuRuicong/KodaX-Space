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
  sessionEventChannel,
  type PermissionMode,
  type AutoModeEngine,
  type SessionMeta,
  type SessionEvent,
  type SessionEventKind,
} from './channels/session.js';

export {
  projectListChannel,
  projectOpenDialogChannel,
  projectRecentAddChannel,
  projectRecentRemoveChannel,
  type Project,
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
  type ProviderInfo,
  type ProviderProtocol,
} from './channels/provider.js';

export {
  filesTreeChannel,
  filesReadChannel,
  filesDiffChannel,
  fileNodeSchema,
  MAX_FILE_BYTES,
  MAX_TREE_NODES,
  type FileNodeT,
} from './channels/files.js';

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
