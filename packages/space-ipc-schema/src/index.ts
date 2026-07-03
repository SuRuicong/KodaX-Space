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

export { truncateZodError, type SafeZodIssue, type SafeZodErrorDetails } from './utils.js';

export { canonProjectRoot } from './path-canon.js';

export { invokeChannels, pushChannels } from './channels/index.js';
export type { InvokeChannels, PushChannels } from './channels/index.js';

export {
  versionChannel,
  spaceCapabilitySchema,
  spaceCapabilityStatusSchema,
  type SpaceCapability,
  type SpaceCapabilityStatus,
  type SpaceVersionOutput,
} from './channels/version.js';

export {
  repointelStatusChannel,
  repointelStatusItemSchema,
  type RepointelStatusItemT,
  type RepointelStatusOutput,
} from './channels/repointel.js';

export {
  handoffAcceptChannel,
  handoffChangedChannel,
  handoffDismissChannel,
  handoffFileSchema,
  handoffListChannel,
  handoffStatusSchema,
  type HandoffFileT,
  type HandoffStatusT,
} from './channels/handoff.js';

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
  type ReasoningMode,
  type Surface,
  type SessionMeta,
  type SessionEvent,
  type SessionEventKind,
  type InputArtifact,
  type InputArtifactSource,
  type SessionSendQueueMode,
} from './channels/session.js';

export {
  clipboardSaveImageChannel,
  clipboardReadImageChannel,
  clipboardCleanupSessionChannel,
} from './channels/clipboard.js';

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
  projectGitFileDiffChannel,
  projectFileSearchChannel,
  projectGitDiffChannel,
  type Project,
  type ProjectGitStatsDaily,
} from './channels/project.js';

export {
  ASK_USER_BACK_SIGNAL,
  askUserRequestChannel,
  askUserReplyChannel,
  askUserCancelledChannel,
  type AskUserVerdict,
  type AskUserSignal,
  type AskUserToolCall,
  type AskUserQuestionOption,
  type AskUserQuestionAnswer,
  type AskUserReplyInput,
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
  skillMetaSchema,
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

export { kodaxGetDefaultsChannel, type KodaxUserDefaults } from './channels/kodax.js';

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
  providerUpdateCustomChannel,
  providerRemoveCustomChannel,
  providerModelContextWindowChannel,
  customProviderReasoningSchema,
  type ProviderInfo,
  type ProviderProtocol,
  type CustomProviderReasoning,
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

export {
  partnerSourceKindSchema,
  partnerSourceTargetKindSchema,
  partnerSourceSchema,
  partnerSourcesListChannel,
  partnerSourcesAddChannel,
  partnerSourcesRemoveChannel,
  type PartnerSourceKindT,
  type PartnerSourceTargetKindT,
  type PartnerSourceT,
} from './channels/partner-source.js';

export { titlebarSetOverlayChannel } from './channels/titlebar.js';

export {
  settingsGetChannel,
  settingsSetDefaultWorkspaceChannel,
  settingsSetLanguageModeChannel,
  settingsSetRuntimeDefaultsChannel,
  languageModeSchema,
  supportedLocaleSchema,
  resolveEffectiveLocale,
  type SpaceSettingsT,
  type SpaceRuntimeDefaultsT,
  type LanguageModeT,
  type SupportedLocaleT,
} from './channels/settings.js';

export {
  licenseBindingSchema,
  licenseDisplayEditionSchema,
  licenseEditionSchema,
  licenseEnforcementSourceSchema,
  licenseEntitlementEnvelopeSchema,
  licenseEntitlementPayloadSchema,
  licenseExportRequestChannel,
  licenseFeatureIdSchema,
  licenseGetStatusChannel,
  licenseHasFeatureChannel,
  licenseImportEntitlementChannel,
  licenseKindSchema,
  isLicenseActive,
  licenseRequireEntitlementChannel,
  licenseRuntimeStatusSchema,
  licenseStatusSchema,
  type LicenseBindingT,
  type LicenseDisplayEditionT,
  type LicenseEditionT,
  type LicenseEnforcementSourceT,
  type LicenseEntitlementEnvelopeT,
  type LicenseEntitlementPayloadT,
  type LicenseKindT,
  type LicenseRuntimeStatusT,
  type LicenseStatusT,
} from './channels/license.js';

export { notificationShowChannel, notificationClickedChannel } from './channels/notification.js';

export {
  windowActivityChannel,
  windowActivityStateSchema,
  type WindowActivityPayload,
  type WindowActivityStateT,
} from './channels/window.js';

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
  artifactKindSchema,
  artifactHtmlPermissionsSchema,
  artifactRefSchema,
  artifactCreateChannel,
  artifactListChannel,
  artifactReadChannel,
  artifactDeleteChannel,
  artifactExportChannel,
  artifactOpenWindowChannel,
  artifactChangedChannel,
  looksLikeInteractiveHtml,
  MAX_ARTIFACT_CONTENT_BYTES,
  ARTIFACT_MAX_VERSIONS,
  ARTIFACT_PERMISSION_MAX_SOURCES,
  type ArtifactKindT,
  type ArtifactHtmlPermissionsT,
  type ArtifactRefT,
} from './channels/artifact.js';

export {
  workflowListChannel,
  workflowGetChannel,
  workflowEventChannel,
  workflowRerunChannel,
  workflowSavedRenameChannel,
  workflowSavedDeleteChannel,
  workflowProcessItemSchema,
  workflowProcessSnapshotSchema,
  workflowRunSchema,
  type WorkflowProcessStatusT,
  type WorkflowProcessSnapshotT,
  type WorkflowProcessItemT,
  type WorkflowProcessItemStatusT,
  type WorkflowProcessItemKindT,
  type WorkflowProcessSummaryStatusT,
  workflowActivityChannel,
  type WorkflowRunT,
  type WorkflowEventPayload,
  type WorkflowActivityPayload,
  type WorkflowPolicyT,
} from './channels/workflow.js';

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
