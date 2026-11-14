import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const MAX_TASKS = 40;
const clampText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const now = () => new Date().toISOString();
const clone = (value) => JSON.parse(JSON.stringify(value));
const stageId = (value, index) => clampText(value || `stage-${index + 1}`, 60).toLocaleLowerCase('en-US').replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || `stage-${index + 1}`;

export function classifyTask(prompt) {
  const text = String(prompt || '').toLocaleLowerCase('tr-TR');
  if (/kod|api|uygulama|bug|test|build|yazılım|frontend|backend|refactor|sunucu/.test(text)) return { kind: 'engineering', label: 'Kod ve test', station: 'server', room: 'Kod' };
  if (/araştır|analiz|pazar|doküman|incele|kaynak|rapor|karşılaştır/.test(text)) return { kind: 'research', label: 'Araştırma ve kaynak', station: 'library', room: 'Çalışma' };
  if (/mesaj|müşteri|whatsapp|telegram|iletişim|yanıt|destek/.test(text)) return { kind: 'communications', label: 'Mesaj ve destek', station: 'board', room: 'Mesaj' };
  if (/tasarım|arayüz|ui|ux|görsel|prototip/.test(text)) return { kind: 'design', label: 'Tasarım ve prototip', station: 'globe', room: 'Çalışma' };
  if (/mcp|entegrasyon|bağlan|kurulum|ayar|ofis|ajan|dağıtım|onay|plan/.test(text)) return { kind: 'operations', label: 'Operasyon ve entegrasyon', station: 'brief', room: 'Yönetim' };
  return { kind: 'general', label: 'Genel çözüm', station: 'meeting', room: 'Yönetim' };
}

export function chooseAgents(agents, prompt) {
  const text = prompt.toLocaleLowerCase('tr-TR');
  const category = classifyTask(text);
  const ranked = agents
    .filter((a) => a?.enabled !== false && !a.boss)
    .map((a) => {
      const hay = `${a.name || ''} ${a.role || ''} ${a.room || ''}`.toLocaleLowerCase('tr-TR');
      let score = 1;
      if (category.kind === 'engineering' && /kod|developer|engineer|build|bug|test|software|prototype/.test(hay)) score += 8;
      if (category.kind === 'research' && /araştır|research|analyst|strategy|desk|scope/.test(hay)) score += 8;
      if (category.kind === 'communications' && /mesaj|support|social|telegram|whatsapp|reply/.test(hay)) score += 8;
      if (category.kind === 'design' && /tasarım|design|ui|ux|creative|prototype/.test(hay)) score += 8;
      if (category.kind === 'operations' && /chief|launch|director|office|ops|desk|admin/.test(hay)) score += 8;
      if (category.room === a.room) score += 2;
      if (a.status === 'rest') score += 1;
      return { a, score };
    })
    .sort((x, y) => y.score - x.score || String(x.a.name).localeCompare(String(y.a.name), 'tr'));
  const count = Math.min(4, Math.max(1, ranked.length));
  return ranked.slice(0, count).map(({ a }) => a);
}

function assignmentFor(agent, prompt, index, category, model = {}, { stage = null, staged = false } = {}) {
  const role = agent.role || 'Genel görev';
  return {
    id: `assignment-${index + 1}`,
    agentId: agent.id,
    agent: agent.name || agent.id,
    role,
    room: category.room || agent.room || 'Çalışma',
    zone: category.label,
    workStation: category.station,
    provider: model.provider || '',
    model: model.model || '',
    brief: `“${prompt}” görevi için ${role.toLocaleLowerCase('tr-TR')} katkısı`,
    status: staged ? 'queued' : 'working',
    result: '',
    startedAt: now(),
    finishedAt: null,
    externalTaskId: null,
    dispatch: staged ? 'waiting-dependency' : 'local-oversight',
    stageId: stage,
    dispatchAttempt: 0,
    callbackMarker: null,
    reportRequired: true,
    reportRequestedAt: null,
    resultReceivedAt: null,
    peerReview: null,
    healed: false,
    originalAgent: null,
    healingReason: null
  };
}

