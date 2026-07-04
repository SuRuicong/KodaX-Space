// Transcript 去重 —— 纯函数,无 electron 依赖,便于单测。用于 session.history 回放,消除
// "整段对话在恢复后重复渲染"。
//
// 两种重复源(经真实数据 + 当前 SDK 真跑压缩双向验证):
//
//   A) 新 session(0.7.59 当前代码写盘):压缩时旧岛消息体被 evictOldIslandMessageContent 抹成
//      `[{type:'text',text:'[compacted]'}]` 占位,归档进 sidecar;存活消息只留 1 份真内容(active)。
//      loadFullTranscript 全谱系 = 大量 `[compacted]` 占位 + 各岛压缩摘要 + 1 份真消息。
//      → 只需**跳过 `[compacted]` 占位**即可(isCompactedPlaceholder)。
//
//   B) 旧 session(更早 SDK 版本写盘,如 s_01213312):当年没做 eviction,旧岛保留**真内容**;
//      每次压缩把存活尾部逐字节克隆成新 entry(新 entryId/timestamp),跨 N 次压缩同一逻辑消息
//      在 loadFullTranscript 里出现 N 份**真内容**副本(实测 ×3~×8)。`[compacted]` 匹配不上它们。
//      → 需按**内容**折叠这些克隆(entryContentKey)。
//
// 关键约束:克隆之间唯一共享的只有 message.content(entryId/timestamp 都不同,SDK 无 sourceEntryId/
// logicalId 稳定克隆身份;已核 KodaX 源码)。故内容是唯一可用去重键。
//
// 去重**限定在 inactive 旧岛**,活动分支(active===true)一条不碰:
//   - SDK 自己压缩时也**故意不对 user/assistant 做内容去重**("legitimate repeated user/assistant
//     content must be preserved",FEATURE_180 注释)。活动分支是当前对话,可能有合法重复(比如
//     同一轮里对同一文件读两次)——绝不能折叠。
//   - inactive 旧岛是被顶替的历史,其"重复"必是克隆/驱逐产物,折叠安全。
//   - 新 session:inactive 全是 `[compacted]`(被跳过),活动分支全保留 → 内容去重是纯 no-op、零风险。
//   - 旧 session:inactive 里的真内容克隆按内容折叠;内容独有的压缩前历史(键不重复)保留 → 既去重也不丢历史。
//
// 真实数据验证(用本模块实际代码):s_01213312 可见 70→26、20260617 50→40、大 session 1894→297,
// 残留真重复 0、活动分支 100% 保留、压缩前历史保留、`[compacted]` 隐藏。

import { createHash } from 'node:crypto';

/**
 * 一条 transcript entry 的**内容身份键**:(type, role, content, summary) 相同即视为同一条逻辑消息。
 * entryId / timestamp 在克隆副本间各不相同,**故意排除**(它们不代表内容差异)。
 */
export function entryContentKey(entry: {
  readonly type?: unknown;
  readonly message?: { readonly role?: unknown; readonly content?: unknown } | null;
  readonly summary?: unknown;
}): string {
  return createHash('sha1')
    .update(
      JSON.stringify({
        t: entry.type ?? 'message',
        r: entry.message?.role ?? null,
        c: entry.message?.content ?? null,
        s: entry.summary ?? null,
      }),
    )
    .digest('hex');
}

/**
 * 是否是 SDK eviction 写入的 `[compacted]` 占位消息(旧岛消息体被换掉、真内容已释放)。
 * SDK 用规范块形状 `[{type:'text', text:'[compacted]'}]`;容忍退化成裸字符串 `'[compacted]'`。
 * 这类块不承载真内容,回放时跳过即可——压缩边界本身由 lineage_notice(压缩摘要提示条)表达。
 */
export function isCompactedPlaceholder(entry: {
  readonly type?: unknown;
  readonly message?: { readonly content?: unknown } | null;
}): boolean {
  if (entry.type !== undefined && entry.type !== 'message') return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return content === '[compacted]';
  if (Array.isArray(content)) {
    return (
      content.length === 1 &&
      typeof content[0] === 'object' &&
      content[0] !== null &&
      (content[0] as { type?: unknown }).type === 'text' &&
      (content[0] as { text?: unknown }).text === '[compacted]'
    );
  }
  return false;
}

/**
 * 从全谱系 transcript entry 里挑出**要渲染**的那些(消除重复,保留完整历史):
 *   1. 跳过 `[compacted]` eviction 占位;
 *   2. **活动分支(active===true)全部保留**——绝不折叠合法重复的活动消息;
 *   3. inactive 旧岛:按内容 keep-first 折叠,且跳过内容已在活动分支出现过的(=re-root 克隆的旧副本)。
 * 内容独有的 inactive 压缩前历史(键既不在活动分支、也未在更早 inactive 出现过)保留 → 不丢历史。
 *
 * `active` 缺省(旧 SDK / 测试 mock 无 transcriptEntries、回退成 {type,message})时:视作非活动,
 * 按内容 keep-first 折叠全体——此路径无压缩、无重复,故等价于原样返回(安全回退)。
 */
export function dedupeTranscriptEntries<
  T extends {
    readonly active?: unknown;
    readonly type?: unknown;
    readonly message?: { readonly role?: unknown; readonly content?: unknown } | null;
    readonly summary?: unknown;
  },
>(entries: readonly T[]): T[] {
  const activeContentKeys = new Set<string>();
  for (const entry of entries) {
    if (entry.active === true && !isCompactedPlaceholder(entry)) {
      activeContentKeys.add(entryContentKey(entry));
    }
  }
  const seenInactive = new Set<string>();
  const out: T[] = [];
  for (const entry of entries) {
    if (isCompactedPlaceholder(entry)) continue; // ① eviction 占位不渲染
    if (entry.active === true) {
      out.push(entry); // ② 活动分支全保留,不碰
      continue;
    }
    const key = entryContentKey(entry); // ③ inactive:按内容折叠 re-root 克隆
    if (activeContentKeys.has(key) || seenInactive.has(key)) continue;
    seenInactive.add(key);
    out.push(entry);
  }
  return out;
}
