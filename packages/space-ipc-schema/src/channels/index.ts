// Channel registry — single source of truth.
//
// 新加 channel 步骤：
//   1) 在 channels/<name>.ts 写定义（包含 name / direction / input / output 或 payload）
//   2) import 到本文件，加进 invokeChannels 或 pushChannels 字面量对象
//   3) main 侧写 handler 用 registerChannel(...)
//   4) renderer 侧通过类型推导自动得到正确签名
//
// 为什么用两个 map 而不是 union：
//   - invoke 与 push 的 shape 不同（前者 input+output，后者 payload）
//   - TypeScript 的 discriminated union 在 mapped types 里推导成本高、可读性差
//   - 显式两个 map 让类型 + 运行时 allowlist 同源派生，preload 拿来直接用

import { versionChannel } from './version.js';
import {
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
  sessionForkChannel,
  sessionRewindChannel,
  sessionAgentsMdChannel,
  sessionEventChannel,
} from './session.js';
import {
  projectListChannel,
  projectOpenDialogChannel,
  projectRecentAddChannel,
  projectRecentRemoveChannel,
} from './project.js';
import {
  permissionRequestChannel,
  permissionCancelledChannel,
  permissionAnswerChannel,
  permissionListChannel,
  permissionRevokeChannel,
} from './permission.js';
import {
  askUserRequestChannel,
  askUserReplyChannel,
  askUserCancelledChannel,
} from './ask-user.js';
import {
  slashDiscoverChannel,
  slashExecChannel,
} from './slash.js';
import {
  skillDiscoverChannel,
  skillInvokeChannel,
} from './skill.js';
import { mcpDiscoverChannel } from './mcp.js';
import { kodaxGetDefaultsChannel } from './kodax.js';
import {
  providerListChannel,
  providerSetKeyChannel,
  providerRemoveKeyChannel,
  providerTestChannel,
  providerSetDefaultChannel,
  providerAddCustomChannel,
  providerRemoveCustomChannel,
} from './provider.js';
import { filesTreeChannel, filesReadChannel, filesDiffChannel } from './files.js';
import { titlebarSetOverlayChannel } from './titlebar.js';

export const invokeChannels = {
  [versionChannel.name]: versionChannel,
  [sessionCreateChannel.name]: sessionCreateChannel,
  [sessionSendChannel.name]: sessionSendChannel,
  [sessionCancelChannel.name]: sessionCancelChannel,
  [sessionListChannel.name]: sessionListChannel,
  [sessionDeleteChannel.name]: sessionDeleteChannel,
  [sessionSetTitleChannel.name]: sessionSetTitleChannel,
  [sessionSetReasoningModeChannel.name]: sessionSetReasoningModeChannel,
  [sessionSetProviderChannel.name]: sessionSetProviderChannel,
  [sessionSetPermissionModeChannel.name]: sessionSetPermissionModeChannel,
  [sessionSetAutoModeEngineChannel.name]: sessionSetAutoModeEngineChannel,
  [sessionForkChannel.name]: sessionForkChannel,
  [sessionRewindChannel.name]: sessionRewindChannel,
  [sessionAgentsMdChannel.name]: sessionAgentsMdChannel,
  [projectListChannel.name]: projectListChannel,
  [projectOpenDialogChannel.name]: projectOpenDialogChannel,
  [projectRecentAddChannel.name]: projectRecentAddChannel,
  [projectRecentRemoveChannel.name]: projectRecentRemoveChannel,
  [permissionAnswerChannel.name]: permissionAnswerChannel,
  [permissionListChannel.name]: permissionListChannel,
  [permissionRevokeChannel.name]: permissionRevokeChannel,
  [askUserReplyChannel.name]: askUserReplyChannel,
  [slashDiscoverChannel.name]: slashDiscoverChannel,
  [slashExecChannel.name]: slashExecChannel,
  [skillDiscoverChannel.name]: skillDiscoverChannel,
  [skillInvokeChannel.name]: skillInvokeChannel,
  [mcpDiscoverChannel.name]: mcpDiscoverChannel,
  [kodaxGetDefaultsChannel.name]: kodaxGetDefaultsChannel,
  [providerListChannel.name]: providerListChannel,
  [providerSetKeyChannel.name]: providerSetKeyChannel,
  [providerRemoveKeyChannel.name]: providerRemoveKeyChannel,
  [providerTestChannel.name]: providerTestChannel,
  [providerSetDefaultChannel.name]: providerSetDefaultChannel,
  [providerAddCustomChannel.name]: providerAddCustomChannel,
  [providerRemoveCustomChannel.name]: providerRemoveCustomChannel,
  [filesTreeChannel.name]: filesTreeChannel,
  [filesReadChannel.name]: filesReadChannel,
  [filesDiffChannel.name]: filesDiffChannel,
  [titlebarSetOverlayChannel.name]: titlebarSetOverlayChannel,
} as const;

export const pushChannels = {
  [sessionEventChannel.name]: sessionEventChannel,
  [permissionRequestChannel.name]: permissionRequestChannel,
  [permissionCancelledChannel.name]: permissionCancelledChannel,
  [askUserRequestChannel.name]: askUserRequestChannel,
  [askUserCancelledChannel.name]: askUserCancelledChannel,
} as const;

export type InvokeChannels = typeof invokeChannels;
export type PushChannels = typeof pushChannels;
