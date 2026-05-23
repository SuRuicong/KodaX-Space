// WelcomeDashboard — alpha.1
//
// Claude Desktop 截图 6 同款"无 session"首屏：
//
//   ✱ What's up next, <user>?
//
//   ┌────────────────────────────────────────────────┐
//   │ Overview  Models                  All 30d 7d   │
//   │ ──────────────────────────────────────────     │
//   │  Sessions     Messages    Tokens     Active    │
//   │  267           301k        213M       56d      │
//   │  Streak        Longest     Peak       Fav      │
//   │  10d           25d         9 AM       Opus 4.7 │
//   │                                                │
//   │  ▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢▢       │  ← heatmap
//   │  ...                                           │
//   │  You've used ~3449× more tokens than ...       │
//   └────────────────────────────────────────────────┘
//
// 数据来源：renderer 本地 (sessions + 当前 currentProjectPath 下 lastActivityAt + events)
//   - Sessions count = sessions.length
//   - Messages = Σ userMessagesBySession 长度 (用户已发条数)
//   - Tokens = 取每个 session 最后一次 iteration_end 的 tokenCount 累加 (近似)
//   - Active days = 把 sessions[].lastActivityAt 按日截断后去重数
//   - Streak = 从今天往回数连续有 active day 的天数
//   - Peak hour = 最常出现 lastActivityAt 的小时
//   - Favorite model = sessions[].provider 众数
//   - Heatmap = 按日 (今天 - 35 天) 截断后计数 → 4 档颜色
//
// 所有派生量都是 useMemo cached；alpha.1 不去 main 端取，避免 IPC。
// 数据少时（< 10 sessions）也照常显示，0 sessions 时显示 placeholder。

import { useMemo } from 'react';
import { useAppStore } from '../store/appStore.js';

