// Fuzzy matcher — F026 MVP (JS implementation)
//
// 目标：让 ⌘K 命令面板 / @-mention 等模糊搜索使用统一接口；F042 ready 后可切到
// napi-rs native 实现而 caller 0 改动。
//
// 当前算法（fzf-lite）：
//   1. 必须按顺序匹配 query 所有字符（大小写不敏感）
//   2. 评分（越高越好）：
//      - 连续匹配 bonus（"src/cli/main" + query "src" 优于 "user-src-record"）
//      - boundary bonus（在 path separator / 大小写边界 / 起始位置匹配的字符）
//      - basename bonus（candidate 中 last '/' 之后命中的字符额外加分）
//      - 距离惩罚（query 字符跨度越大分越低）
//   3. 排序稳定：分数相同时保持输入顺序 → 调用者预排序的"最近修改优先"被保留
//
// 性能：5k 候选 × 短 query 在 < 30ms；不依赖 DOM，可在 worker 中跑。

const SEP_RE = /[\/\\._\-\s]/;

function isBoundary(prev: string | undefined, curr: string): boolean {
  if (prev === undefined) return true; // 起始位置
  if (SEP_RE.test(prev)) return true; // separator 后
  // camelCase / PascalCase 边界
  if (prev >= 'a' && prev <= 'z' && curr >= 'A' && curr <= 'Z') return true;
  return false;
}

/**
 * 单 starting position 的贪心匹配评分。从 startIdx 开始尝试按序匹配整个 query；
 * 未能全部匹配返回 -Infinity。
 */
function scoreFromStart(
  candidate: string,
  lcCandidate: string,
  lcQuery: string,
  basenameStart: number,
  startIdx: number
): number {
  let score = 0;
  let qi = 0;
  // 初始 -2 — 防止首字符匹配时 lastMatchIdx === ci-1 在 ci=0 时误触连续判断
  let lastMatchIdx = -2;
  let consecutive = 0;

  for (let ci = startIdx; ci < lcCandidate.length && qi < lcQuery.length; ci++) {
    if (lcCandidate.charAt(ci) === lcQuery.charAt(qi)) {
      const prev = ci > 0 ? candidate.charAt(ci - 1) : undefined;
      const curr = candidate.charAt(ci);

      let bonus = 1; // 基础匹配分

      if (isBoundary(prev, curr)) {
        bonus += 6; // boundary bonus
      }

      if (ci >= basenameStart) {
        bonus += 3; // basename bonus
      }

      if (lastMatchIdx === ci - 1 && lastMatchIdx >= 0) {
        // 连续匹配累计 ramp — 让"整个词"明显压过"散落 boundary"
        // consecutive=1: +5, =2: +10... 4 个连续累计 +50 远超 4 boundary (4×6=24)
        consecutive += 1;
        bonus += consecutive * 5;
      } else {
        consecutive = 0;
        // 距离惩罚
        if (lastMatchIdx >= 0) {
          const gap = ci - lastMatchIdx - 1;
          bonus -= Math.min(gap, 10);
        }
      }

      score += bonus;
      lastMatchIdx = ci;
      qi += 1;
    }
  }

  if (qi < lcQuery.length) return -Infinity;
  return score;
}

/**
 * 单候选评分。返回 -Infinity 表示不匹配（query 字符未全部按序找到）。
 *
 * 多起点扫描：query[0] 在 candidate 中每个出现位置都尝试一次 greedy 匹配，取最高分。
 * 这避免了"贪心首匹配 — 错过更优后续路径"的问题（例如 query='src' 在 'parser-src.ts'
 * 里贪心会卡在 's' at 3 而不是 's' at 7）。
 *
 * 复杂度：O(M × N) 最坏 — M=query[0] 出现次数，N=candidate 长度。
 * 路径字符串典型 M < 5、N < 100，远低于 napi 切换的阈值。
 */
export function scoreCandidate(candidate: string, query: string): number {
  if (query.length === 0) return 0;
  const lc = candidate.toLowerCase();
  const lq = query.toLowerCase();
  const firstQuery = lq.charAt(0);

  // basenameStart 用原始 candidate 算，跟 lc 等长
  let basenameStart = 0;
  for (let i = candidate.length - 1; i >= 0; i--) {
    const ch = candidate.charAt(i);
    if (ch === '/' || ch === '\\') {
      basenameStart = i + 1;
      break;
    }
  }

  let best = -Infinity;
  for (let si = 0; si < lc.length; si++) {
    if (lc.charAt(si) !== firstQuery) continue;
    const s = scoreFromStart(candidate, lc, lq, basenameStart, si);
    if (s > best) best = s;
  }

  if (best === -Infinity) return -Infinity;
  // 短 candidate 微加分：相同分数下倾向更短
  return best - candidate.length * 0.01;
}

export interface FuzzyMatch {
  readonly item: string;
  readonly score: number;
}

export interface FuzzyMatcher {
  setCandidates(items: readonly string[]): void;
  search(query: string, limit?: number): readonly FuzzyMatch[];
}

class JsFuzzyMatcher implements FuzzyMatcher {
  private candidates: readonly string[] = [];

  setCandidates(items: readonly string[]): void {
    this.candidates = items;
  }

  search(query: string, limit = 30): readonly FuzzyMatch[] {
    const q = query.trim();
    if (q.length === 0) {
      return this.candidates.slice(0, limit).map((item) => ({ item, score: 0 }));
    }

    // 用 indexed scores 保留输入顺序（stable sort tiebreaker）
    const scored: { item: string; score: number; idx: number }[] = [];
    for (let i = 0; i < this.candidates.length; i++) {
      const item = this.candidates[i];
      if (item === undefined) continue;
      const score = scoreCandidate(item, q);
      if (score > -Infinity) scored.push({ item, score, idx: i });
    }

    // 高分在前；分数相同保输入顺序
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.idx - b.idx;
    });

    return scored.slice(0, limit).map(({ item, score }) => ({ item, score }));
  }
}

export function createMatcher(): FuzzyMatcher {
  return new JsFuzzyMatcher();
}
