import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { classifyTask, createOpenBotOrchestrator } from '../../server/openbot-orchestration.mjs';
import { createOpenBotGamification } from '../../server/openbot-gamification.mjs';

test('director maps task types to functional office zones', () => {
  assert.deepEqual(classifyTask('Araştır ve kaynakları karşılaştır'), {
    kind: 'research', label: 'Araştırma ve kaynak', station: 'library', room: 'Çalışma'
  });
  assert.equal(classifyTask('Ayarları ve dağıtımı planla').station, 'brief');
  assert.equal(classifyTask('Genel bir iş').room, 'Yönetim');
});

test('director workflow creates a meeting, assignments, peer review, and report', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-office-orch-'));
  const gamification = createOpenBotGamification(dir);
  const agents = [
    { id: 'director', name: 'Director', role: 'Director', room: 'Yönetim', enabled: true },
    { id: 'coder', name: 'Coder', role: 'Developer', room: 'Kod', enabled: true },
    { id: 'research', name: 'Research', role: 'Researcher', room: 'Çalışma', enabled: true }
  ];
  const calls = [];
  const orch = createOpenBotOrchestrator({
    dataDir: dir,
    readAgents: () => agents,
    gamification,
    startTask: async (input) => { calls.push(input); return { ok: true, taskId: `t-${input.agentId}` }; }
  });

  const created = await orch.create('Build an API and research the market');
  assert.equal(created.status, 'meeting');
  assert.equal(created.phase, 'meeting');
  assert.equal(created.assignments.length, 3);
  assert.equal(created.peerReviewEnabled, true);

  const working = await orch.advance(created.id);
  assert.equal(working.phase, 'working');
  assert.equal(calls.length, 3);

  for (const item of working.assignments) {
    await orch.receiveResult(created.id, item.agentId, `${item.agent} sonucu`);
  }

  const inReview = orch.get(created.id);
  assert.equal(inReview.phase, 'peer_review');

  // Review the peer assignments
  for (const item of inReview.assignments) {
    await orch.reviewPeer(created.id, item.id, { status: 'approved', notes: `${item.agent} çalışması Lonca masasında onaylandı` });
  }

  const regrouped = orch.get(created.id);
  assert.equal(regrouped.phase, 'regroup');

  const finished = await orch.complete(created.id);
  assert.equal(finished.status, 'completed');
  assert.match(finished.finalReport, /Director özeti/);
  assert.match(finished.finalReport, /Lonca İkili İnceleme/);

  // Gamification stats check
  const coderStats = gamification.getStats('coder');
  assert.ok(coderStats.xp > 0);
  assert.equal(coderStats.completedTasks, 1);
  assert.ok(coderStats.badges.includes('first_task'));
});

test('orchestrator self-healing watchdog heals failed agent', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-office-orch-heal-'));
  const gamification = createOpenBotGamification(dir);
  const agents = [
    { id: 'director', name: 'Director', role: 'Director', room: 'Yönetim', enabled: true },
    { id: 'failing_agent', name: 'Buggy', role: 'Developer', room: 'Kod', enabled: true },
    { id: 'backup_agent', name: 'Standby Hero', role: 'Developer', room: 'Kod', enabled: true }
  ];
  const orch = createOpenBotOrchestrator({
    dataDir: dir,
    readAgents: () => agents,
    gamification,
    startTask: async () => ({ ok: true })
  });

  const created = await orch.create('Kritik sistem onarımı');
  const working = await orch.advance(created.id);
  const target = working.assignments[0];

  // Agent reports failure / model missing
  await orch.receiveResult(created.id, target.agentId, "stream disconnected before completion: model 'gemma4:12b' not found", 'failed');

  const healedTask = orch.get(created.id);
  assert.ok(healedTask.selfHealingEvents.length >= 1);
  assert.equal(healedTask.selfHealingEvents[0].from, target.agent);
  assert.equal(healedTask.assignments[0].healed, true);
});

test('orchestrator makes duplicate delivery reports idempotent and rejects conflicting reports', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-office-orch-idempotency-'));
  const agents = [
    { id: 'coder', name: 'Coder', role: 'Developer', room: 'Kod', enabled: true }
  ];
  const orch = createOpenBotOrchestrator({
    dataDir: dir,
    readAgents: () => agents,
    startTask: async () => ({ ok: true, taskId: 'delivery-coder' })
  });

  const created = await orch.create('Build a small API', { peerReview: false });
  const working = await orch.advance(created.id);
  const assignment = working.assignments[0];

  const first = await orch.receiveResult(created.id, assignment.agentId, 'İlk rapor');
  const duplicate = await orch.receiveResult(created.id, assignment.agentId, 'İlk rapor');
  assert.equal(first.assignments[0].resultReceivedAt, duplicate.assignments[0].resultReceivedAt);
  await assert.rejects(
    () => orch.receiveResult(created.id, assignment.agentId, 'Değiştirilmiş rapor'),
    /Atama zaten tamamlandı/
  );
});

test('orchestrator collects completed results and dispatches dependent stages', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'my-office-orch-stages-'));
  const agents = [
    { id: 'research', name: 'Research', role: 'Researcher', room: 'Çalışma', enabled: true },
    { id: 'coder', name: 'Coder', role: 'Developer', room: 'Kod', enabled: true }
  ];
  const calls = [];
  const orch = createOpenBotOrchestrator({
    dataDir: dir,
    readAgents: () => agents,
    startTask: async (input) => { calls.push(input); return { ok: true, taskId: input.assignmentId }; },
    readTaskResult: ({ assignment }) => assignment.agentId === 'research'
      ? { status: 'completed', result: 'Araştırma raporu hazır' }
      : { status: 'completed', result: 'Kod raporu hazır' }
  });

  const created = await orch.create('Araştır, sonra geliştir', {
    peerReview: false,
    stages: [
      { id: 'research', label: 'Araştırma', agentIds: ['research'] },
      { id: 'build', label: 'Geliştirme', dependsOn: ['research'], agentIds: ['coder'] }
    ]
  });
  assert.equal(created.executionPlan[1].dependsOn[0], 'research');
  assert.ok(created.decisionLog.some((entry) => entry.type === 'dependency-plan'));

  await orch.advance(created.id);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].agentId, 'research');

  await orch.collectResults();
  assert.equal(calls.length, 2);
  assert.equal(calls[1].agentId, 'coder');
  const regrouped = orch.get(created.id);
  assert.equal(regrouped.phase, 'regroup');
  assert.equal(regrouped.assignments.every((item) => item.status === 'completed'), true);
});