export function WelcomeDashboard(): JSX.Element {
  const sessions = useAppStore((s) => s.sessions);
  const userMessagesBySession = useAppStore((s) => s.userMessagesBySession);
  const eventsBySession = useAppStore((s) => s.eventsBySession);
  const providers = useAppStore((s) => s.providers);
  const currentProjectPath = useAppStore((s) => s.currentProjectPath);

  const stats = useMemo(() => {
    // 聚合
    let messages = 0;
    let tokens = 0;
    const activeDays = new Set<string>();
    const hourCount = new Map<number, number>();
    const providerCount = new Map<string, number>();

    for (const s of sessions) {
      messages += userMessagesBySession[s.sessionId]?.length ?? 0;
      const evs = eventsBySession[s.sessionId] ?? [];
      // 最后一次 iteration_end 的 tokenCount
      for (let i = evs.length - 1; i >= 0; i--) {
        const ev = evs[i];
        if (ev.kind === 'iteration_end') {
          tokens += ev.tokenCount;
          break;
        }
      }
      const d = new Date(s.lastActivityAt);
      activeDays.add(d.toISOString().slice(0, 10));
      hourCount.set(d.getHours(), (hourCount.get(d.getHours()) ?? 0) + 1);
      providerCount.set(s.provider, (providerCount.get(s.provider) ?? 0) + 1);
    }

    // Streak：从今天往回数有 active 的连续天数
    const today = new Date();
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      if (activeDays.has(key)) streak++;
      else break;
    }
    // Longest streak：扫历史 active day set 找最长连续
    const sortedDays = Array.from(activeDays).sort();
    let longest = 0;
    let run = 0;
    let prev: string | null = null;
    for (const day of sortedDays) {
      if (prev === null) { run = 1; }
      else {
        const prevDate = new Date(prev);
        const curDate = new Date(day);
        const diff = Math.round((curDate.getTime() - prevDate.getTime()) / (24 * 3600 * 1000));
        run = diff === 1 ? run + 1 : 1;
      }
      if (run > longest) longest = run;
      prev = day;
    }

    // Peak hour
    let peakHour = 0;
    let peakCount = 0;
    for (const [h, c] of hourCount) {
      if (c > peakCount) { peakHour = h; peakCount = c; }
    }
    const peakHourStr = peakCount === 0 ? '—' : peakHour === 0 ? '12 AM' : peakHour < 12 ? `${peakHour} AM` : peakHour === 12 ? '12 PM' : `${peakHour - 12} PM`;

    // Favorite provider
    let favProvider = '—';
    let favCount = 0;
    for (const [id, c] of providerCount) {
      if (c > favCount) { favProvider = id; favCount = c; }
    }
    const favProviderLabel = providers.find((p) => p.id === favProvider)?.displayName ?? favProvider;

    return {
      sessions: sessions.length,
      messages,
      tokens,
      activeDays: activeDays.size,
      streak,
      longest,
      peakHourStr,
      favProviderLabel,
      activeDaysSet: activeDays,
    };
  }, [sessions, userMessagesBySession, eventsBySession, providers]);

  // 用户名：尝试从 currentProjectPath 末尾抓最后一段；fallback "there"
  const userName = useMemo(() => {
    if (!currentProjectPath) return 'there';
    const segs = currentProjectPath.split(/[\\/]/).filter(Boolean);
    return segs[segs.length - 1] ?? 'there';
  }, [currentProjectPath]);

  // Heatmap：过去 35 天 × 1 行（简化），每天显示一个格子
  const heatmap = useMemo(() => {
    const out: { date: string; count: number }[] = [];
    const today = new Date();
    for (let i = 34; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(today.getDate() - i);
      const key = d.toISOString().slice(0, 10);
      // 用 active 与否当 count（细化可在 sessions 里累加）
      out.push({ date: key, count: stats.activeDaysSet.has(key) ? 1 : 0 });
    }
    return out;
  }, [stats.activeDaysSet]);

  // 一句话比喻：tokens / gatsby 词数 (~50k tokens)
  const gatsbyMul = stats.tokens > 0 ? Math.round(stats.tokens / 50_000) : 0;

  return (
    <div className="flex-1 overflow-auto px-6 py-10 flex flex-col items-center">
      {/* 大标题 */}
      <h1 className="text-2xl text-zinc-100 mb-8 flex items-center gap-2">
        <span className="text-amber-400" aria-hidden>✱</span>
        What's up next, <span className="font-semibold">{userName}</span>?
      </h1>

      {/* Overview 卡 */}
      <div className="w-full max-w-3xl bg-zinc-900/60 border border-zinc-800 rounded-lg p-5">
        {/* Tab + 时间范围 */}
        <div className="flex justify-between items-center mb-4 text-xs">
          <div className="flex gap-3">
            <span className="text-zinc-100 border-b border-zinc-100 pb-0.5">Overview</span>
            <span className="text-zinc-500">Models</span>
          </div>
          <div className="flex gap-2 text-zinc-500">
            <span className="text-zinc-100">All</span>
            <span>30d</span>
            <span>7d</span>
          </div>
        </div>

        {/* 8 stats */}
        <div className="grid grid-cols-4 gap-x-6 gap-y-4 mb-6">
          <StatCell label="Sessions" value={formatNum(stats.sessions)} />
          <StatCell label="Messages" value={formatNum(stats.messages)} />
          <StatCell label="Total tokens" value={formatTokensBig(stats.tokens)} />
          <StatCell label="Active days" value={String(stats.activeDays)} />
          <StatCell label="Current streak" value={`${stats.streak}d`} />
          <StatCell label="Longest streak" value={`${stats.longest}d`} />
          <StatCell label="Peak hour" value={stats.peakHourStr} />
          <StatCell label="Favorite model" value={stats.favProviderLabel} truncate />
        </div>

        {/* Heatmap（35 天单行） */}
        <div className="mb-3">
          <div className="flex gap-0.5 flex-wrap">
            {heatmap.map((d) => (
              <div
                key={d.date}
                className={`w-3.5 h-3.5 rounded-sm ${
                  d.count === 0 ? 'bg-zinc-800/50' : 'bg-blue-500'
                }`}
                title={`${d.date} · ${d.count > 0 ? 'active' : 'no activity'}`}
              />
            ))}
          </div>
        </div>

        {/* 一句话 */}
        {gatsbyMul > 0 && (
          <div className="text-xs text-zinc-500">
            You've used ~{gatsbyMul}× more tokens than The Great Gatsby.
          </div>
        )}
        {stats.sessions === 0 && (
          <div className="text-xs text-zinc-500 italic">
            No sessions yet — type below to start one.
          </div>
        )}
      </div>

      {/* 像素狗 (alpha.1 简版 — 用 emoji 代替) */}
      <div className="mt-8 text-2xl select-none" aria-hidden>🐕</div>
    </div>
  );
}

function StatCell({ label, value, truncate }: { label: string; value: string; truncate?: boolean }): JSX.Element {
  return (
    <div className="min-w-0">
      <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-0.5">{label}</div>
      <div className={`text-lg text-zinc-100 ${truncate ? 'truncate' : ''}`} title={value}>{value}</div>
    </div>
  );
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function formatTokensBig(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}
