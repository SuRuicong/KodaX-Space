// FEATURE_038: skills-prompt helper tests — natural-language skill activation.
//
// Covers `buildSkillsPrompt(projectRoot)` and its contract with the
// SDK global SkillRegistry singleton:
//   - empty project → returns a string (may be empty OR contain
//     dev-machine ~/.kodax/skills + bundled builtins; we don't pin
//     content, just shape)
//   - project with a `.kodax/skills/<name>/SKILL.md` → snippet
//     mentions that skill's name (so the model sees it and can route
//     by natural language)
//   - SDK global registry is populated as a side effect (verifies
//     "what tool can invoke" matches "what model sees")
//   - per-projectRoot init cache: second call doesn't re-discover the
//     filesystem (we mutate the SKILL.md after first call and assert
//     the snippet still reflects the first-call state until reset)
//
// Test style mirrors `skill-registry.test.ts`: real SDK calls, real
// tmp fs, no module mocking (Node's built-in test runner doesn't have it).

import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildSkillsPrompt,
  _resetSkillsPromptForTests,
} from '../kodax/skills-prompt.js';

let tmpProjectRoot: string;

beforeEach(async () => {
  await _resetSkillsPromptForTests();
  tmpProjectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'kodax-skills-prompt-test-'));
});

afterEach(async () => {
  await _resetSkillsPromptForTests();
  if (tmpProjectRoot && fs.existsSync(tmpProjectRoot)) {
    fs.rmSync(tmpProjectRoot, { recursive: true, force: true });
  }
});

function writeSkill(
  baseDir: string,
  name: string,
  frontmatter: string,
  body: string,
): void {
  const dir = path.join(baseDir, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\n${frontmatter}\n---\n${body}\n`);
}

test('buildSkillsPrompt: returns a string for an empty project root', async () => {
  const out = await buildSkillsPrompt(tmpProjectRoot);
  assert.equal(typeof out, 'string', 'must return string even when no project skills found');
  // We don't pin content because dev machines have ~/.kodax/skills.
  // But it must be safe to spread into context.skillsPrompt without
  // injecting a falsy/undefined value mid-spread.
});

test('buildSkillsPrompt: includes project-discovered skill name + description in snippet', async () => {
  const skillsDir = path.join(tmpProjectRoot, '.kodax', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  // Use a unique name so we don't false-positive against any user-level
  // skill that happens to be installed on the dev machine.
  const name = `tmp-nl-trigger-${Date.now()}`;
  const description = `Activate when the user wants to ${name}-test something specific`;
  writeSkill(skillsDir, name, `name: ${name}\ndescription: ${description}`, 'body');

  const out = await buildSkillsPrompt(tmpProjectRoot);
  assert.ok(
    out.includes(name),
    `expected snippet to list skill "${name}"; got snippet of length ${out.length}`,
  );
  assert.ok(
    out.includes(description.slice(0, 30)),
    `expected snippet to include the skill description (first 30 chars)`,
  );
});

test('buildSkillsPrompt: subsequent call reuses cache (no re-discover side effects)', async () => {
  const skillsDir = path.join(tmpProjectRoot, '.kodax', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const name = `tmp-cache-${Date.now()}`;
  writeSkill(skillsDir, name, `name: ${name}\ndescription: first version`, 'body');

  const first = await buildSkillsPrompt(tmpProjectRoot);
  assert.ok(first.includes(name), 'first call must discover the skill');

  // Mutate the SKILL.md on disk. If buildSkillsPrompt re-ran discover()
  // on every call we'd see the new description; we don't, because the
  // per-projectRoot init cache short-circuits.
  fs.writeFileSync(
    path.join(skillsDir, name, 'SKILL.md'),
    `---\nname: ${name}\ndescription: second version\n---\nbody\n`,
  );

  const second = await buildSkillsPrompt(tmpProjectRoot);
  assert.ok(second.includes(name), 'cached call still lists the skill');
  assert.ok(
    !second.includes('second version'),
    'cached call must NOT show post-discover mutations until reset',
  );
});

test('buildSkillsPrompt: cache reset re-triggers discover and picks up file changes', async () => {
  const skillsDir = path.join(tmpProjectRoot, '.kodax', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const name = `tmp-reset-${Date.now()}`;
  writeSkill(skillsDir, name, `name: ${name}\ndescription: before reset`, 'body');

  const before = await buildSkillsPrompt(tmpProjectRoot);
  assert.ok(before.includes('before reset'), 'pre-reset snippet shows initial description');

  // Add a NEW skill file and reset the cache.
  const newName = `tmp-fresh-${Date.now()}`;
  writeSkill(skillsDir, newName, `name: ${newName}\ndescription: added after reset`, 'body');
  await _resetSkillsPromptForTests();

  const after = await buildSkillsPrompt(tmpProjectRoot);
  assert.ok(after.includes(newName), 'post-reset snippet shows newly-added skill');
});

test('buildSkillsPrompt: populates the SDK global registry (parity with skill tool)', async () => {
  // The point of going through the SDK global getSkillRegistry — not
  // Space's local `apps/desktop/electron/skill/registry.ts` wrapper —
  // is that the coding `skill` tool reads the same global. This test
  // verifies: after buildSkillsPrompt fires, importing the SDK's
  // global getter returns a registry that lists the project skill.
  const skillsDir = path.join(tmpProjectRoot, '.kodax', 'skills');
  fs.mkdirSync(skillsDir, { recursive: true });
  const name = `tmp-global-${Date.now()}`;
  writeSkill(skillsDir, name, `name: ${name}\ndescription: global parity`, 'body');

  await buildSkillsPrompt(tmpProjectRoot);

  const sdk = await import('@kodax-ai/kodax/skills');
  const global = sdk.getSkillRegistry(tmpProjectRoot);
  const found = global.list().find((s) => s.name === name);
  assert.ok(found, 'SDK global registry must list the project skill after buildSkillsPrompt');
  assert.equal(found.source, 'project');
});
