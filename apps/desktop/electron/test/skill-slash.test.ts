import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  hasSkillSlashConflict,
  parseLegacySkillToken,
  safeSkillSlashText,
  skillSlashEchoText,
  skillSlashInsertText,
  skillSlashText,
} from '../../renderer/src/shell/skillSlash.js';

test('skill slash helpers default to direct skill triggers', () => {
  assert.equal(skillSlashText('code-reviewer'), '/code-reviewer');
  assert.equal(skillSlashInsertText('code-reviewer'), '/code-reviewer ');
  assert.equal(skillSlashEchoText('code-reviewer', []), '/code-reviewer');
  assert.equal(
    skillSlashEchoText('code-reviewer', ['--lean', 'src/app.ts']),
    '/code-reviewer --lean src/app.ts',
  );
});

test('legacy /skill:name token remains accepted', () => {
  assert.equal(parseLegacySkillToken('skill:code-reviewer'), 'code-reviewer');
  assert.equal(parseLegacySkillToken('Skill:code-reviewer'), 'code-reviewer');
  assert.equal(parseLegacySkillToken('code-reviewer'), null);
});

test('safe skill slash helpers avoid command and alias conflicts', () => {
  const commands = [
    { name: 'review' },
    { name: 'model', aliases: ['m'] },
  ];

  assert.equal(hasSkillSlashConflict('review', commands), true);
  assert.equal(hasSkillSlashConflict('M', commands), true);
  assert.equal(hasSkillSlashConflict('code-reviewer', commands), false);
  assert.equal(safeSkillSlashText('review', commands), '/skill:review');
  assert.equal(skillSlashInsertText('review', commands), '/skill:review ');
  assert.equal(skillSlashInsertText('code-reviewer', commands), '/code-reviewer ');
});
