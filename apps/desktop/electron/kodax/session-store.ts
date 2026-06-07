// Session store — FEATURE_038 (v0.1.6).
//
// 包装 KodaX SDK 的 @kodax-ai/kodax/session subpath，把 Space 的 main 端
// fork/rewind/list 接到磁盘持久化。F033 in-memory 实现保留为 in-flight session 的
// runtime layer——这层只管已写盘的 historical sessions + 改盘操作。
//
// 设计：
//   - 所有 SDK 函数 NEVER throw（按 sdk-session.d.ts 注释保证）；本层不再包 try/catch
//     里多余的 envelope——直接把 null / error 转译成 host.ts 期望的形态
//   - watchSessions 通过 push channel 派发到 renderer，让 sidebar 自动刷新
//
// 与 F033 in-memory 的关系（host.ts 合并）：
//   list  → SDK listSessions + in-memory in-flight（in-flight 同名优先；运行时设置 full-detail）
//   fork  → SDK forkSession 出新 sessionId；新 sessionId 由 host 加进 in-memory map
//   rewind→ SDK rewindSession（持久化截断）+ host cancel in-flight (await)

// FEATURE_038 测试 DI：
//
// SDK session 函数是模块级单例（FileSessionStorage 读 KODAX_SESSIONS_DIR 模块加载
// 时定型，旧版 SDK 不能运行时改）——单元测试既不能注入自定义 sessionsDir，又不该
// 真去写 ~/.kodax/sessions/。所以本模块暴露一个可替换的 impl 引用：
//   - 生产代码不调 setSessionStoreImpl → 走真 SDK（首次调用时 dynamic import 拉起）
//   - 测试 beforeEach 调 setSessionStoreImpl(mock) → 注入 in-memory mock
//                                                  (避免 dynamic import 触发 cli-boxes JSON bug)
//
// 重置：setSessionStoreImpl(null) 恢复默认。
type SdkSessionModule = typeof import('@kodax-ai/kodax/session');

export interface SessionStoreImpl {
  readonly listSessions: SdkSessionModule['listSessions'];
  readonly forkSession: SdkSessionModule['forkSession'];
  readonly rewindSession: SdkSessionModule['rewindSession'];
  readonly deleteSession: SdkSessionModule['deleteSession'];
  readonly loadSession: SdkSessionModule['loadSession'];
  readonly watchSessions: SdkSessionModule['watchSessions'];
  /** optional — mock impls can omit; default impl wires via createSessionManager when present. */
  readonly createSessionManager?: SdkSessionModule['createSessionManager'];
}

// 生产路径：lazy 加载 SDK 模块。第一次某个 default 包装被调时才拉 SDK；
// 测试注入 mock 后永远不会触发这里。
let sdkModuleCache: SdkSessionModule | null = null;
async function loadSdkModule(): Promise<SdkSessionModule> {
  if (sdkModuleCache === null) {
    sdkModuleCache = await import('@kodax-ai/kodax/session');
  }
  return sdkModuleCache;
}

/**
 * SDK createSessionManager() 返回的 manager 含 `storage` 字段 (FileSessionStorage 实例)。
 * Space 在 runKodaX 时把这个 storage 传给 session.storage —— 否则 SDK 的
 * saveSessionSnapshot 静默 no-op，jsonl 不会落盘。Manager 是 singleton（共享底层 fs
 * 写队列），整个 Space 进程共用一个。
 *
 * 如果当前安装的 SDK 还没暴露 createSessionManager / storage handle（旧版），
 * getSessionStorageHandle() 返回 undefined，real-session 透传给 SDK 仍安全（行为
 * 退回为"不落盘"）。新版 SDK 一就位自动生效。
 */
type SessionManager = ReturnType<SdkSessionModule['createSessionManager']>;
let managerCache: SessionManager | null = null;
async function getManager(): Promise<SessionManager> {
  if (managerCache === null) {
    const sdk = await loadSdkModule();
    managerCache = sdk.createSessionManager();
  }
  return managerCache;
}

/**
 * real-session 调这个拿 storage handle 喂给 runKodaX。SDK 未暴露 createSessionManager
 * 时（旧版本）throw —— caller fallback 为 undefined，行为退回"不落盘"。
 */
export async function getSessionStorageHandle(): Promise<unknown> {
  try {
    const m = await getManager();
    // `storage` 字段在新版 SDK 才暴露；旧版没有该属性，cast 成 unknown 后访问让
    // typecheck 在两边都过。运行时安全——没有 storage 时返回 undefined，
    // real-session 透传给 SDK 走 no-storage 路径。
    return (m as unknown as { storage?: unknown }).storage;
  } catch (err) {
    console.warn(`[session-store] getSessionStorageHandle failed (SDK lacks createSessionManager?): ${err instanceof Error ? err.message : String(err)}`);
    return undefined;
  }
}