export function createOpenBotOrchestrator({ dataDir, readAgents, startTask = null, readTaskResult = null, modelForCategory = null, gamification = null, notifications = null } = {}) {
  if (!dataDir || typeof readAgents !== 'function') throw new Error('Orchestrator requires dataDir and readAgents');
  const file = path.join(dataDir, 'openbot-orchestration.json');
  let state = { version: 1, tasks: [] };
  try { state = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  if (!Array.isArray(state.tasks)) state.tasks = [];
  const save = async () => { await fsp.mkdir(dataDir, { recursive: true }); await fsp.writeFile(file, JSON.stringify(state, null, 2)); };
  const publicTask = (task) => clone(task);
  const find = (id) => state.tasks.find((x) => x.id === id);

  const refreshExecutionPlan = (task) => {
    if (!Array.isArray(task.executionPlan)) return;
    const statusById = new Map(task.assignments.map((item) => [item.id, item.status]));
    for (const stage of task.executionPlan) {
      const statuses = stage.assignmentIds.map((id) => statusById.get(id));
      if (statuses.length && statuses.every((status) => status === 'completed')) stage.status = 'completed';
      else if (statuses.some((status) => status === 'working' || status === 'completed')) stage.status = 'working';
      else stage.status = 'pending';
    }
  };

  const readyAssignments = (task) => {
    if (!Array.isArray(task.executionPlan)) return task.assignments.filter((item) => item.status !== 'completed');
    refreshExecutionPlan(task);
    const completed = new Set(task.executionPlan.filter((stage) => stage.status === 'completed').map((stage) => stage.id));
    const readyStages = new Set(task.executionPlan
      .filter((stage) => stage.status === 'pending' && stage.dependsOn.every((dependency) => completed.has(dependency)))
      .map((stage) => stage.id));
    return task.assignments.filter((item) => item.status === 'queued' && readyStages.has(item.stageId));
  };

  const decision = (task, type, data) => {
    task.decisionLog = task.decisionLog || [];
    task.decisionLog.push({ at: now(), type, ...data });
  };

  async function create(prompt, options = {}) {
    const clean = clampText(prompt, 4000);
    if (!clean) throw new Error('Görev metni boş olamaz');
    const category = classifyTask(clean);
    const selected = chooseAgents(readAgents(), clean);
    const peerReviewEnabled = options.peerReview !== false && selected.length >= 2;
    const stageDefinitions = Array.isArray(options.stages) ? options.stages.filter((stage) => stage && typeof stage === 'object') : [];
    const staged = stageDefinitions.length > 0;
    const normalizedStages = stageDefinitions.map((stage, index) => ({
      id: stageId(stage.id || stage.name, index),
      label: clampText(stage.label || stage.name || `Aşama ${index + 1}`, 100),
      dependsOn: Array.isArray(stage.dependsOn) ? stage.dependsOn.map((dependency) => stageId(dependency, 0)).filter(Boolean) : [],
      agentIds: Array.isArray(stage.agentIds) ? stage.agentIds.map(String) : []
    }));

    const assignments = selected.map((a, i) => {
      const definition = staged
        ? normalizedStages.find((stage) => stage.agentIds.includes(String(a.id))) || normalizedStages[i % normalizedStages.length]
        : null;
      return assignmentFor(a, clean, i, category, modelForCategory ? modelForCategory(category.kind, a) : {}, { stage: definition?.id || null, staged });
    });

    const executionPlan = staged ? normalizedStages.map((stage) => ({
      id: stage.id,
      label: stage.label,
      dependsOn: stage.dependsOn.filter((dependency) => normalizedStages.some((candidate) => candidate.id === dependency && candidate.id !== stage.id)),
      assignmentIds: assignments.filter((item) => item.stageId === stage.id).map((item) => item.id),
      status: 'pending'
    })).filter((stage) => stage.assignmentIds.length > 0) : null;

    if (peerReviewEnabled) {
      for (let i = 0; i < assignments.length; i++) {
        const reviewer = assignments[(i + 1) % assignments.length];
        assignments[i].peerReview = {
          reviewerAgentId: reviewer.agentId,
          reviewerName: reviewer.agent,
          status: 'pending',
          notes: '',
          reviewedAt: null
        };
      }
    }

    const task = {
      id: crypto.randomUUID(),
      prompt: clean,
      status: 'meeting',
      phase: 'meeting',
      category,
      createdAt: now(),
      updatedAt: now(),
      peerReviewEnabled,
      peerReviewCompleted: false,
      selfHealingEvents: [],
      executionPlan,
      decisionLog: [],
      directorAgentId: 'agent-cbbbfd31-0e53-4579-9035-3ab6b2f772e7',
      meeting: {
        status: 'in-progress',
        startedAt: now(),
        participants: selected.map((a) => ({ id: a.id, name: a.name || a.id, role: a.role || 'Agent', room: category.room || a.room || 'Çalışma' })),
        notes: `Director görevi masaya taşıdı. Ekip toplantı masasında kapsamı netleştiriyor.${peerReviewEnabled ? ' Lonca ikili inceleme (Peer Review) aktif.' : ''} Çalışma bitince her ajan zorunlu rapor verecek.`
      },
      assignments,
      finalReport: '',
      spokenSummary: '',
      integration: { mode: startTask ? 'openbot-api' : 'local-oversight', connected: Boolean(startTask), message: startTask ? 'OpenBot görev bağlayıcısı etkin.' : 'OpenBot görev API bağlayıcısı yapılandırılmadı; yerel koordinasyon kaydı tutuluyor.' }
    };
    for (const item of assignments) {
      decision(task, 'agent-selection', {
        assignmentId: item.id,
        agentId: item.agentId,
        agent: item.agent,
        category: category.kind,
        reason: `${category.label} için ${item.role} rolü ve ${item.room} odası uygun bulundu.`
      });
      decision(task, 'model-selection', {
        assignmentId: item.id,
        agentId: item.agentId,
        provider: item.provider || 'varsayılan',
        model: item.model || 'varsayılan',
        reason: item.model ? `${category.kind} görev kuralı uygulandı.` : 'Ajanın varsayılan modeli kullanılacak.'
      });
    }
    if (executionPlan) decision(task, 'dependency-plan', { stages: executionPlan.map((stage) => ({ id: stage.id, label: stage.label, dependsOn: stage.dependsOn })) });
    state.tasks.unshift(task);
    state.tasks = state.tasks.slice(0, MAX_TASKS);
    task.updatedAt = now();
    await save();
    return publicTask(task);
  }

  async function healAssignment(task, item, reason) {
    const allAgents = readAgents();
    const assignedIds = new Set(task.assignments.map((a) => a.agentId));
    let fallback = allAgents.find((a) => a.enabled !== false && !assignedIds.has(a.id) && !a.boss);
    if (!fallback) fallback = allAgents.find((a) => a.id !== item.agentId && a.enabled !== false && !a.boss) || allAgents[0];

    const prevAgentName = item.agent;
    item.originalAgent = prevAgentName;
    item.healed = true;
    item.healingReason = clampText(reason, 200);
    item.agentId = fallback.id;
    item.agent = fallback.name;
    item.role = fallback.role || item.role;
    item.status = 'working';
    item.result = '';
    item.dispatch = 'reassigned';
    item.dispatchAttempt = Number(item.dispatchAttempt || 0) + 1;
    item.callbackMarker = `[MY_OFFICE_TASK:${task.id}:${item.id}:${item.dispatchAttempt}]`;
    decision(task, 'dispatch', {
      assignmentId: item.id,
      agentId: item.agentId,
      agent: item.agent,
      stageId: item.stageId,
      attempt: item.dispatchAttempt,
      reason: 'Watchdog devri sonrası yedek ajan görevi aldı.'
    });

    task.selfHealingEvents.push({
      ts: now(),
      assignmentId: item.id,
      from: prevAgentName,
      to: fallback.name,
      reason: clampText(reason, 200)
    });

    if (startTask) {
      try {
        const res = await startTask({
          agentId: item.agentId,
          text: `${item.callbackMarker} [Oto-İyileştirme / Watchdog Devri] ${item.brief}. Önceki ajan arızalandı (${reason}). Ana görev: ${task.prompt}. Director senden rapor istiyor.`,
          orchestrationId: task.id,
          assignmentId: item.id,
          reportRequired: true,
          provider: item.provider,
          model: item.model
        });
        item.externalTaskId = res?.taskId || null;
        item.dispatch = res?.ok ? 'sent' : 'failed';
      } catch (err) {
        item.dispatch = 'failed';
      }
    }

    if (gamification) await gamification.recordSelfHealing(fallback.id, reason).catch(() => {});
    if (notifications) {
      notifications.notify({
        event: 'selfHealing',
        title: 'Watchdog Devreye Girdi (Oto-İyileştirme)',
        body: `Arıza: ${prevAgentName} (${reason})\nYeni atanan: ${fallback.name}`,
        meta: { taskPrompt: task.prompt, assignment: item.brief }
      }).catch(() => {});
    }
  }

  async function dispatch(task) {
    for (const item of readyAssignments(task)) {
      item.status = 'working';
      item.dispatchAttempt = Number(item.dispatchAttempt || 0) + 1;
      item.callbackMarker = `[MY_OFFICE_TASK:${task.id}:${item.id}:${item.dispatchAttempt}]`;
      decision(task, 'dispatch', { assignmentId: item.id, agentId: item.agentId, agent: item.agent, stageId: item.stageId, attempt: item.dispatchAttempt, reason: item.stageId ? 'Ön koşulları tamamlanan aşama hazır.' : 'Görev dağıtımı başlatıldı.' });
      if (!startTask) {
        item.dispatch = 'local-oversight';
        continue;
      }
      try {
        item.reportRequestedAt = now();
        const result = await startTask({
          agentId: item.agentId,
          text: `${item.callbackMarker} ${item.brief}. Ana görev: ${task.prompt}. Director senden görevin sonunda kısa bir rapor istiyor: yapılanlar, bulgular, sorunlar ve sonraki adım. Raporu orchestrationId ve assignmentId ile geri gönder.`,
          orchestrationId: task.id,
          assignmentId: item.id,
          reportRequired: true,
          provider: item.provider,
          model: item.model
        });
        item.externalTaskId = result?.taskId || null;
        item.dispatch = result?.ok ? 'sent' : 'failed';
      } catch (err) {
        item.dispatch = 'failed';
        item.result = clampText(err.message || err, 500);
        await healAssignment(task, item, err.message || 'Görev gönderilemedi');
      }
    }
    refreshExecutionPlan(task);
  }

  async function collectResults() {
    if (typeof readTaskResult !== 'function') return { ok: true, checked: 0, collected: 0, skipped: 'reader_unavailable' };
    const active = state.tasks.filter((task) => ['working', 'peer_review', 'regroup'].includes(task.status));
    let checked = 0;
    let collected = 0;
    for (const task of active) {
      for (let pass = 0; pass < task.assignments.length; pass += 1) {
        let passCollected = 0;
        for (const item of task.assignments.filter((assignment) => assignment.status === 'working' && assignment.callbackMarker)) {
          checked += 1;
          const result = await Promise.resolve(readTaskResult({ task: publicTask(task), assignment: publicTask(item) })).catch(() => null);
          if (!result?.result) continue;
          await receiveResult(task.id, item.agentId, result.result, result.status === 'failed' ? 'failed' : 'completed');
          collected += 1;
          passCollected += 1;
        }
        if (!passCollected) break;
      }
    }
    return { ok: true, checked, collected };
  }

  async function advance(id) {
    const task = find(id);
    if (!task) throw new Error('Görev bulunamadı');

    if (task.phase === 'meeting') {
      task.phase = 'working';
      task.status = 'working';
      task.meeting.status = 'completed';
      task.meeting.finishedAt = now();
      await dispatch(task);
    } else if (task.phase === 'working' && task.assignments.length && task.assignments.every((a) => a.status === 'completed')) {
      if (task.peerReviewEnabled && !task.peerReviewCompleted) {
        task.phase = 'peer_review';
        task.status = 'peer_review';
        task.meeting = {
          ...task.meeting,
          status: 'peer_review',
          notes: 'Ajanlar Lonca masasında toplandı; sonuçlar ikili inceleme (Peer Review) ile çapraz kontrol ediliyor.'
        };
      } else {
        task.phase = 'regroup';
        task.status = 'regroup';
        task.meeting = {
          ...task.meeting,
          status: 'review',
          reviewAt: now(),
          notes: 'Ajanlar görev bölgelerinden toplantı masasına döndü; Director sonuçları birleştiriyor.'
        };
      }
    } else if (task.phase === 'peer_review') {
      task.peerReviewCompleted = true;
      task.phase = 'regroup';
      task.status = 'regroup';
      task.meeting = {
        ...task.meeting,
        status: 'review',
        reviewAt: now(),
        notes: 'Lonca ikili incelemeleri onaylandı; ekip tekrar toplantı masasında buluştu.'
      };
    }
    task.updatedAt = now();
    await save();
    return publicTask(task);
  }

  async function receiveResult(id, agentId, result, status = 'completed') {
    const task = find(id);
    if (!task) throw new Error('Görev bulunamadı');
    const item = task.assignments.find((a) => a.agentId === agentId || a.id === agentId);
    if (!item) throw new Error('Atama bulunamadı');

    const report = clampText(result, 2000);
    if (!report) throw new Error('Director raporu boş kabul etmiyor');

    if (item.status === 'completed') {
      if (item.result === report) return publicTask(task);
      throw new Error('Atama zaten tamamlandı');
    }

    if (status === 'failed' || /model '.*' not found|stream disconnected|blocked/i.test(report)) {
      await healAssignment(task, item, report);
      task.updatedAt = now();
      await save();
      return publicTask(task);
    }

    item.status = status;
    item.result = report;
    item.finishedAt = now();
    item.resultReceivedAt = now();
    refreshExecutionPlan(task);

    if (task.executionPlan && task.executionPlan.some((stage) => stage.status === 'pending')) await dispatch(task);

    if (task.assignments.every((a) => a.status === 'completed')) {
      if (task.peerReviewEnabled && !task.peerReviewCompleted) {
        task.phase = 'peer_review';
        task.status = 'peer_review';
        task.meeting = {
          ...task.meeting,
          status: 'peer_review',
          notes: 'Tüm raporlar alındı; ekip Lonca masasında ikili inceleme (Peer Review) aşamasına geçti.'
        };
      } else {
        task.phase = 'regroup';
        task.status = 'regroup';
        task.meeting = {
          ...task.meeting,
          status: 'review',
          reviewAt: now(),
          notes: 'Ajan sonuçları alındı; ekip tekrar toplantı masasında.'
        };
      }
    }
    task.updatedAt = now();
    await save();
    return publicTask(task);
  }

  async function reviewPeer(id, assignmentId, { status = 'approved', notes = '' } = {}) {
    const task = find(id);
    if (!task) throw new Error('Görev bulunamadı');
    const item = task.assignments.find((a) => a.id === assignmentId);
    if (!item || !item.peerReview) throw new Error('İnceleme kaydı bulunamadı');

    item.peerReview.status = status;
    item.peerReview.notes = clampText(notes || 'Çözüm doğrulandı ve onaylandı.', 500);
    item.peerReview.reviewedAt = now();

    if (gamification && item.peerReview.reviewerAgentId) {
      await gamification.recordPeerReview(item.peerReview.reviewerAgentId, item.agentId).catch(() => {});
    }

    const allReviewed = task.assignments.every((a) => !a.peerReview || a.peerReview.status === 'approved');
    if (allReviewed) {
      task.peerReviewCompleted = true;
      task.phase = 'regroup';
      task.status = 'regroup';
      task.meeting = {
        ...task.meeting,
        status: 'review',
        reviewAt: now(),
        notes: 'Lonca masasında tüm incelemeler başarıyla tamamlandı; ekip son onay için hazır.'
      };
    }
    task.updatedAt = now();
    await save();
    return publicTask(task);
  }

  async function complete(id, results = {}) {
    const task = find(id);
    if (!task) throw new Error('Görev bulunamadı');
    for (const item of task.assignments) {
      if (results[item.agentId]) {
        item.result = clampText(results[item.agentId], 2000);
        item.status = 'completed';
        item.finishedAt = item.finishedAt || now();
        item.resultReceivedAt = item.resultReceivedAt || now();
      }
    }
    const missing = task.assignments.filter((item) => item.reportRequired !== false && (item.status !== 'completed' || !item.result));
    if (missing.length) throw new Error(`Rapor bekleniyor: ${missing.map((item) => item.agent).join(', ')}`);

    task.status = 'completed';
    task.phase = 'completed';
    task.updatedAt = now();
    task.meeting = {
      ...task.meeting,
      status: 'completed',
      reviewAt: now(),
      notes: 'Her ajan raporunu iletti; Lonca incelemeleri tamamlandı ve çıktılar Director tarafından birleştirildi.'
    };

    const healingNotes = task.selfHealingEvents?.length
      ? `\n\n🛡️ Oto-İyileştirme (Watchdog):\n${task.selfHealingEvents.map((e) => `- ${e.from} → ${e.to} (${e.reason})`).join('\n')}`
      : '';

    const reviewNotes = task.peerReviewEnabled
      ? `\n\n🏛️ Lonca İkili İnceleme (Peer Review):\n${task.assignments.map((x) => `- ${x.agent} ← İnceleyen: ${x.peerReview?.reviewerName || 'Ekip'} (${x.peerReview?.notes || 'Onaylandı'})`).join('\n')}`
      : '';

    task.finalReport = `Director özeti\n\nGörev: ${task.prompt}\n\nKatkılar:\n${task.assignments.map((x) => `- ${x.agent} (${x.role}): ${x.result}`).join('\n')}${reviewNotes}${healingNotes}\n\nSonuç: Ekip çıktıları derlendi ve Director onayından geçti.`;
    task.spokenSummary = `Görev tamamlandı. ${task.assignments.length} ajan katkı verdi.${task.selfHealingEvents?.length ? ' Watchdog arızaları düzeltti.' : ''} ${task.prompt}`;

    if (gamification) {
      for (const item of task.assignments) {
        await gamification.recordAssignmentCompleted(item.agentId, { kind: task.category?.kind }).catch(() => {});
      }
    }

    if (notifications) {
      notifications.notify({
        event: 'taskCompleted',
        title: 'Director Görevi Tamamlandı',
        body: task.spokenSummary,
        meta: { taskPrompt: task.prompt, agentCount: task.assignments.length }
      }).catch(() => {});
    }

    await save();
    return publicTask(task);
  }

  async function update(id, patch = {}) {
    const task = find(id);
    if (!task) throw new Error('Görev bulunamadı');
    Object.assign(task, patch, { updatedAt: now() });
    await save();
    return publicTask(task);
  }

  return {
    list: () => ({
      ok: true,
      tasks: state.tasks.map(publicTask),
      active: state.tasks.find((x) => !['completed', 'failed', 'cancelled'].includes(x.status))?.id || null,
      integration: { configured: Boolean(startTask) }
    }),
    get: (id) => {
      const task = find(id);
      return task ? publicTask(task) : null;
    },
    create,
    advance,
    receiveResult,
    reviewPeer,
    healAssignment,
    complete,
    collectResults,
    update,
    path: file
  };
}
