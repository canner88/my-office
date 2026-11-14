import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

const LEVELS = [
  { level: 1, minXp: 0, title: 'Çırak Ajan', icon: '🌱' },
  { level: 2, minXp: 200, title: 'Asistan Ajan', icon: '⚡' },
  { level: 3, minXp: 500, title: 'Uzman Ajan', icon: '🎯' },
  { level: 4, minXp: 1000, title: 'Kıdemli Ajan', icon: '🛡️' },
  { level: 5, minXp: 2000, title: 'Baş Danışman', icon: '👑' },
  { level: 6, minXp: 3500, title: 'Efsanevi Usta', icon: '🌟' }
];

export const BADGE_DEFS = {
  first_task: { id: 'first_task', name: 'İlk Görev', icon: '🎯', desc: 'İlk orkestrasyon görevini başarıyla tamamladı' },
  bug_hunter: { id: 'bug_hunter', name: 'Hata Avcısı', icon: '🛡️', desc: 'Kritik hata çözümü veya düzeltme sağladı' },
  guild_sage: { id: 'guild_sage', name: 'Lonca Bilgesi', icon: '🏛️', desc: 'Lonca masasında başarılı ikili inceleme (peer review) gerçekleştirdi' },
  self_healer: { id: 'self_healer', name: 'Zümrüdüanka', icon: '🔥', desc: 'Çöken bir görevi otomatik iyileştirerek kurtardı' },
  marathoner: { id: 'marathoner', name: 'Maratoncu', icon: '🏃', desc: '5 veya daha fazla görev tamamladı' }
};

export function createOpenBotGamification(dataDir) {
  const file = path.join(dataDir, 'openbot-gamification.json');
  let state = { version: 1, agents: {}, updatedAt: new Date().toISOString() };
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!state.agents) state.agents = {};
  } catch {}

  const save = async () => {
    await fsp.mkdir(dataDir, { recursive: true });
    state.updatedAt = new Date().toISOString();
    await fsp.writeFile(file, JSON.stringify(state, null, 2));
  };

  const getLevelInfo = (xp = 0) => {
    let current = LEVELS[0];
    for (const lvl of LEVELS) {
      if (xp >= lvl.minXp) current = lvl;
    }
    const nextIndex = LEVELS.indexOf(current) + 1;
    const next = LEVELS[nextIndex] || null;
    const nextMin = next ? next.minXp : current.minXp;
    const progress = next ? Math.min(100, Math.round(((xp - current.minXp) / (nextMin - current.minXp)) * 100)) : 100;
    return { ...current, nextLevelXp: nextMin, progress };
  };

  const getAgent = (agentId) => {
    if (!state.agents[agentId]) {
      state.agents[agentId] = {
        agentId,
        xp: 0,
        completedTasks: 0,
        peerReviews: 0,
        healedTasks: 0,
        badges: [],
        history: []
      };
    }
    return state.agents[agentId];
  };

  const checkBadges = (a) => {
    if (a.completedTasks >= 1 && !a.badges.includes('first_task')) a.badges.push('first_task');
    if (a.completedTasks >= 5 && !a.badges.includes('marathoner')) a.badges.push('marathoner');
    if (a.peerReviews >= 1 && !a.badges.includes('guild_sage')) a.badges.push('guild_sage');
    if (a.healedTasks >= 1 && !a.badges.includes('self_healer')) a.badges.push('self_healer');
  };

  const addXp = (agentId, amount, reason, meta = {}) => {
    const a = getAgent(agentId);
    a.xp = Math.max(0, (a.xp || 0) + amount);
    a.history.unshift({
      ts: new Date().toISOString(),
      amount,
      reason,
      ...meta
    });
    if (a.history.length > 30) a.history = a.history.slice(0, 30);
    checkBadges(a);
  };

  return {
    getStats: (agentId) => {
      const a = getAgent(agentId);
      const lvl = getLevelInfo(a.xp);
      return {
        ...a,
        level: lvl.level,
        levelTitle: lvl.title,
        levelIcon: lvl.icon,
        progress: lvl.progress,
        nextLevelXp: lvl.nextLevelXp,
        badgeDetails: a.badges.map((b) => BADGE_DEFS[b] || { id: b, name: b, icon: '⭐', desc: '' })
      };
    },
    getAllStats: (agentList = []) => {
      const list = agentList.length ? agentList : Object.keys(state.agents).map((id) => ({ id, name: id }));
      return list.map((ag) => {
        const id = ag.id || ag;
        const a = getAgent(id);
        const lvl = getLevelInfo(a.xp);
        return {
          agentId: id,
          name: ag.name || id,
          role: ag.role || '',
          room: ag.room || 'Çalışma',
          xp: a.xp,
          level: lvl.level,
          levelTitle: lvl.title,
          levelIcon: lvl.icon,
          progress: lvl.progress,
          nextLevelXp: lvl.nextLevelXp,
          completedTasks: a.completedTasks,
          peerReviews: a.peerReviews,
          healedTasks: a.healedTasks,
          badges: a.badges.map((b) => BADGE_DEFS[b] || { id: b, name: b, icon: '⭐', desc: '' })
        };
      }).sort((x, y) => y.xp - x.xp || String(x.name).localeCompare(String(y.name), 'tr'));
    },
    recordAssignmentCompleted: async (agentId, { kind = 'general' } = {}) => {
      const a = getAgent(agentId);
      a.completedTasks = (a.completedTasks || 0) + 1;
      let xpAmount = 150;
      if (kind === 'engineering') xpAmount = 180;
      addXp(agentId, xpAmount, 'Görev başarıyla tamamlandı', { kind });
      await save();
    },
    recordPeerReview: async (reviewerId, evaluatedId) => {
      const r = getAgent(reviewerId);
      r.peerReviews = (r.peerReviews || 0) + 1;
      addXp(reviewerId, 120, 'Lonca masasında ikili inceleme (Peer Review) yapıldı', { evaluatedId });
      addXp(evaluatedId, 50, 'Görevi Lonca incelemesinden geçti');
      await save();
    },
    recordSelfHealing: async (agentId, reason) => {
      const a = getAgent(agentId);
      a.healedTasks = (a.healedTasks || 0) + 1;
      addXp(agentId, 100, `Oto-iyileştirme (Watchdog) ile görev devralındı (${reason})`);
      await save();
    },
    save,
    path: file
  };
}
