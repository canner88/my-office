import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { readOpenBotOverview, readOpenBotTaskResult } from '../../server/openbot-source.mjs';

test('OpenBot overview classifies tasks and counts completed turns', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-openbot-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'fixture.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE projection_agents(agent_id TEXT PRIMARY KEY, agent_json TEXT NOT NULL);
    CREATE TABLE projection_threads(thread_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL);
    CREATE TABLE projection_turns(turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE projection_agent_threads(thread_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT NOT NULL, outcome TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT);
    CREATE TABLE agent_waits(wait_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL, woken_at TEXT);
    INSERT INTO projection_agents VALUES('agent-a', '{"name":"A"}');
    INSERT INTO projection_threads VALUES('t-done', 'agent-a'), ('t-run', 'agent-a'), ('t-queue', 'agent-a');
    INSERT INTO projection_agent_threads VALUES
      ('t-done','agent-a','Finished','completed',NULL,'2026-11-13T11:00:00.000Z','2026-11-13T12:00:00.000Z',NULL),
      ('t-run','agent-a','In progress',NULL,NULL,'2026-11-13T11:00:00.000Z','2026-11-13T12:00:00.000Z',NULL),
      ('t-queue','agent-a','Queued',NULL,NULL,'2026-11-13T11:00:00.000Z','2026-11-13T12:00:00.000Z',NULL);
    INSERT INTO projection_turns VALUES
      ('r-done','t-done','completed','2026-11-13T11:30:00.000Z','2026-11-13T11:40:00.000Z'),
      ('r-run','t-run','running','2026-11-13T11:50:00.000Z',NULL);
  `);
  db.close();
  const result = readOpenBotOverview({ dbPath, now: Date.parse('2026-11-13T12:00:00.000Z') });
  assert.deepEqual(Object.fromEntries(Object.entries(result.board).map(([key, rows]) => [key, rows.map((row) => row.id)])), {
    todo: ['t-queue'], doing: ['t-run'], done: ['t-done'], blocked: [],
  });
  assert.equal(result.daily.completed, 1);
  assert.equal(result.daily.running, 1);
  assert.equal(result.performance[0].completed, 1);
  assert.equal(result.performance[0].avgSeconds, 600);
  assert.deepEqual(result.waits, []);
});

test('OpenBot source reads a completed orchestration result by its callback marker', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'office-openbot-result-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const dbPath = path.join(dir, 'fixture.db');
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE projection_threads(thread_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE projection_agent_threads(thread_id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, title TEXT NOT NULL, outcome TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, archived_at TEXT);
    CREATE TABLE projection_turns(turn_id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL, completed_at TEXT);
    CREATE TABLE projection_thread_messages(thread_id TEXT NOT NULL, message_id TEXT NOT NULL, turn_id TEXT, author TEXT NOT NULL, status TEXT NOT NULL, item_type TEXT, created_at TEXT NOT NULL, ordinal INTEGER NOT NULL, message_json TEXT NOT NULL, PRIMARY KEY(thread_id, message_id));
    INSERT INTO projection_threads VALUES('thread-1','agent-a','Marker task','2026-11-13T12:02:00.000Z');
    INSERT INTO projection_agent_threads VALUES('thread-1','agent-a','Marker task','completed',NULL,'2026-11-13T12:00:00.000Z','2026-11-13T12:02:00.000Z',NULL);
    INSERT INTO projection_turns VALUES('turn-1','thread-1','completed','2026-11-13T12:00:10.000Z','2026-11-13T12:02:00.000Z');
    INSERT INTO projection_thread_messages VALUES
      ('thread-1','request-1','turn-1','user','completed',NULL,'2026-11-13T12:00:01.000Z',1,'{"text":"[MY_OFFICE_TASK:task-1:assignment-1:1] çalış"}'),
      ('thread-1','answer-1','turn-1','assistant','completed','final_answer','2026-11-13T12:01:59.000Z',2,'{"text":"Görev tamamlandı ve rapor hazır."}');
  `);
  db.close();
  const result = readOpenBotTaskResult({ dbPath, agentId: 'agent-a', marker: '[MY_OFFICE_TASK:task-1:assignment-1:1]', since: '2026-11-13T12:00:00.000Z' });
  assert.equal(result.status, 'completed');
  assert.equal(result.result, 'Görev tamamlandı ve rapor hazır.');
  assert.equal(result.externalTaskId, 'thread-1');
});