const DEFAULT_IMPL: SessionStoreImpl = {
  listSessions: async (opts) => (await loadSdkModule()).listSessions(opts),
  forkSession: async (id, opts) => (await loadSdkModule()).forkSession(id, opts),
  rewindSession: async (id, opts) => (await loadSdkModule()).rewindSession(id, opts),
  deleteSession: async (id) => (await loadSdkModule()).deleteSession(id),
  loadSession: async (id) => (await loadSdkModule()).loadSession(id),
  createSessionManager: (opts?: { sessionsDir?: string }) => {
    // 默认 impl 路径返回 lazily — 但 caller (real-session) 通过 getSessionStorageHandle()
    // 拿 cached manager，不直接走这里。这条 entry 主要给测试 inject mock 用。
    if (!sdkModuleCache) throw new Error('SDK not loaded yet — call loadSdkModule first');
    return sdkModuleCache.createSessionManager(opts);
  },
  // watchSessions 不能 async（返回 { close }），需要立即同步拿到 close handle
  watchSessions: (cb) => {
    // lazy 加载下的妥协：用 stub close handle 占位；await 完成后真 close 路由到真实 watcher
    let realClose: (() => void) | null = null;
    let cancelled = false;
    void loadSdkModule().then((sdk) => {
      if (cancelled) return;
      const w = sdk.watchSessions(cb);
      realClose = w.close;
    });
    return {
      close: () => {
        cancelled = true;
        realClose?.();
      },
    };
  },
};

let activeImpl: SessionStoreImpl = DEFAULT_IMPL;

/** 测试用：注入 mock SDK 实现。生产代码不调。 */
export function setSessionStoreImpl(impl: SessionStoreImpl | null): void {
  activeImpl = impl ?? DEFAULT_IMPL;
  clearPersistedSessionCache(); // 切 impl 必清缓存，避免 test 之间读到生产值
}

export interface PersistedSessionMeta {
  /** SDK session id */
  readonly sessionId: string;
  /** SDK title (always present; default 'Untitled' or first prompt) */
  readonly title: string;
  /** SDK message count */
  readonly msgCount: number;
  /** ISO date string when available */
  readonly createdAt?: string;
  /** workspaceRoot (= projectRoot) 若 SDK runtimeInfo 提供 */
  readonly projectRoot?: string;
}

/**
 * 拉指定 projectRoot 下的 historical sessions（写盘的）。
 *
 * - opts.projectRoot 透传给 SDK 做 git-root scoping（SDK 自己负责正规化）
 * - scope 限制为 'user'——managed-task-worker 是子 agent 内部 session，不该在
 *   sidebar 当主对话显示
 * - limit 缺省 200——大于 F033 in-memory 的常见 100 量级，UI 翻滚也撑得住
 */
// SDK 0.7.46 slow-path trigger: future-dated `before` 让 SDK listSessions
// 不进 fast path（fast path 内部 storage.list(undefined) 会 fallback hostCwd
// 把当前进程目录当 gitRoot,Space 启动目录是 KodaX-Space → 只看到自家 session）。
// '2999-01-01' 远超任何合理 createdAt,等效"全量"。slow path 扫所有 projectKey
// 子目录 + flat,自己做 scope='user' filter,不引入 archived 副作用。
//
// 见 KodaX session/public-api.ts:206 fast-path guard:
//   `if (scope === 'user' && !gitRoot && before === undefined && !includeArchived)`
//
// 已写需求给 KodaX team：暴露 explicit `allProjects: true` 或 `scope: 'all-user'`
// 选项,免去 sentinel date hack。
const FORCE_SLOW_PATH_BEFORE = '2999-01-01T00:00:00.000Z';

export async function listPersistedSessions(opts: {
  readonly projectRoot?: string;
  readonly limit?: number;
}): Promise<PersistedSessionMeta[]> {
  // 当 caller 传了 projectRoot,SDK fast path 用 caller 给的 gitRoot 算 projectKey,
  // 不再 fallback hostCwd —— 这条路径 fast path 是对的,不必触发 slow。
  // 当 caller 不传 projectRoot,fast path 退到 fallback hostCwd 漂移,得强制 slow。
  const summaries = await activeImpl.listSessions({
    projectRoot: opts.projectRoot,
    scope: 'user',
    limit: opts.limit ?? 200,
    ...(opts.projectRoot === undefined ? { before: FORCE_SLOW_PATH_BEFORE } : {}),
  });
  return summaries.map((s) => ({
    sessionId: s.id,
    title: s.title,
    msgCount: s.msgCount,
    createdAt: s.createdAt,
    projectRoot: s.runtimeInfo?.workspaceRoot ?? s.runtimeInfo?.gitRoot,
  }));
}

