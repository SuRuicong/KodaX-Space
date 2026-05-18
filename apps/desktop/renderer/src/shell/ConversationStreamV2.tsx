// ConversationStreamV2 — F011-revised
//
// alpha.1 第一版：直接复用旧 ConversationStream 作为占位，渲染对话内容。
// tool 调用聚合（"Ran N commands ›"）留下一步专项重写——见 todo "ConversationStream.v2"。

import { useAppStore } from '../store/appStore.js';
import { ConversationStream } from '../features/session/messages/ConversationStream.js';

export function ConversationStreamV2(): JSX.Element {
  const currentSessionId = useAppStore((s) => s.currentSessionId);

  if (!currentSessionId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 text-sm gap-2">
        <span className="text-2xl" aria-hidden>✦</span>
        <span>What's up next?</span>
        <span className="text-xs text-zinc-700">Pick a session in the left sidebar, or open a folder to start.</span>
      </div>
    );
  }

  return <ConversationStream sessionId={currentSessionId} />;
}
