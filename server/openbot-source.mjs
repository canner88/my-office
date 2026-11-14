// Live OpenBot agents as office sessions. Reads the local OpenBot database only.
// No Claude Code hooks, no demo cast. Rooms: Yönetim in front, Mesaj and Kod in
// department rooms, everyone else in Çalışma.
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { redact } from './redact.mjs';
import { createOpenBotSettings } from './openbot-settings.mjs';

const DB = process.env.OPENBOT_DB
  || path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'OpenBot', 'openbot.db');
const SETTINGS_DIR = process.env.MY_OFFICE_DATA_DIR || path.join(process.cwd(), 'data');
const openBotSettings = createOpenBotSettings(SETTINGS_DIR);

const SQL = `
SELECT a.agent_id AS id, a.agent_json AS json,
  (SELECT t.status FROM projection_turns t
     JOIN projection_threads th ON th.thread_id = t.thread_id
     WHERE th.agent_id = a.agent_id
     ORDER BY t.started_at DESC LIMIT 1) AS turn_status,
  (SELECT t.started_at FROM projection_turns t
     JOIN projection_threads th ON th.thread_id = t.thread_id
     WHERE th.agent_id = a.agent_id
     ORDER BY t.started_at DESC LIMIT 1) AS turn_started,
  (SELECT th.title FROM projection_threads th
     WHERE th.agent_id = a.agent_id
     ORDER BY th.updated_at DESC LIMIT 1) AS title,
  (SELECT m.item_type || '|' || COALESCE(m.author, '')
     FROM projection_thread_messages m
     JOIN projection_threads th ON th.thread_id = m.thread_id
     WHERE th.agent_id = a.agent_id
     ORDER BY m.created_at DESC LIMIT 1) AS last_msg,
  (SELECT m.message_json
     FROM projection_thread_messages m
     JOIN projection_threads th ON th.thread_id = m.thread_id
     WHERE th.agent_id = a.agent_id
     ORDER BY m.created_at DESC LIMIT 1) AS last_msg_json,
  (SELECT COUNT(*) FROM agent_waits w
     WHERE w.agent_id = a.agent_id AND w.woken_at IS NULL) AS waits
FROM projection_agents a
`;

