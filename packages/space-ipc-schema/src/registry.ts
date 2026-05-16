// Registry helpers — types + runtime allowlists derived from channels/.
//
// Renderer 导入 InvokeChannelName / ChannelInput<C> / ChannelOutput<C> 时拿到的是窄类型。
// Preload 导入 INVOKE_CHANNEL_NAMES / PUSH_CHANNEL_NAMES 时拿到的是 ReadonlySet<string> 运行时白名单。

import type { z } from 'zod';
import { invokeChannels, pushChannels } from './channels/index.js';

// ---- Names ----

export type InvokeChannelName = keyof typeof invokeChannels;
export type PushChannelName = keyof typeof pushChannels;

export const INVOKE_CHANNEL_NAMES: ReadonlySet<string> = new Set(Object.keys(invokeChannels));
export const PUSH_CHANNEL_NAMES: ReadonlySet<string> = new Set(Object.keys(pushChannels));

// ---- Types ----

type InvokeDef<C extends InvokeChannelName> = (typeof invokeChannels)[C];

/** 推导 invoke channel 的入参类型。*/
export type ChannelInput<C extends InvokeChannelName> = z.infer<InvokeDef<C>['input']>;

/** 推导 invoke channel 的出参类型。*/
export type ChannelOutput<C extends InvokeChannelName> = z.infer<InvokeDef<C>['output']>;

type PushDef<C extends PushChannelName> = (typeof pushChannels)[C];

/** 推导 push channel 的 payload 类型。*/
export type PushPayload<C extends PushChannelName> = z.infer<PushDef<C>['payload']>;

// ---- Lookups ----

/** 根据 channel 名取 invoke 定义；未注册返回 undefined。*/
export function getInvokeChannel(
  name: string,
): (typeof invokeChannels)[InvokeChannelName] | undefined {
  return (invokeChannels as Record<string, (typeof invokeChannels)[InvokeChannelName] | undefined>)[
    name
  ];
}

/** 根据 channel 名取 push 定义；未注册返回 undefined。*/
export function getPushChannel(
  name: string,
): (typeof pushChannels)[PushChannelName] | undefined {
  return (pushChannels as Record<string, (typeof pushChannels)[PushChannelName] | undefined>)[name];
}
