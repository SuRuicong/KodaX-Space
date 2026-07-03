// Natural-language skill activation — KodaX SDK global SkillRegistry wiring.
//
// What this closes: KodaX SDK (`@kodax-ai/kodax/skills` + `/coding`) already
// has all three pieces needed for the model to discover and invoke skills
// from natural-language prompts (no `/skill-name` slash required):
//
//   1. `getSkillRegistry(projectRoot)` — process-global SkillRegistry singleton
//   2. The coding `skill` tool — reads `getSkillRegistry()` at tool-invoke time
//   3. The prompt builder injects `context.skillsPrompt` as a
//      `skills-addendum` section (see KodaX
//      `agent/src/capabilities/skills/skill-registry.ts`
//      `getSystemPromptSnippet()` + `coding/src/prompts/capability-sections.ts`
//      `skills-addendum` branch).
//
// KodaX REPL wires all three (InkREPL: `initializeSkillRegistry(gitRoot)` at
// boot + `getSkillRegistry(gitRoot).getSystemPromptSnippet()` per turn).
// Space previously wired only the explicit `/skill discover|invoke` IPC path
// (apps/desktop/electron/ipc/skill.ts), so RealKodaXSession's runManagedTask
// `options.context` had no `skillsPrompt` — the model saw NO list of skills
// in its system prompt and could not auto-route by intent.
//
// Why we MUST use SDK's global getSkillRegistry (not Space's local
// `apps/desktop/electron/skill/registry.ts` wrapper that does
// `new SkillRegistry(projectRoot)`):
//   The coding `skill` tool's tool body calls `getSkillRegistry()` (no args
//   → returns current global instance). If Space's wrapper creates its own
//   instance but the global is uninitialized, the tool sees zero skills
//   even though the prompt addendum lists them. By going through the
//   global SDK getter we keep "what the model sees" and "what the tool can
//   invoke" in lock-step.
//
// Concurrency model: SDK global SkillRegistry holds ONE `_instance` per
// process and resets it whenever `getSkillRegistry` is called with a
// different `projectRoot` (KodaX `agent/src/capabilities/skills/skill-
// registry.ts:247`). Space supports multiple sessions for different project
// roots in the same Electron main process. Without serialization, two
// concurrent `buildSkillsPrompt` calls for different roots can thrash the
// singleton mid-flight — session A's `getSystemPromptSnippet()` ends up
// reading session B's freshly-reset (and not-yet-discovered) registry,
// silently emitting an empty addendum.
//
// We fix this with a single process-level serializing chain (`inFlight`).
// Every `buildSkillsPrompt` call atomically performs init + snippet-read
// under the lock, so the global state cannot be reset by another session
// between our init and our read. Lock cost is bounded by discover() — a
// few ms for cached `_instance`, tens of ms cold. Acceptable for the
// per-turn user-facing path.
//
// Failure policy: any failure (SDK subpath unreachable, discover throws on
// a broken SKILL.md, etc.) degrades to an empty prompt — the session still
// works, the model just doesn't get the skills addendum. We log to stderr
// but never throw out of the session boot path.

// `import type` keeps this a compile-time-only import — the dynamic
// `import('@kodax-ai/kodax/skills')` below is what actually loads the
// subpath at runtime (CJS-built main can't statically require subpath
// "import"-only conditional exports — same constraint that drove
// `loadSdkCoding` / `loadSdkLlm` in real-session.ts).
type SdkSkillsModule = typeof import('@kodax-ai/kodax/skills');
let sdkModuleCache: Promise<SdkSkillsModule | null> | null = null;

