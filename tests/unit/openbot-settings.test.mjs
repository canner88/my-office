import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpenBotSettings } from '../../server/openbot-settings.mjs';

test('OpenBot settings persist validated office and agent overrides', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-settings-'));
  const settings = createOpenBotSettings(dir);
  settings.setOffice({ theme: 'aurora', refreshSeconds: 9999, density: 'compact', unknown: 'drop' });
  settings.setAgent('agent-a', { room: 'Kod', priority: 200, temperature: 8, permissions: { read: 'allow', execute: 'invalid' } });

  const reloaded = createOpenBotSettings(dir).get();
  assert.equal(reloaded.office.theme, 'aurora');
  assert.equal(reloaded.office.refreshSeconds, 300);
  assert.equal(reloaded.agents['agent-a'].room, 'Kod');
  assert.equal(reloaded.agents['agent-a'].priority, 100);
  assert.equal(reloaded.agents['agent-a'].temperature, 2);
  assert.deepEqual(reloaded.agents['agent-a'].permissions, { read: 'allow' });
});