/**
 * 持久化 fork：写盘出一个新 sessionId 继承 source 的 lineage。
 *
 * 返回 null 当 source 不存在；否则 newSessionId + title。
 *
 * 注：SDK 内部根据 selector 切 lineage（v0.7.42 fork 用 active entry；selector 缺省
 * 为 active）。Space 的 forkPointTurnIdx 当前还没接 selector——v0.1.6 仅做"在
 * active entry 处 fork"，下一版本接 turn-precise selector。
 */
export async function forkPersistedSession(opts: {
  readonly sourceSessionId: string;
  readonly title?: string;
}): Promise<{ readonly newSessionId: string; readonly title: string } | null> {
  const result = await activeImpl.forkSession(opts.sourceSessionId, {
    title: opts.title,
  });
  if (!result) return null;
  // Fork 把 source session 的尾部消息可能复制走/留下；缓存里的 source data 可能过期。
  // 清掉 source 的缓存，下次 session.history 重读。
  invalidatePersistedSessionCache(opts.sourceSessionId);
  return {
    newSessionId: result.sessionId,
    title: result.data.title,
  };
}

/**
 * 持久化 rewind：把 session 倒回某个 selector。selector 缺省回退到前一个 user entry。
 *
 * 返回 true 当 SDK 成功 rewind（含 session 存在 + lineage 有 user entry 可退）；
 * 返回 false 当 sessionId 不存在或没有 entry 可退。
 *
 * 注意：SDK rewindSession NEVER throws；这层不包 try/catch。
 */
export async function rewindPersistedSession(opts: {
  readonly sessionId: string;
}): Promise<boolean> {
  const data = await activeImpl.rewindSession(opts.sessionId);
  if (data !== null) {
    invalidatePersistedSessionCache(opts.sessionId); // 截断后旧 data 过期
  }
  return data !== null;
}

/**
 * 持久化删除。session 当前在跑（其他 KodaX 进程 hold 着）时返回 'busy'。
 *
 * 与 host.delete 区别：host.delete 是 dispose in-memory in-flight；这里是擦盘。
 * 通常调用顺序：host.delete (cancel + dispose) → deletePersistedSession (擦盘)。
 */
export async function deletePersistedSession(opts: {
  readonly sessionId: string;
}): Promise<'ok' | 'busy'> {
  const result = await activeImpl.deleteSession(opts.sessionId);
  if ('ok' in result) {
    invalidatePersistedSessionCache(opts.sessionId);
    return 'ok';
  }
  return 'busy';
}

/**
 * 读单 session 完整数据（messages + title + lineage 等）。
 *
 * **LRU 缓存** (alpha.2)：session.history IPC 在用户点回旧 session 时调，无缓存时每次
 * 重读完整 jsonl (几 MB)。LRU 5 个 session 上限——刚好覆盖"最近用过的几个 session 切来
 * 切去"场景。缓存条目在 deletePersistedSession / fork / rewind 时清掉，避免读到过期数据。
 *
 * 失效语义：进程内只看自身 mutation；其他进程 (KodaX CLI) 改写同一 session 后 Space 进程
 * 不知道——这是已有的约束 (Space 不监听 jsonl 文件变化)，缓存不放大此问题。
 *
 * 返回 null 当 sessionId 不存在。
 */
type LoadedSessionData = Awaited<ReturnType<SessionStoreImpl['loadSession']>>;

const LOAD_CACHE_MAX = 5;
const loadCache = new Map<string, LoadedSessionData>();

export async function loadPersistedSession(
  sessionId: string,
): Promise<LoadedSessionData | null> {
  const cached = loadCache.get(sessionId);
  if (cached !== undefined) {
    // LRU recency bump: 删后重 set 让 Map iteration 顺序刷新（Map insertion order = 最近使用）
    loadCache.delete(sessionId);
    loadCache.set(sessionId, cached);
    return cached;
  }
  const data = await activeImpl.loadSession(sessionId);
  if (data === null) return null;
  loadCache.set(sessionId, data);
  // Evict oldest 一直保持 <= MAX
  while (loadCache.size > LOAD_CACHE_MAX) {
    const oldestKey = loadCache.keys().next().value;
    if (oldestKey === undefined) break;
    loadCache.delete(oldestKey);
  }
  return data;
}

/** Mutator 调用——deletePersistedSession / fork / rewind 后清对应缓存项。*/
export function invalidatePersistedSessionCache(sessionId: string): void {
  loadCache.delete(sessionId);
}

/** 测试 / setStorageImpl 注入 mock 后清整张缓存。*/
export function clearPersistedSessionCache(): void {
  loadCache.clear();
}

/**
 * 监听 sessions 目录变更——文件 add / remove / change。回调里通常调
 * pushToRenderer('session.list-changed') 让 renderer 重拉 list。
 *
 * NEVER throws；返回的 close() 可幂等调用。
 */
export function watchPersistedSessions(
  callback: (event: { kind: 'add' | 'remove' | 'change'; sessionId: string }) => void,
): { close: () => void } {
  return activeImpl.watchSessions(callback);
}