const clip = (s, n = 70) => {
  const t = redact(String(s || '').replace(/\s+/g, ' ').trim());
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

const YONETIM = new Set(['director', 'görev masası']);
const MESAJ = new Set(['whatsapp orchestrator', 'telegram orchestrator', 'sosyal masa', 'support reply desk']);
const KOD = new Set(['bug fixer', 'change reviewer', 'prototype builder', 'skill smith', 'grokbuildassistant', 'rea', 'launch coordinator', 'jarvis', 'jarvis copy', 'claude', 'dr. eggbot']);

export function zoneOf(agent = {}) {
  const text = `${agent.act || ''} ${agent.task || ''} ${agent.role || ''}`.toLocaleLowerCase('tr-TR');
  if (/read|grep|glob|research|araştır|incele|kaynak/.test(text)) return 'Kütüphane';
  if (/bash|cmd|test|build|api|code|kod|edit|write/.test(text)) return 'Sunucu odası';
  if (/message|whatsapp|telegram|support|reply|mesaj/.test(text)) return 'Mesaj panosu';
  if (/agent|delegate|meeting|plan|ask|agent-exchange/.test(text)) return 'Lonca / toplantı masası';
  return 'Çalışma masası';
}

export function roomOf(name) {
  const n = String(name || '').toLocaleLowerCase('tr-TR');
  if (YONETIM.has(n)) return 'Yönetim';
  if (MESAJ.has(n)) return 'Mesaj';
  if (KOD.has(n)) return 'Kod';
  return 'Çalışma';
}

function actOf(item) {
  const i = String(item || '').toLowerCase();
  if (i === 'plan' || i === 'plan-continuation') return 'plan';
  if (i === 'question_prompt') return 'ask';
  if (i.startsWith('skill') || i === 'skill-suggestion:create') return 'skill';
  if (i.includes('mcp')) return 'mcp';
  if (i === 'routine' || i.startsWith('routine-') || i.startsWith('routine-run')) return 'plan';
  if (i === 'commentary' || i === 'final_answer' || i === 'agentMessage') return 'write';
  if (i === 'memory-changes' || i === 'instructions-change') return 'edit';
  if (i === 'subagents' || i === 'agent-exchange') return 'agent';
  if (i === 'vault-change') return 'write';
  return 'edit';
}

export function readOpenBotAgents() {
  const db = new DatabaseSync(DB, { readOnly: true, timeout: 1500 });
  try {
    return db.prepare(SQL).all().map((row) => {
      let profile = {};
      try { profile = JSON.parse(row.json || '{}'); } catch { /* skip a bad row */ }
      const [item, author] = String(row.last_msg || '').split('|');
      let msgObj = {};
      try { msgObj = JSON.parse(row.last_msg_json || '{}'); } catch {}
      const thoughtText = clip(msgObj.text || msgObj.content || '', 120);
      const running = row.turn_status === 'running';
      const asking = !running && item === 'question_prompt' && author === 'assistant';
      const status = row.waits > 0 || asking ? 'wait' : running ? 'work' : 'rest';
      const override = openBotSettings.getAgent(row.id);
      return {
        id: String(row.id || ''),
        name: clip(override.displayName || profile.name || 'agent', 32),
        role: clip(override.title || profile.title || '', 80),
        task: clip(row.title || '', 80),
        thought: status === 'work' ? (thoughtText || clip(row.title || '', 80)) : '',
        status: override.enabled === false ? 'rest' : status,
        act: status === 'wait' ? 'wait' : actOf(item),
        room: override.room || roomOf(profile.name || 'agent'),
        zone: override.zone || zoneOf({ act: status === 'wait' ? 'wait' : actOf(item), task: row.title || '', role: profile.role || profile.title || '' }),
        settings: override,
        started: Date.parse(row.turn_started || '') || 0,
      };
    }).filter((a) => a.id.startsWith('agent-'));
  } finally {
    db.close();
  }
}

export function readOpenBotTicker({ dbPath = DB, limit = 40 } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });
  try {
    const rows = db.prepare(`
      SELECT m.message_id AS id, m.item_type AS itemType, m.author, m.created_at AS createdAt,
             m.message_json AS messageJson, th.agent_id AS agentId, a.agent_json AS agentJson
      FROM projection_thread_messages m
      JOIN projection_threads th ON th.thread_id = m.thread_id
      JOIN projection_agents a ON a.agent_id = th.agent_id
      WHERE m.item_type IN ('commentary', 'final_answer', 'plan', 'agent-exchange', 'agentMessage', 'routine', 'question_prompt')
         OR m.author = 'user'
      ORDER BY m.created_at DESC LIMIT ?
    `).all(limit);
    return rows.map((r) => {
      let agent = {};
      let msg = {};
      try { agent = JSON.parse(r.agentJson || '{}'); } catch {}
      try { msg = JSON.parse(r.messageJson || '{}'); } catch {}
      const text = clip(msg.text || msg.content || '', 240);
      return {
        id: r.id,
        agentId: r.agentId,
        agentName: clip(agent.name || 'agent', 32),
        role: clip(agent.title || agent.role || '', 60),
        author: r.author,
        itemType: r.itemType || 'message',
        text,
        createdAt: r.createdAt
      };
    });
  } finally {
    db.close();
  }
}

export function readOpenBotTaskResult({ dbPath = DB, agentId, marker, since = '' } = {}) {
  if (!agentId || !marker) return null;
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });
  try {
    const request = db.prepare(`
      SELECT th.thread_id AS threadId, th.title, at.outcome, at.error, m.created_at AS requestedAt
      FROM projection_thread_messages m
      JOIN projection_threads th ON th.thread_id = m.thread_id
      JOIN projection_agent_threads at ON at.thread_id = th.thread_id
      WHERE th.agent_id = ? AND m.author = 'user' AND m.message_json LIKE ? AND m.created_at >= ?
      ORDER BY m.created_at DESC LIMIT 1
    `).get(String(agentId), `%${marker}%`, since || '1970-01-01T00:00:00.000Z');
    if (!request) return null;

    const turn = db.prepare(`
      SELECT turn_id AS turnId, status, completed_at AS completedAt
      FROM projection_turns
      WHERE thread_id = ? AND started_at >= ?
      ORDER BY started_at DESC LIMIT 1
    `).get(request.threadId, request.requestedAt);
    if (!turn || turn.status === 'running') return null;

    const messages = db.prepare(`
      SELECT item_type AS itemType, message_json AS messageJson
      FROM projection_thread_messages
      WHERE thread_id = ? AND author = 'assistant' AND created_at >= ?
        AND item_type IN ('final_answer', 'agentMessage', 'commentary')
      ORDER BY created_at DESC LIMIT 20
    `).all(request.threadId, request.requestedAt);
    let result = '';
    for (const message of messages) {
      try {
        const parsed = JSON.parse(message.messageJson || '{}');
        const text = String(parsed.text || parsed.content || '').trim();
        if (text && (message.itemType === 'final_answer' || message.itemType === 'agentMessage')) { result = text; break; }
        if (!result && text) result = text;
      } catch { /* ignore malformed projection rows */ }
    }
    if (!result && request.error) result = String(request.error);
    if (!result) return null;
    return {
      status: turn.status === 'completed' && request.outcome !== 'failed' ? 'completed' : 'failed',
      result,
      externalTaskId: request.threadId,
      completedAt: turn.completedAt || null
    };
  } finally {
    db.close();
  }
}


