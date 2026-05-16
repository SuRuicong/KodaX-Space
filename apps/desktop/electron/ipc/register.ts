// IPC channel registration helper — wraps ipcMain.handle with zod parse + envelope.
//
// 设计：
// - 每个 channel 入参强制 zod parse，失败返回 { ok:false, error:{code:'SCHEMA_INVALID',...} }
// - handler 抛异常被 catch，转 { ok:false, error:{code:'HANDLER_ERROR',...} }
// - 出参也 zod parse（防 main 端"协议漂移"——返回的 shape 与 schema 不符也立即暴露）
// - main 永远不向 renderer throw

import { ipcMain } from 'electron';
import {
  invokeChannels,
  fail,
  ok,
  type IpcResult,
  type InvokeChannelName,
  type ChannelInput,
  type ChannelOutput,
} from '@kodax-space/space-ipc-schema';

type Handler<C extends InvokeChannelName> = (
  input: ChannelInput<C>,
) => Promise<ChannelOutput<C>> | ChannelOutput<C>;

const registeredChannels = new Set<string>();

export function registerChannel<C extends InvokeChannelName>(name: C, handler: Handler<C>): void {
  if (registeredChannels.has(name)) {
    throw new Error(`[ipc] channel already registered: ${name}`);
  }
  const def = invokeChannels[name];
  registeredChannels.add(name);

  ipcMain.handle(name, async (_event, rawInput): Promise<IpcResult<ChannelOutput<C>>> => {
    const parsedInput = def.input.safeParse(rawInput);
    if (!parsedInput.success) {
      return fail('SCHEMA_INVALID', `[${name}] input failed schema validation`, {
        issues: parsedInput.error.flatten(),
      });
    }

    let result: ChannelOutput<C>;
    try {
      result = await handler(parsedInput.data as ChannelInput<C>);
    } catch (err) {
      // 不把 err 原对象塞进 envelope——可能携带敏感字段（FEATURE_003 接 LLM 后尤其重要）
      const message = err instanceof Error ? err.message : String(err);
      return fail('HANDLER_ERROR', `[${name}] handler threw: ${message}`);
    }

    const parsedOutput = def.output.safeParse(result);
    if (!parsedOutput.success) {
      return fail('OUTPUT_INVALID', `[${name}] handler returned schema-invalid output`, {
        issues: parsedOutput.error.flatten(),
      });
    }

    return ok(parsedOutput.data as ChannelOutput<C>);
  });
}

export function listRegisteredChannels(): readonly string[] {
  return [...registeredChannels];
}