function loadSdkSkills(): Promise<SdkSkillsModule | null> {
  if (sdkModuleCache === null) {
    sdkModuleCache = import('@kodax-ai/kodax/skills').catch((err) => {
      console.warn(
        `[skills-prompt] failed to load @kodax-ai/kodax/skills subpath; ` +
          `natural-language skill activation will be disabled for this session: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    });
  }
  return sdkModuleCache;
}

/**
 * C7 (security): the SDK `skill` tool expands `` !`cmd` `` dynamic-context tokens via execSync,
 * bypassing Space's F029/F030 permission broker — this is exactly why Space's EXPLICIT /skill path
 * refuses such skills (skill/registry.ts#refuseIfUnsafeContent). The natural-language auto-invocation
 * path (this file) previously advertised EVERY discovered skill, so a skill carrying these tokens
 * could be auto-invoked by the model and run unmediated shell. We enforce the same policy here by
 * setting `disableModelInvocation=true` on any unsafe skill, which the SDK honors in BOTH places:
 *   (a) `getSystemPromptSnippet()` filters `disableModelInvocation` skills out of the prompt, and
 *   (b) the `skill` tool refuses to invoke a skill whose loaded form has the flag set.
 * `loadFull` caches and returns the same Skill reference the tool later reads, so mutating it closes
 * the tool path too. Safe skills are untouched — no regression to the dynamic-context-free majority.
 */
const DYNAMIC_CONTEXT_TOKEN = /!`[^`]+`/;

interface MutableSkillMetadata {
  readonly name: string;
  disableModelInvocation: boolean;
}
interface MutableFullSkill {
  content?: string;
  rawContent?: string;
  disableModelInvocation?: boolean;
}
interface SafetyScannableRegistry {
  readonly skills: ReadonlyMap<string, MutableSkillMetadata>;
  loadFull(name: string): Promise<MutableFullSkill>;
}

async function enforceSkillSafetyPolicy(registry: SafetyScannableRegistry): Promise<void> {
  for (const meta of registry.skills.values()) {
    if (meta.disableModelInvocation) continue;
    let full: MutableFullSkill;
    try {
      full = await registry.loadFull(meta.name);
    } catch {
      // Can't verify the content → fail safe: exclude from model auto-invocation.
      meta.disableModelInvocation = true;
      continue;
    }
    if (DYNAMIC_CONTEXT_TOKEN.test(`${full.content ?? ''}\n${full.rawContent ?? ''}`)) {
      meta.disableModelInvocation = true; // (a) drop from getSystemPromptSnippet()
      full.disableModelInvocation = true; // (b) make the cached fullSkill fail the skill-tool gate
      console.warn(
        `[skills-prompt] skill '${meta.name}' contains dynamic-context shell tokens ` +
          '(`!`...`); excluded from natural-language auto-invocation (KodaX Space safety policy).',
      );
    }
  }
}

// Process-level serializing chain. Each `buildSkillsPrompt` call waits
// for the previous one to complete before touching the SDK global
// SkillRegistry. We chain on Promise resolution rather than rejection so
// a failed call (e.g. SKILL.md syntax error) does NOT permanently block
// the queue — the next call still gets to retry.
let inFlight: Promise<unknown> = Promise.resolve();

/**
 * Build the `skills-addendum` system-prompt fragment for the given
 * `projectRoot`. Returns an empty string on any failure (subpath
 * unreachable, init throws, etc.) so the caller can unconditionally
 * spread the result into `options.context.skillsPrompt` and the prompt
 * builder will skip the section when empty.
 *
 * Side effects:
 *   - Triggers `initializeSkillRegistry(projectRoot)` on every call
 *     (the SDK short-circuits the singleton lookup when `_instance`
 *     already matches `projectRoot`, but `discover()` still re-scans).
 *     Cost is amortized over the LLM round-trip.
 *   - Populates the SDK's process-global SkillRegistry — needed so the
 *     coding `skill` tool can invoke skills the model picks. Runs under
 *     the process serializing lock so cross-projectRoot concurrent
 *     callers cannot thrash the singleton mid-read.
 */
export async function buildSkillsPrompt(projectRoot: string): Promise<string> {
  const previous = inFlight;
  let releaseLock!: () => void;
  const myTurn = new Promise<void>((resolve) => {
    releaseLock = resolve;
  });
  inFlight = myTurn;

  // `await previous.catch(() => {})` — wait for whatever was in flight,
  // but if it rejected we still want to take our turn. Without the
  // `.catch`, a single failed predecessor would surface here as a throw
  // and we'd skip our own init/read entirely.
  await previous.catch(() => {});

  try {
    const sdk = await loadSdkSkills();
    if (sdk === null) return '';
    let stage: 'init' | 'snapshot' = 'init';
    try {
      // initializeSkillRegistry: get-or-create + discover. SDK
      // `getSkillRegistry(projectRoot)` resets `_instance` if the
      // previous lock-holder used a different projectRoot — and since
      // we now own the lock, the reset/init/read sequence is atomic
      // from the caller's perspective.
      await sdk.initializeSkillRegistry(projectRoot);
      stage = 'snapshot';
      const registry = sdk.getSkillRegistry(projectRoot);
      // C7: enforce the dynamic-context-token safety policy before advertising skills, so unsafe
      // skills are dropped from the snippet AND rejected by the skill tool (same flag governs both).
      await enforceSkillSafetyPolicy(registry as unknown as SafetyScannableRegistry);
      return registry.getSystemPromptSnippet();
    } catch (err) {
      // `stage` is set to 'init' at entry and only flipped after
      // initializeSkillRegistry resolves successfully; this makes the
      // failure-source unambiguous in the log without depending on
      // post-hoc registry-state heuristics.
      console.warn(
        `[skills-prompt] ${stage}(${projectRoot}) failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      return '';
    }
  } finally {
    releaseLock();
  }
}

/**
 * Test helper: drop the SDK-module cache and reset the SDK global
 * SkillRegistry. Not used in production. Tests need this between
 * scenarios so a stale singleton from a previous tmp projectRoot does
 * not leak into the next test's expectations.
 *
 * Also clears `inFlight` to defuse any unresolved lock left over from
 * a test that panicked mid-call — without this a single failed test
 * would deadlock every subsequent test in the suite.
 */
export async function _resetSkillsPromptForTests(): Promise<void> {
  inFlight = Promise.resolve();
  const sdk = await loadSdkSkills();
  sdk?.resetSkillRegistry();
}