export function readOpenBotOverview({ dbPath = DB, now = Date.now() } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });
  try {
    const tasks = db.prepare(`
      SELECT t.thread_id AS id, a.agent_json AS agentJson,
        t.title, t.outcome, t.error, t.updated_at AS updatedAt,
        (SELECT status FROM projection_turns r WHERE r.thread_id = t.thread_id
          ORDER BY r.started_at DESC LIMIT 1) AS turnStatus
      FROM projection_agent_threads t
      JOIN projection_agents a ON a.agent_id = t.agent_id
      WHERE t.archived_at IS NULL AND (t.updated_at >= ? OR t.outcome IS NULL)
      ORDER BY t.updated_at DESC LIMIT 100
    `).all(new Date(now - 7 * 86400000).toISOString());
    const board = { todo: [], doing: [], done: [], blocked: [] };
    for (const task of tasks) {
      let profile = {};
      try { profile = JSON.parse(task.agentJson || '{}'); } catch {}
      const status = task.turnStatus === 'running' ? 'doing'
        : task.outcome === 'completed' ? 'done'
          : task.outcome === 'failed' || task.outcome === 'interrupted' ? 'blocked' : 'todo';
      board[status].push({ id: task.id, title: clip(task.title, 100), agent: clip(profile.name || 'agent', 32),
        status, updatedAt: task.updatedAt, error: status === 'blocked' ? clip(task.error, 120) : '' });
    }
    const since = new Date(now - 86400000).toISOString();
    const day = db.prepare(`
      SELECT COUNT(*) AS turns,
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
        SUM(CASE WHEN status IN ('failed', 'interrupted') THEN 1 ELSE 0 END) AS failed,
        SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running
      FROM projection_turns WHERE started_at >= ?
    `).get(since);
    const performance = db.prepare(`
      SELECT a.agent_id AS id, a.agent_json AS json, COUNT(r.turn_id) AS completed,
        AVG((julianday(r.completed_at) - julianday(r.started_at)) * 86400) AS avgSeconds,
        MAX(r.completed_at) AS lastCompleted
      FROM projection_agents a
      LEFT JOIN projection_turns r ON r.thread_id IN
        (SELECT thread_id FROM projection_threads WHERE agent_id = a.agent_id)
        AND r.status = 'completed' AND r.completed_at IS NOT NULL
      GROUP BY a.agent_id ORDER BY completed DESC LIMIT 50
    `).all().map((row) => {
      let profile = {};
      try { profile = JSON.parse(row.json || '{}'); } catch { /* fallback name */ }
      return { id: row.id, name: clip(profile.name || 'agent', 32), completed: Number(row.completed),
        avgSeconds: row.avgSeconds == null ? null : Math.round(row.avgSeconds), lastCompleted: row.lastCompleted };
    });
    const waits = db.prepare(`
      SELECT w.wait_id AS id, a.agent_json AS agentJson, w.note, w.created_at AS createdAt
      FROM agent_waits w LEFT JOIN projection_agents a ON a.agent_id = w.agent_id
      WHERE w.woken_at IS NULL ORDER BY w.created_at DESC LIMIT 50
    `).all().map((row) => {
      let profile = {};
      try { profile = JSON.parse(row.agentJson || '{}'); } catch { /* fallback name */ }
      return { id: row.id, agent: clip(profile.name || 'agent', 32), note: clip(row.note, 120), createdAt: row.createdAt };
    });
    return { ok: true, generatedAt: new Date(now).toISOString(), board,
      daily: { windowHours: 24, turns: Number(day.turns || 0), completed: Number(day.completed || 0),
        failed: Number(day.failed || 0), running: Number(day.running || 0) }, performance, waits };
  } finally { db.close(); }
}

