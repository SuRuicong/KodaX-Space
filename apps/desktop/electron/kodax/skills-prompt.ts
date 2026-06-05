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

// Per-projectRoot init cache. `initializeSkillRegistry(projectRoot)` calls
// `discover()` which walks `~/.kodax/skills/` + `${projectRoot}/.kodax/skills/` +
// any bundled-builtin paths. We do this exactly once per projectRoot per
// process: subsequent prompt fetches reuse the global registry that was
// populated by that single discover() call.
//
// Storing the Promise (not the resolved value) is intentional — concurrent
// `runManagedTask` calls (e.g. UI fires two prompts back-to-back) all await
// the same in-flight init rather than starting parallel discovers.
const initOncePerProjectRoot = new Map<string, Promise<void>>();

async function ensureGlobalRegistryInitialized(projectRoot: string): Promise<void> {
  const cached = initOncePerProjectRoot.get(projectRoot);
  if (cached !== undefined) {
    return cached;
  }
  const promise = (async () => {
    const sdk = await loadSdkSkills();
    if (sdk === null) return;
    try {
      await sdk.initializeSkillRegistry(projectRoot);
    } catch (err) {
      console.warn(
        `[skills-prompt] initializeSkillRegistry(${projectRoot}) failed: ` +
          `${err instanceof Error ? err.message : String(err)}`,
      );
      // Drop the cache so a future call can retry — transient init errors
      // (file system permission flap, etc.) shouldn't permanently disable
      // skill activation for the project.
      initOncePerProjectRoot.delete(projectRoot);
      throw err;
    }
  })();
  initOncePerProjectRoot.set(projectRoot, promise);
  return promise;
}

/**
 * Build the `skills-addendum` system-prompt fragment for the given
 * `projectRoot`. Returns an empty string on any failure (subpath
 * unreachable, init throws, etc.) so the caller can unconditionally
 * spread the result into `options.context.skillsPrompt` and the prompt
 * builder will skip the section when empty.
 *
 * Side effects:
 *   - First call per `projectRoot` triggers `initializeSkillRegistry`
 *     (file-system discover). Subsequent calls return the live snippet
 *     synchronously from the SDK (no re-discover).
 *   - Populates the SDK's process-global SkillRegistry — needed so the
 *     coding `skill` tool can invoke skills the model picks.
 */
export async function buildSkillsPrompt(projectRoot: string): Promise<string> {
  try {
    await ensureGlobalRegistryInitialized(projectRoot);
    const sdk = await loadSdkSkills();
    if (sdk === null) return '';
    const registry = sdk.getSkillRegistry(projectRoot);
    return registry.getSystemPromptSnippet();
  } catch (err) {
    console.warn(
      `[skills-prompt] getSystemPromptSnippet(${projectRoot}) failed: ` +
        `${err instanceof Error ? err.message : String(err)}`,
    );
    return '';
  }
}

/**
 * Test helper: drop both the SDK-module cache and the per-projectRoot
 * init cache. Not used in production. The local-cache reset is needed so
 * tests can simulate a fresh process; the SDK-side reset uses
 * `resetSkillRegistry` which is exported from `@kodax-ai/kodax/skills`.
 */
export async function _resetSkillsPromptForTests(): Promise<void> {
  initOncePerProjectRoot.clear();
  const sdk = await loadSdkSkills();
  sdk?.resetSkillRegistry();
}
