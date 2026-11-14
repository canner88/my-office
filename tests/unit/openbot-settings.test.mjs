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
  for (const route of Object.values(reloaded.modelRouting)) {
    assert.equal(route.fallbackProvider, 'opencode');
    assert.equal(route.fallbackModel, 'ollama/gemma4:latest');
  }
});

test('older model routing settings receive the Gemma 4 fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-settings-legacy-'));
  fs.writeFileSync(path.join(dir, 'openbot-settings.json'), JSON.stringify({
    modelRouting: { engineering: { provider: 'opencode', model: 'ollama/llama3.2:3b' } }
  }));

  const routing = createOpenBotSettings(dir).get().modelRouting;
  assert.equal(routing.engineering.model, 'ollama/llama3.2:3b');
  assert.equal(routing.engineering.fallbackModel, 'ollama/gemma4:latest');
  assert.equal(routing.research.fallbackModel, 'ollama/gemma4:latest');
});
