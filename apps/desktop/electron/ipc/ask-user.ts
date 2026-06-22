// askUser IPC handler — FEATURE_032
//
// 单 invoke channel：renderer 回答 main 端 askUserBroker pending request。
// pending 不存在（超时 / session cancel）返回 { ok: false }——不抛错，让 renderer
// 把残留 modal 关掉就好。

import { registerChannel } from './register.js';
import { askUserBroker } from '../permission/ask-user-broker.js';

export function registerAskUserChannels(): void {
  registerChannel('askUser.reply', (input) => {
    const ok = askUserBroker.resolve(input.reqId, input);
    return { ok };
  });
}