export function readOpenBotMessagingConnections({ dbPath = DB } = {}) {
  const db = new DatabaseSync(dbPath, { readOnly: true, timeout: 1500 });
  try {
    const rows = db.prepare(`
      SELECT c.connection_id AS id, c.platform, c.workspace_id AS workspaceId,
             c.workspace_name AS workspaceName, c.enabled, c.bot_user_id AS botUserId,
             c.orchestrator_agent_id AS orchestratorAgentId, c.updated_at AS updatedAt,
             a.agent_json AS agentJson
      FROM projection_messaging_connections c
      LEFT JOIN projection_agents a ON a.agent_id = c.orchestrator_agent_id
    `).all();
    return rows.map((r) => {
      let agent = {};
      try { agent = JSON.parse(r.agentJson || '{}'); } catch {}
      return {
        id: r.id,
        platform: r.platform,
        workspaceId: r.workspaceId,
        workspaceName: clip(r.workspaceName, 40),
        enabled: Boolean(r.enabled),
        botUserId: r.botUserId,
        orchestratorAgentId: r.orchestratorAgentId,
        orchestratorName: clip(agent.name || (r.platform === 'whatsapp' ? 'WhatsApp Orchestrator' : 'Telegram Orchestrator'), 32),
        orchestratorRole: clip(agent.title || agent.role || '', 60),
        updatedAt: r.updatedAt
      };
    });
  } catch {
    return [];
  } finally {
    db.close();
  }
}
/** @param {{ sessions: Map, sidToKey: Map, newSession: Function, broadcast: Function, pub: Function, pushFeed: Function, takeId: Function, floor: string }} ctx */
export function startOpenBot(ctx) {
  const { sessions, sidToKey, newSession, broadcast, pub, pushFeed, takeId, floor } = ctx;
  let warned = false;
  let announced = false;

  const emit = (s, type, label) => {
    const e = { id: takeId(), ts: Date.now(), sess: s.id, name: s.name, type, label };
    s.last = { type, label };
    s.lastEventAt = Date.now();
    pushFeed(e);
    broadcast({ k: 'ev', e, s: pub(s) });
  };

  const tick = () => {
    let agents;
    try { agents = readOpenBotAgents(); }
    catch (err) {
      if (!warned) { warned = true; console.error('openbot source:', err.message); }
      return;
    }
    warned = false;
    agents.sort((a, b) => (a.status === 'work' ? 0 : 1) - (b.status === 'work' ? 0 : 1) || a.name.localeCompare(b.name));
    const live = new Set();
    for (const a of agents) {
      const key = 'ob:' + a.id;
      live.add(key);
      let s = sessions.get(key);
      const fresh = !s;
      if (!s) {
        s = newSession(key);
        s.openbot = true;
        s.entry = 'openbot';
        s.sid = a.id;
        s.cwd = floor;
        sessions.set(key, s);
        sidToKey.set(a.id, key);
      }
      const sig = `${a.status}|${a.act}|${a.task}`;
      const changed = fresh || s.obSig !== sig || s.name !== a.name;
      const room = a.room || roomOf(a.name);
      const roomChanged = s.room !== room;
      s.room = room;
      s.boss = room === 'Yönetim' && a.name.toLocaleLowerCase('tr-TR') === 'director';
      s.name = a.name;
      s.title = a.name;
      s.origin = a.role;
      s.cwd = floor;
      s.status = a.status;
      s.busy = a.status === 'work';
      s.inTool = a.status === 'work';
      s.lastPrompt = a.task;
      s.lastEventAt = Date.now();
      if (a.status === 'work') { if (!s.taskStart) s.taskStart = a.started || Date.now(); s.doneAt = 0; }
      else if (a.status === 'rest') { s.inTool = false; s.taskStart = 0; if (!s.doneAt) s.doneAt = Date.now(); }
      if (fresh) {
        if (a.status !== 'rest') s.last = { type: a.act, label: a.thought || a.task || a.name };
        broadcast({ k: 'sess', s: pub(s) });
      } else if (changed && a.status === 'work') emit(s, a.act === 'ask' ? 'ask' : a.act, a.thought || a.task || a.name);
      else if (changed && a.status === 'wait') emit(s, 'wait', a.task || a.name);
      else if (changed && s.obSig && s.obSig.startsWith('work|')) emit(s, 'stop', a.task || '');
      else if (changed || roomChanged) broadcast({ k: 'sess', s: pub(s) });
      s.obSig = sig;
    }
    for (const [key, s] of sessions) {
      if (!s.openbot || live.has(key)) continue;
      sessions.delete(key);
      if (s.sid && sidToKey.get(s.sid) === key) sidToKey.delete(s.sid);
      broadcast({ k: 'gone', id: s.id });
    }
    if (!announced) { announced = true; console.log(`OpenBot source: ${agents.length} agents, no Claude`); }
  };

  tick();
  setInterval(tick, 2000).unref();
}


