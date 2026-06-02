# Changelog

All notable changes to KodaX-Space will be documented in this file.

KodaX-Space is the Electron desktop client for the [KodaX SDK](https://github.com/icetomoyo/KodaX) — Claude Desktop-style interactive surface, GUI alternative to the `kodax` REPL.

## [Unreleased]

### Added

- **`mimo` provider (Xiaomi direct-connect)** — built-in catalog now lists `mimo` alongside the existing `mimo-coding` subscription variant. `mimo` uses the Anthropic-compatible protocol with `MIMO_API_KEY` (test endpoint URL pending Xiaomi docs — UI skips connect-test until then). Fallback count bumped 13 → 14. Bundled into the UI padding commit ([59bb068](https://github.com/icetomoyo/KodaX-Space/commit/59bb068)) by accident — `git add -A` swept user's pending working-tree changes, recorded here so git-log searches by feature still find it.

### Changed

- **Conversation stream layout** ([53ab954](https://github.com/icetomoyo/KodaX-Space/commit/53ab954), tightened in [59bb068](https://github.com/icetomoyo/KodaX-Space/commit/59bb068)) — horizontal padding `px-8` (~4 char each side) + left timeline rail (vertical guide line with color-coded dot markers per message: user=sky, assistant=emerald, system=amber, tool=zinc). First pass over-constrained with `max-w-3xl`; trimmed after user feedback that wide screens lost 1/4 width to whitespace.

### Fixed

- **`release.yml` no longer hardcodes `prerelease: true`** ([1a5f886](https://github.com/icetomoyo/KodaX-Space/commit/1a5f886)) — tag-push releases default to non-prerelease, so:
  - GitHub repo home shows "Latest release" again
  - F022 auto-updater (`releaseType: release`) can finally find the feed and notify users of new versions (previous configuration silently broke auto-update). Existing v0.1.0~v0.1.3 also flipped to non-prerelease via `gh release edit`.
  - `workflow_dispatch` input remains for rare rc/beta tags (default `false` now).

### Security (pending release as v0.1.4 patch)

Post-release review of v0.1.3 (4 parallel reviewer agents) surfaced 2 CRITICAL + 4 HIGH issues in F021 `.mcpb` installer + 2 HIGH in F019/F020. All fixes are on `main` ([998748d](https://github.com/icetomoyo/KodaX-Space/commit/998748d)):

- **F021 SEC C-1 — manifest command injection** → runtime allowlist (`node` / `python` / `python3` / `uv` / `uvx` / `npx` / `deno` / `bun`); `bash` / `sh` / `curl` etc. now refused at parse.
- **F021 SEC C-2 — zip bomb** → per-entry compression-ratio guard (≤100:1) using yauzl's `compressedSize` / `uncompressedSize` headers; concurrent extract budget race fixed.
- **F021 SEC H-1 — TOCTOU** → copy `.mcpb` file to `~/.kodax-space/tmp/` before parsing; all subsequent ops use a single open fd via `yauzl.fromFd`.
- **F021 SEC H-2 — uninstall guard substring bypass** → replaced `installDir.includes('.kodax-space')` with `isInsideExtractBase` (path.resolve + startsWith).
- **F021 SEC H-3 — symlink escape** → reject `S_IFLNK` entries + post-extract `lstat` sanity check.
- **F021 FUNC H-1 — silent file corruption** → rewrote `extractAll` to sequential; yauzl docs forbid concurrent `openReadStream` on the same handle.
- **F021 FUNC M-3 — upgrade disk leak** → `addOrReplace` returns displaced `installDir`, caller rms old version directory.
- **F021 SEC M-2 — registry tamper** → `readRegistry` Zod-validates every entry + verifies `installDir` is inside `EXTRACT_BASE`; bad entries dropped with `console.warn`.
- **F020 H-2 — stale-session click crash** → `notification.clicked` checks `sessionId` still exists in store before `setCurrentSession`.
- **F019 H-3 — theme FOUC** → theme class applied synchronously in `main.tsx` before React renders; eliminates "one frame of dark mode" flash for light/system users.

## [0.1.2] - 2026-06-01

### Theme

**KodaX ecosystem wiring.** Surfaces 4 existing-but-hidden KodaX capabilities directly in the Space UI — repo-intelligence status, fork lineage, CLI peer discovery, and one-shot Quick Ask — plus adds a CI pipeline that runs the e2e suite on every commit.

### Added

- **`⚡ Quick Ask` popover** (F018) — press `Cmd/Ctrl+K` anywhere to open a centered modal, type a one-shot question, get a markdown reply, `Esc` to close. Uses an ephemeral plan-mode session so it can't accidentally write files or run bash. Reuses your current project's provider + model.
- **`● Repointel · <mode>` chip** (F015) — repo-intelligence status pill in the ChipBar showing the resolved SDK mode (`OSS` / `Premium (shared)` / `Premium` / `off` / `idle`). Click for the last 3 trace events with engine / latency / cache-hit metadata. Color-coded dot at a glance.
- **`🌳 Show lineage` in session menu** (F016) — keyboard shortcut `L`. Expands the session menu to show the full fork tree the current session lives in (root + all descendants), indented by depth, annotated with `@turn N` for each fork point. Click any node to jump to that session.
- **`Running · N` peers panel** (F017) — shows other live KodaX processes (CLI, other Space windows, REPL) at the top of the LeftSidebar. Click a peer with a sessionId to teleport into its conversation (read-only resume via SDK session storage). 10s polling + window-focus refresh. Auto-hides when there are no other peers.
- **GitHub Actions CI** — new `ci.yml` runs typecheck + unit tests + Playwright e2e on every PR and push to `main`, across Windows + Linux runners (~3 min each). The 5-spec e2e suite (~20s) now blocks regressions automatically.

### Changed

- **`@kodax-ai/kodax` pin bumped to `^0.7.45`** (now published on npm); the catalog reads provider-capabilities.json from the live SDK package.

### Fixed

- **S2 e2e false-fail on CI** — was asserting that the isolated data dir exists right after Space launches; Space mkdir's lazily on first write. The spec now triggers a `project.recent.add` IPC call and then asserts both the dir and `projects.json` exist — a stronger isolation-alive signal that works on clean CI runners.

## [0.1.1] - 2026-06-01

### Theme

**Stability + UX hardening.** First patch release after v0.1.0 — locks in user-visible fixes from real-world dogfooding, adds a Playwright e2e suite covering 5 critical flows, switches the provider catalog to the SDK as single source of truth, and bumps `@kodax-ai/kodax` to 0.7.45.

### Added

- **Friendly SDK error envelope** (OC-11): SDK exceptions now surface as user-readable categories (`rate_limit` / `auth` / `quota` / `network` / `model_unavailable` / `bad_request` / `server_error` / `cancelled` / `unknown`) with action buttons (`Retry` / `Provider settings`) instead of raw stack frames in the conversation stream.
- **Rate-limit retry countdown** (OC-23): when the provider sends `Retry-After`, the SystemNotice shows a live `Retry in 28s` ticker and disables the button until the window passes. Works for both `429` and `5xx` responses.
- **Single-instance lock** (OC-01): double-clicking the launcher brings the existing window forward instead of starting a duplicate process (which could race-write `~/.kodax/`).
- **IPC schema error truncation** (OC-09): Zod error envelopes now keep only `{path, code, message}` per issue, redact `invalid_enum_value` / `unrecognized_keys` messages that would otherwise embed user values, and binary-search-trim to 1KB max.
- **Test-isolation env var** (OC-12): setting `KODAX_TEST_ONBOARDING` redirects `~/.kodax` to `$TMPDIR/kodax-test-<id>` so e2e specs and onboarding tests can run without polluting real user data.
- **Per-code-block copy button** (OC-25): hover any fenced code block in markdown to reveal a `📋 copy` button.
- **StashNotice realtime refresh**: the "uncommitted changes" bar in BottomBar now refreshes on window focus, visibility change, and every 30s — picks up external `git commit` immediately without re-selecting project.
- **Zero-config provider auto-activation** (KX-I-01): on first launch, if any provider API key env var is set (`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / etc.), the corresponding provider is auto-set as default — no Settings detour needed.
- **Playwright e2e suite (5 specs)**: first-launch UI, isolated data dir, send-prompt + mock-reply roundtrip, Shift+Tab mode cycle, and `/clear` slash command. Runs in ~20s on Windows; foundation for future regression coverage. `npm run e2e` / `npm run e2e:headed`.

### Changed

- **Provider catalog reads SDK truth** (`provider-capabilities.json` directly), with a hardcoded fallback so a broken `npm link` no longer crashes the main process. Future KodaX upstream provider additions propagate automatically on the next launch.
- **Markdown rendering perf** (OC-19): module-level LRU cache (cap 500) + `React.memo` on the Markdown component — re-renders of stable content (theme switch, history scroll-back) drop from 10-30ms to near-zero.
- **Auto-scroll guard** (OC-18): the conversation stream no longer false-detects "user scrolled up" during its own programmatic scroll animations (400ms guard using `performance.now()`).
- **Conversation layout**: Claude Desktop-style two-level tool cluster (`Ran 6 commands ⌄ → sub-cluster → individual tool call`), left-aligned narrow user pill, drop the `<bubble>` wrapper around assistant markdown, rose-pill inline code styling.
- **Tool card colors are status-driven** (was tool-kind based): bash success no longer reads as "error" because of a red body. Card body = `done`/`running` status color; tool kind moves to the tool name text color.
- **Provider env name updates** (KodaX upstream sync from `0.7.45`-line). `@kodax-ai/kodax` published-version pin stays at `^0.7.42` until `0.7.45` lands on npm; local dev uses `npm run link:kodax` to get the upcoming version.

### Fixed

- **Provider env name drift**: 5 coding-plan providers (kimi-code / zhipu-coding / minimax-coding / mimo-coding / ark-coding) had outdated env var names. Now mirrored from KodaX SDK.
- **PermissionModal "Always allow" UX**: was a checkbox + Allow-once button (two clicks); now a third dedicated button. Danger-class commands hide the Always button (cannot silently whitelist).
- **auto[LLM] mode double-prompting**: broker no longer pops permission modals for non-dangerous tools in `auto` mode — lets the SDK guardrail (F030) own that path. Dangerous tools (rm -rf etc.) still pop the modal.
- **skill.discover / mcp.discover from historical sessions**: switched from requiring a live SDK session to taking `projectRoot` directly. Recents-restored sessions no longer throw `session not found`.
- **Model selection persistence**: last-used model now persists across reloads via localStorage.
- **Stop-confirm toast contrast**: light-mode toasts had dark-on-dark text; all 4 tones now dual-themed.
- **Inline copy icon visibility**: replaced the near-invisible `⎘` Unicode glyph with an inline Lucide-style SVG icon.

### Security

- **API keys cannot leak via IPC error envelopes** (OC-09): Zod `invalid_enum_value` / `unrecognized_keys` issue messages — which embed the user's raw value in the template — are now redacted before flowing through the IpcError `details` field.

### Known limitations

- **`@kodax-ai/kodax@0.7.45` not yet on npm**: published-version pin stays at `^0.7.42` for installable CI/release builds. OC-23 retry-after extraction uses `parseRetryAfter` / `extractHeadersFromError` from the SDK's `/llm` subpath — if the installed SDK lacks them, `extractRetryAfterMs()` catches the load failure and returns `undefined`, gracefully degrading to a plain Retry button (no countdown). Local dev uses `npm run link:kodax` to point at the bleeding-edge KodaX repo.
- **`change_model` / `check_network` action buttons** in error notices: text tells you what to do, but the action buttons themselves are not wired yet (followups OC-37 / KX-I-02).

## [0.1.0] - 2026-05-30

### Theme

**First public release.** Claude Desktop-shape conversational shell wrapping `@kodax-ai/kodax` v0.7.44 with full coverage of the SDK's user-facing surface: streaming conversation, tool call visualization, multi-provider key management, permission gating, AGENTS.md context loading, skill + markdown-agent invocation, MCP server lifecycle, session fork/rewind/history, and rich at-input pickers (`/slash`, `@path`, `@agent`). Cross-platform distribution packages for Windows / macOS / Linux via the GitHub Releases page — unsigned in v0.1.0 (signing tracked as FEATURE_027 for v0.1.5+).

### Added

#### Conversation experience

- **Streaming response UI** — text deltas + thinking deltas + tool call cards composed into a Claude Desktop-style bubble flow; markdown rendering with code fence syntax highlighting via `rehype-highlight`
- **Tool call cards** with status icons (running / done / error), expandable input + result with diff awareness, "Ran N commands" aggregation for consecutive tool calls
- **Message footer**: always-visible relative time (`6h ago`) + copy button (icon + on-hover label) on every user / assistant bubble
- **Activity spinner** with real-time status string (`Thinking…`, `Writing…`, `Running tool…`, `Verifying…`, `Compacting context…`), elapsed seconds, iteration counter `iter N/max`, cumulative tokens + tokens/s rate, character count for thinking + tool input partial JSON
- **History restore on session click**: pulls persisted conversation from SDK storage and replays it as `text_delta` + `thinking_delta` + `tool_start` + `tool_result` events. Loading skeleton during the IPC wait. Hover-prefetch on Recents items warms the LRU cache
- **Race-safe history prepend**: if a user sends a new prompt while history is loading, the historical messages are atomically prepended rather than appended — order stays correct

#### Slash commands (11)

- `/mode <plan | accept-edits | auto>` — switch permission mode (Ctrl+M cycles)
- `/auto-engine <llm | rules>` — switch auto-mode classifier (LLM SideQuery vs rule-based)
- `/model [name | default | list]` — set / clear model override; lists provider models with current marker and "did you mean" suggestion on typo
- `/provider <id>` — switch provider mid-session
- `/reasoning <off | auto | quick | balanced | deep>` — reasoning depth ceiling
- `/thinking <on | off>` — toggle thinking output
- `/clear` — clear conversation buffer (session retained)
- `/help` — list all registered commands
- `/memory` — open Agents popout in Edit mode for `~/.kodax/AGENTS.md` or `<project>/AGENTS.md`
- `/compact` — request context compaction on next turn (spike `contextTokenSnapshot.currentTokens` to force SDK trigger)
- `/cost` — show estimated token usage / cost (renderer-side aggregation)
- `/tree` — show session fork lineage tree
- `/history` — list user messages in current session
- `/agent-mode <ama | sa>` — switch agent orchestration mode
- `/copy` — copy last assistant message
- `/new` — create new session
- `/repointel` — RepoIntelligence trace inspection
- `/doctor` — provider diagnostics (key configured + HTTP probe + latency)
- `/status` — list sibling KodaX peer instances (other Space windows / CLI / REPL)
- `/review` — pull `git diff HEAD` and insert a structured review template into the input box

#### Input box affordances

- **`@path` file autocomplete** — Tab/Enter to accept, ↑↓ to navigate, Esc to dismiss. Backed by `project.fileSearch` IPC with 30s cache; ignores `node_modules` / `.git` / `dist` etc; alphabetical ranking with basename hits prioritized
- **`@agent` markdown agent picker** — button next to attach menu lists user-level + project-level agents from `~/.kodax/agents/` and `<project>/.kodax/agents/`; click inserts `@agent-name ` at caret
- **`/slash` command picker** — fuzzy-filter popover, Tab/Enter accept, arg hint per command
- **Input history** — ↑/↓ navigation through previous prompts (per-session, in-memory)
- **Auto-grow textarea** up to 12 rows
- **Ctrl+F** transcript search with ring highlight + ↑↓ match navigation
- **Ctrl+\\** focus mode (hide both sidebars)
- **?** help overlay

#### Status surfaces (above input)

- **NotificationsSurface** — persistent inline notices (auto-mode engine fell back to rules etc), dismissable per-id
- **StashNotice** — git working tree dirty indicator (`● Uncommitted: 3 modified · 1 staged on main`) with debounced refresh on write/edit/bash tool results
- **RetryBanner** — provider 429 / overloaded / recovery countdown timer; reads `retry_after` + `provider_recovery` session events
- **AmaWorkStrip** — active AMA worker title + harness profile + round number + child fanout count + budget approval flag
- **BackgroundTaskBar** — chip strip per subagent worker with status icon (progress / completed / notification / warning)
- **QueueIndicator** — KodaX SDK MessageQueue snapshot badge (hidden when empty); popover with All / Prompts / Tasks / System filter tabs

#### Provider management

- **13 built-in providers**: Anthropic, OpenAI, DeepSeek, Kimi (Moonshot), Kimi for Coding, Qwen (Alibaba), Zhipu, Zhipu Coding Plan, MiniMax Coding, MiMo (Xiaomi), Volcengine Ark Coding, Gemini CLI, Codex CLI
- **Custom providers** (Anthropic-compat / OpenAI-compat) via UI; persisted to `~/.kodax/custom-providers.json` (shared with KodaX CLI)
- **OS keychain integration** (keytar): macOS Keychain / Windows CredMgr / Linux libsecret with in-memory fallback warning when libsecret missing
- **Shell-exported API keys** auto-detected at startup (ANTHROPIC_API_KEY / KIMI_API_KEY / ARK_API_KEY etc) — no double-config required
- **HTTP probe** ("test connection") for each provider before relying on it
- **SDK-driven context window indicator** — pulls per-provider per-model context size via `resolveContextWindow`, falls back to renderer hardcoded table when SDK unavailable
- **Auto-injection of keys** to `process.env` on default-provider change and on add/remove
- **Custom providers from `~/.kodax/config.json`** registered into SDK runtime at startup (shared with `kodax` CLI's `/provider <name>` flow)

#### Permission system (FEATURE_029)

- **Canonical 3-mode** matching KodaX REPL: `plan` (deny mutating tools) / `accept-edits` (auto-allow edit/write, gate bash/network) / `auto` (AutoModeToolGuardrail)
- **Auto-mode sub-engine** (`llm` LLM classifier / `rules` AGENTS.md + auto-rules.jsonc)
- **Denial threshold fallback**: 3 consecutive denies → auto switches `llm` to `rules`
- **Circuit breaker**: 5 LLM-classifier errors / 10min → auto fallback
- **Always-allow rules** persisted to `~/.kodax/auto-rules.jsonc` with pattern matching at broker layer
- **Risk assessment**: tool name + input keys scanned for dangerous patterns (rm -rf, sudo, fork bomb, etc); typed-confirm modal for high-risk tools
- **Plan mode hard-block** via `planModeBlockCheck` predicate passed to KodaX runtime; `exit_plan_mode` LLM-initiated escalation **always rejected** (user must manually switch mode)

#### AGENTS.md context

- Loader walks `~/.kodax/AGENTS.md` + `<project>/AGENTS.md` (KodaX SDK `loadAgentsFiles`)
- Popout viewer with file tab switcher + Edit mode (textarea + Save / Cancel + character counter)
- Create Global / Create Project buttons appear when respective scope is absent
- Atomic writeback (tmp → rename, 0o600 perms)

#### Skills + markdown agents

- Skill discovery from `~/.kodax/skills/`, `<project>/.kodax/skills/`, plugin paths, builtin paths
- Slash popover lists user-invocable skills alongside built-in commands
- Skill invocation via SDK `SkillRegistry.invoke` returning resolved prompt → injected into conversation
- **`!`cmd`` dynamic context** routed through Space's permission broker (each shell command requires user approval; shell-spawn with PATH-only env, 30s timeout, 1MB stdout cap)
- **Markdown agent discovery** (FEATURE_197) from `~/.kodax/agents/*.md` and `<project>/.kodax/agents/*.md`; provenance dots in picker UI + failed-file banner

#### MCP server lifecycle

- Read-only listing (`mcp.discover`) of servers from `~/.kodax/config.json` + `<project>/.kodax/config.json` with merge precedence
- Manager singleton (`mcp.servers`) exposing runtime status (idle / connecting / ready / error / disabled) + tool / resource / prompt counts + lastError + cachedAt
- Start / Stop buttons per server; lazy-connect on demand
- Expandable Tools list per server (capability descriptors with id + name + description)
- Reload config (dispose + reconstruct manager) for live edits to `~/.kodax/config.json`
- Concurrent-init race protection via in-flight promise guard
- Dispose hook on app quit (stdio transport children released)

#### Session management (FEATURE_033 + FEATURE_038)

- **Fork**: branch from any turn into a child session (in-memory metadata + disk lineage via SDK `forkSession`)
- **Rewind**: roll back active entry; renderer truncates event buffer
- **Delete**: graceful in-flight cancel + disk delete
- **Rename**: inline edit (double-click session title)
- **In-memory + persisted unified view**: `session.list` merges live and disk sessions; on-click resume loads disk via lazy `tryResume`
- **/status** command lists sibling KodaX peer instances (multi-window awareness via SDK `listRunningSessions`)

#### Welcome dashboard

- Sessions / messages / tokens / streak / heatmap stats
- 26-week activity heatmap (today-anchored, no trailing column bug)
- Favorite model with provider sub-label
- 30-day commit bar chart per project
- Git stats per project (commits / files changed / lines added/deleted / contributors / current branch)
- Tabs: Overview / Models / Project

#### Diagnostics

- **FileTracingProcessor** opt-in via `SPACE_TRACE_DIR` env (writes JSONL spans for offline analysis)
- **Application menu**: View (Reload / Toggle DevTools / Zoom / Fullscreen) + Window (Minimize / Close); DevTools no longer auto-opens (opt-in via `SPACE_AUTO_DEVTOOLS=1`)
- **Themes**: dark / light / system (Ctrl+Shift+T cycles), synced to OS titlebar overlay on Windows
- **Hover-prefetch** of session history on Recents items
- **Plan-mode auto-toggle** of right sidebar based on todo list state

#### Platform packaging (FEATURE_010)

- **Windows**: NSIS installer (`KodaX-Space-Setup-${version}.exe`)
- **macOS**: DMG for x64 + arm64 (universal-build via electron-builder)
- **Linux**: AppImage (portable) + deb (apt-installable)
- **Auto-update manifests** (`latest*.yml`) uploaded as release artifacts; no update server configured in v0.1.0
- **Cross-platform smoke check** (`smoke-pack.mjs`) validates installer existence, size cap (< 200MB), and asar contents

### Fixed

Pre-release internal review cycles addressed across ~20 review batches; representative items included:

- Atomic `prependSessionHistory` store action eliminated history-restore race that re-ordered messages when user sent during IPC wait
- StashNotice tool-result scan continues past non-write tool results instead of early-exiting at the first one
- AtPathPopover Esc actually closes (dismissed-key state tracks per `@token`)
- AtPathPopover 120ms debounce on per-keystroke `project.fileSearch` IPC
- Project file walker explicitly skips symlinks to prevent monorepo cycle infinite-loop
- McpManager concurrent-init race wrapped with in-flight promise guard
- RetryBanner countdown actually decrements (was recomputing `retryAt` per render)
- Skill `!`cmd`` dynamic context routed through Space permission broker instead of blanket refuse; shell-spawned with PATH-only env + 30s timeout + 1MB stdout cap
- WelcomeDashboard decoupled from `eventsBySession` (subscribes to derived `tokensBySession` slice) — background streaming no longer triggers full dashboard recompute
- `loadKodaxUserDefaults` cached at module level (was hit on every `session.list` call)
- `loadPersistedSession` 5-entry LRU cache with auto-invalidation on fork / rewind / delete
- Main startup `hydrateShellEnv` + `probeKodaxSdk` + `probeSkillRegistry` parallelized (saves 300-800ms to window-visible)
- Cancel button force-emits `session_error` so spinner doesn't hang
- Restored sessions ref moved to module-level Set (survives HMR / Shell remount)
- `/model` autocomplete with did-you-mean + truncated display for large model lists (OpenRouter-style 200+)
- `project.gitDiff` distinguishes "no changes" from "git command failed" via explicit `error` field

### Known limitations

- **No code signing**: Windows SmartScreen and macOS Gatekeeper will warn on first launch. See the release body for documented workaround. Signing tracked as FEATURE_027 for v0.1.5+.
- **No auto-update server**: `latest*.yml` manifests are uploaded but no update server is configured. Users must manually download the new release for upgrades.
- **No PTY terminal**: TerminalPanel shows bash tool history (KodaX-invoked commands), not an interactive shell. A real PTY is tracked for v0.1.x+.
- **Exit-plan-mode**: LLM-initiated plan mode escalation is unconditionally rejected. User must manually switch the Mode selector to `accept-edits` or `auto` to execute the plan. This is intentional — preserves the trust boundary that LLM cannot escalate its own permissions.
- **MCP project-scope servers**: McpManager currently only loads global `~/.kodax/config.json`. Project-level MCP servers (`<project>/.kodax/config.json`) are visible via `mcp.discover` but not actually managed.
- **No SDK-driven cost ($) display**: `/cost` shows token totals only. Real dollar amounts would require integrating SDK `calculateCost` + per-provider rate cards; deferred.
- **TypeScript errors don't block release CI**: `typecheck` is `continue-on-error: true` in the release workflow; manually verify locally before tagging.
