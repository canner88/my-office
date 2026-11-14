'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, type FormEvent } from 'react';

type Task = { id: string; title: string; agent: string; updatedAt: string; error: string };
type Agent = { id: string; name: string; role: string; status: string; settings: AgentSettings };
type AgentSettings = { displayName?: string; title?: string; room?: string; priority?: number; enabled?: boolean; model?: string; provider?: string; temperature?: number; maxTurns?: number; permissions?: Record<string, string> };
type Model = { provider: string; model: string; size?: string; free?: boolean; local?: boolean };
type NotificationsConfig = {
  enabled: boolean;
  webhookUrl: string;
  telegramBotToken: string;
  telegramChatId: string;
  events: { taskCompleted: boolean; taskFailed: boolean; selfHealing: boolean; approvalNeeded: boolean };
};
type Settings = {
  office: {
    refreshSeconds: number;
    theme: string;
    density: string;
    showPerformance: boolean;
    showBoard: boolean;
    showWaits: boolean;
    desktopNotifications: boolean;
    nightMode: string;
    autoRefresh: boolean;
    autoAssignModels?: boolean;
    notifications?: NotificationsConfig;
  };
  modelRouting: Record<string, { provider: string; model: string }>;
  agents: Record<string, AgentSettings>;
};
type Overview = {
  generatedAt: string;
  board: Record<'todo' | 'doing' | 'done' | 'blocked', Task[]>;
  daily: { turns: number; completed: number; failed: number; running: number };
  performance: { id: string; name: string; completed: number; avgSeconds: number | null; lastCompleted: string | null }[];
  waits: { id: string; agent: string; note: string; createdAt: string }[];
};
type TickerItem = {
  id: string;
  agentId: string;
  agentName: string;
  role: string;
  author: string;
  itemType: string;
  text: string;
  createdAt: string;
};
type GamificationStats = {
  agentId: string;
  name: string;
  role: string;
  room?: string;
  xp: number;
  level: number;
  levelTitle: string;
  levelIcon: string;
  progress: number;
  nextLevelXp: number;
  completedTasks: number;
  peerReviews: number;
  healedTasks: number;
  badges: { id: string; name: string; icon: string; desc: string }[];
};
type OrchestrationTask = {
  id: string;
  prompt: string;
  status: string;
  phase: string;
  category?: { kind?: string; label?: string; room?: string; station?: string };
  createdAt?: string;
  updatedAt?: string;
  peerReviewEnabled?: boolean;
  peerReviewCompleted?: boolean;
  selfHealingEvents?: { ts: string; assignmentId: string; from: string; to: string; reason: string }[];
  executionPlan?: { id: string; label: string; dependsOn: string[]; status: string }[];
  decisionLog?: { at: string; type: string; agent?: string; model?: string; reason?: string; label?: string }[];
  assignments: {
    id: string;
    agentId: string;
    agent: string;
    role: string;
    room?: string;
    zone?: string;
    workStation?: string;
    dispatch?: string;
    status: string;
    result: string;
    startedAt?: string;
    finishedAt?: string | null;
    stageId?: string | null;
    peerReview?: { reviewerName: string; status: string; notes: string };
    healed?: boolean;
    originalAgent?: string;
    healingReason?: string;
  }[];
  finalReport?: string;
};

const columns = [['todo', 'Sırada'], ['doing', 'Çalışıyor'], ['done', 'Tamamlandı'], ['blocked', 'Engelli']] as const;
const rooms = ['Çalışma', 'Yönetim', 'Mesaj', 'Kod'];
const routeKinds = [['engineering', 'Kod ve test'], ['research', 'Araştırma'], ['communications', 'Mesaj ve destek'], ['design', 'Tasarım'], ['operations', 'Operasyon'], ['general', 'Genel görev']] as const;
const permissionKeys = [['read', 'Okuma'], ['write', 'Yazma'], ['execute', 'Komut'], ['network', 'Ağ'], ['messaging', 'Mesaj']] as const;
const duration = (value: number | null) => value == null ? '—' : value < 60 ? `${value} sn` : `${Math.round(value / 60)} dk`;
const stageStatusLabel = (status: string) => status === 'completed' ? 'Tamamlandı' : status === 'working' ? 'Çalışıyor' : status === 'queued' ? 'Bekliyor' : status === 'blocked' ? 'Bloklu' : status;

const postSettings = async (body: object) => {
  const response = await fetch('/api/openbot/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  if (!response.ok || !result.ok) throw new Error(result.message || 'Ayar kaydedilemedi.');
  return result.settings as Settings;
};

export default function OpenBotDashboard() {
  const [data, setData] = useState<Overview | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<Model[]>([]);
  const [tickerItems, setTickerItems] = useState<TickerItem[]>([]);
  const [gamification, setGamification] = useState<GamificationStats[]>([]);
  const [orchestrationTasks, setOrchestrationTasks] = useState<OrchestrationTask[]>([]);
  const [selected, setSelected] = useState<Agent | null>(null);
  const [tab, setTab] = useState<'overview' | 'operations' | 'ticker' | 'commands' | 'gamification' | 'agents' | 'models' | 'office'>('overview');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  const [commandResult, setCommandResult] = useState('');

  const load = async () => {
    try {
      const [overviewRes, settingsRes, modelRes, tickerRes, gamificationRes, orchRes] = await Promise.all([
        fetch('/api/openbot/overview', { cache: 'no-store' }),
        fetch('/api/openbot/settings', { cache: 'no-store' }),
        fetch('/api/openbot/models', { cache: 'no-store' }),
        fetch('/api/openbot/ticker', { cache: 'no-store' }),
        fetch('/api/openbot/gamification', { cache: 'no-store' }),
        fetch('/api/openbot/orchestration', { cache: 'no-store' })
      ]);
      if (!overviewRes.ok || !settingsRes.ok) throw new Error('OpenBot verisi şu anda okunamıyor.');
      const overview = await overviewRes.json();
      const config = await settingsRes.json();
      const modelConfig = await modelRes.json().catch(() => ({ models: [] }));
      const tickerData = await tickerRes.json().catch(() => ({ items: [] }));
      const gamificationData = await gamificationRes.json().catch(() => ({ stats: [] }));
      const orchData = await orchRes.json().catch(() => ({ tasks: [] }));

      setData(overview);
      setSettings(config.settings);
      setAgents(config.agents || []);
      setModels(modelConfig.models || []);
      setTickerItems(tickerData.items || []);
      setGamification(gamificationData.stats || []);
      setOrchestrationTasks(orchData.tasks || []);
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Bağlantı kurulamadı.');
    }
  };

  useEffect(() => {
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    const validTabs = ['overview', 'operations', 'ticker', 'commands', 'gamification', 'agents', 'models', 'office'] as const;
    if (requestedTab && (validTabs as readonly string[]).includes(requestedTab)) setTab(requestedTab as typeof tab);
    load();
    const interval = tab === 'ticker' ? 3000 : (settings?.office.refreshSeconds || 30) * 1000;
    const timer = window.setInterval(load, interval);
    return () => window.clearInterval(timer);
  }, [tab, settings?.office.refreshSeconds]);

  const selectedSettings = selected ? { ...selected.settings } : null;
  const enabledCount = useMemo(() => agents.filter((agent) => agent.settings.enabled !== false).length, [agents]);

  const saveOffice = async (values: Partial<Settings['office']>) => {
    try {
      const next = await postSettings({ scope: 'office', values });
      setSettings(next);
      setSaved('Ofis ayarları kaydedildi');
      setTimeout(() => setSaved(''), 2200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kaydedilemedi.');
    }
  };

  const saveRouting = async (values: Settings['modelRouting']) => {
    try {
      const next = await postSettings({ scope: 'model-routing', values });
      setSettings(next);
      setSaved('Model yönlendirme kuralları kaydedildi');
      setTimeout(() => setSaved(''), 2200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kaydedilemedi.');
    }
  };

  const saveAgent = async (id: string, values: AgentSettings) => {
    try {
      const next = await postSettings({ scope: 'agent', id, values });
      setSettings(next);
      await load();
      setSelected(null);
      setSaved('Bot ayarları kaydedildi');
      setTimeout(() => setSaved(''), 2200);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Kaydedilemedi.');
    }
  };

  const approvePeerReview = async (taskId: string, assignmentId: string) => {
    try {
      const res = await fetch('/api/openbot/orchestration', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ op: 'peer_review', id: taskId, assignmentId, review: { status: 'approved', notes: 'Kullanıcı/Director panelinden onaylandı' } })
      });
      if (res.ok) {
        setSaved('Lonca incelemesi onaylandı');
        setTimeout(() => setSaved(''), 2200);
        await load();
      }
    } catch {
      setError('İnceleme onaylanamadı.');
    }
  };

  const sendDirectCommand = async (agentId: string, text: string) => {
    const response = await fetch('/api/openbot/commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId, text })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.message || 'Emir gönderilemedi.');
    setCommandResult(`${result.agent?.name || 'Bot'} emri aldı${result.taskId ? ` · görev ${result.taskId}` : ''}.`);
    await load();
  };

  return (
    <main className="ob-dashboard" data-theme={settings?.office.theme || 'midnight'} data-density={settings?.office.density || 'comfortable'}>
      <header className="ob-header">
        <Link href="/" className="ob-back">← Ofise dön</Link>
        <div>
          <h1>OpenBot kontrol merkezi</h1>
          <p>Gerçek zamanlı düşünce akışı · Lonca incelemesi · Oto-iyileştirme · Seviye & rozetler</p>
        </div>
        <a href="/api/openbot/settings" className="ob-refresh">Ayar JSON</a>
      </header>

      <nav className="ob-tabs" aria-label="Panel bölümleri">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Genel bakış</button>
        <button className={tab === 'operations' ? 'active' : ''} onClick={() => setTab('operations')}>Operasyon merkezi</button>
        <button className={tab === 'ticker' ? 'active' : ''} onClick={() => setTab('ticker')}>
          Canlı Akış (Ticker) <span>{tickerItems.length}</span>
        </button>
        <button className={tab === 'commands' ? 'active' : ''} onClick={() => setTab('commands')}>Doğrudan emir</button>
        <button className={tab === 'gamification' ? 'active' : ''} onClick={() => setTab('gamification')}>
          Lonca & Başarımlar (XP) <span>{gamification.length}</span>
        </button>
        <button className={tab === 'agents' ? 'active' : ''} onClick={() => setTab('agents')}>
          Bot ayarları <span>{enabledCount}/{agents.length}</span>
        </button>
        <button className={tab === 'models' ? 'active' : ''} onClick={() => setTab('models')}>
          Model yönlendirme <span>{models.length}</span>
        </button>
        <button className={tab === 'office' ? 'active' : ''} onClick={() => setTab('office')}>Ofis ayarları</button>
      </nav>

      {error && <p className="ob-error ob-alert" role="status">{error}</p>}
      {saved && <p className="ob-saved" role="status">✓ {saved}</p>}

      {data && tab === 'overview' && (
        <>
          <CommandCenter data={data} orchestrationTasks={orchestrationTasks} agents={agents} onOpen={(nextTab) => setTab(nextTab)} />
          <section className="ob-summary" aria-label="Son 24 saat özeti">
            <article><span>Son 24 saatte tur</span><b>{data.daily.turns}</b></article>
            <article><span>Tamamlanan</span><b>{data.daily.completed}</b></article>
            <article><span>Başarısız / kesilen</span><b>{data.daily.failed}</b></article>
            <article><span>Şu an çalışan</span><b>{data.daily.running}</b></article>
          </section>

          {tickerItems.length > 0 && (
            <section className="ob-section ob-live-strip">
              <div className="ob-section-heading">
                <div>
                  <h2>Canlı olay akışı</h2>
                  <p className="ob-note">Son ajan hareketleri ve Director kararları.</p>
                </div>
                <button className="ob-secondary" onClick={() => setTab('ticker')}>Tüm akışı aç →</button>
              </div>
              <div className="ob-live-events">
                {tickerItems.slice(0, 4).map((item) => (
                  <article className="ob-live-event" key={item.id}>
                    <span className="ob-live-pulse" />
                    <div><b>{item.agentName}</b><small>{item.text}</small></div>
                    <time>{new Date(item.createdAt).toLocaleTimeString()}</time>
                  </article>
                ))}
              </div>
            </section>
          )}

          {/* Active Orchestration / Lonca & Watchdog Highlights */}
          {orchestrationTasks.some((t) => t.status !== 'completed') && (
            <section className="ob-section ob-orch-live">
              <h2>🏛️ Canlı Lonca & Director Görev Masası</h2>
              <div className="ob-orch-grid">
                {orchestrationTasks.filter((t) => t.status !== 'completed').map((task) => (
                  <article key={task.id} className="ob-orch-card">
                    <div className="ob-orch-header">
                      <b>{task.prompt}</b>
                      <span className={`ob-phase-badge ${task.phase}`}>
                        {task.phase === 'peer_review' ? '🏛️ Lonca İkili İnceleme' : task.phase === 'working' ? '⚡ Çalışıyor' : task.phase}
                      </span>
                    </div>
                    {task.selfHealingEvents && task.selfHealingEvents.length > 0 && (
                      <div className="ob-healing-alert">
                        🛡️ <strong>Oto-İyileştirme Devrede:</strong> {task.selfHealingEvents.map((e) => `${e.from} → ${e.to} (${e.reason})`).join(', ')}
                      </div>
                    )}
                    {task.executionPlan && task.executionPlan.length > 0 && <DependencyGraph stages={task.executionPlan} />}
                    <div className="ob-orch-assigns">
                      {task.assignments.map((item) => (
                        <div key={item.id} className="ob-assign-row">
                          <span className="ob-assign-name">
                            {item.healed && <em title={`Oto-iyileştirildi (${item.originalAgent}'dan devralındı)`}>🔥 </em>}
                            {item.agent} ({item.role})
                          </span>
                          <span className={`ob-assign-status ${item.status}`}>{item.status}</span>
                          {task.phase === 'peer_review' && item.peerReview && (
                            <div className="ob-peer-box">
                              <small>İnceleyen: <b>{item.peerReview.reviewerName}</b> ({item.peerReview.status})</small>
                              {item.peerReview.status === 'pending' && (
                                <button className="ob-small-btn" onClick={() => approvePeerReview(task.id, item.id)}>Onayla</button>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                    {task.decisionLog && task.decisionLog.length > 0 && (
                      <details className="ob-note">
                        <summary>Director karar günlüğü ({task.decisionLog.length})</summary>
                        {task.decisionLog.slice(-5).map((entry, index) => (
                          <div key={`${entry.at}-${index}`}>{entry.agent || entry.model || entry.label || entry.type}: {entry.reason || 'Karar kaydedildi.'}</div>
                        ))}
                      </details>
                    )}
                  </article>
                ))}
              </div>
            </section>
          )}

          {settings?.office.showBoard && (
            <section className="ob-section">
              <h2>Görev panosu</h2>
              <div className="ob-board">
                {columns.map(([key, title]) => (
                  <article className="ob-column" key={key}>
                    <h3>{title}<span>{data.board[key].length}</span></h3>
                    {data.board[key].length === 0 && <p className="ob-empty">Kayıt yok</p>}
                    {data.board[key].map((task) => (
                      <div className="ob-task" key={task.id}>
                        <b>{task.title || 'Başlıksız görev'}</b>
                        <small>{task.agent} · {new Date(task.updatedAt).toLocaleString()}</small>
                        {task.error && <small className="ob-error">{task.error}</small>}
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            </section>
          )}

          <div className="ob-lower">
            {settings?.office.showPerformance && (
              <section className="ob-section">
                <h2>Ajan performansı</h2>
                <div className="ob-table-wrap">
                  <table>
                    <thead>
                      <tr><th>Ajan</th><th>Biten tur</th><th>Ort. süre</th><th>Son tamamlanan</th></tr>
                    </thead>
                    <tbody>
                      {data.performance.map((agent) => (
                        <tr key={agent.id}>
                          <td>{agent.name}</td>
                          <td>{agent.completed}</td>
                          <td>{duration(agent.avgSeconds)}</td>
                          <td>{agent.lastCompleted ? new Date(agent.lastCompleted).toLocaleString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {settings?.office.showWaits && (
              <section className="ob-section">
                <h2>Bekleyenler <span className="ob-count">{data.waits.length}</span></h2>
                <p className="ob-note">Bekleme kayıtları burada görünür; güvenli onay akışı ayrı tutulur.</p>
                {data.waits.length === 0 ? (
                  <p className="ob-empty">Bekleyen kayıt yok</p>
                ) : (
                  data.waits.map((wait) => (
                    <article className="ob-wait" key={wait.id}>
                      <b>{wait.agent}</b>
                      <p>{wait.note || 'Yanıt bekliyor'}</p>
                      <small>{new Date(wait.createdAt).toLocaleString()}</small>
                    </article>
                  ))
                )}
              </section>
            )}
          </div>

          <section className="ob-section ob-cycle">
            <h2>Canlı sistem</h2>
            <div className="ob-health-grid">
              <span>Aktif bot <b>{enabledCount}</b></span>
              <span>Yenileme <b>{settings?.office.autoRefresh ? `${settings.office.refreshSeconds} sn` : 'kapalı'}</b></span>
              <span>Görünüm <b>{settings?.office.theme}</b></span>
              <span>Gece modu <b>{settings?.office.nightMode}</b></span>
            </div>
          </section>
          <footer>Son veri yenilemesi: {new Date(data.generatedAt).toLocaleTimeString()}</footer>
        </>
      )}

      {tab === 'commands' && (
        <DirectCommandPanel agents={agents} result={commandResult} onSend={sendDirectCommand} />
      )}

      {tab === 'operations' && settings && data && (
        <OperationsCenter
          data={data}
          agents={agents}
          gamification={gamification}
          tickerItems={tickerItems}
          orchestrationTasks={orchestrationTasks}
          office={settings.office}
          onModeChange={(values) => saveOffice(values)}
          onApprove={approvePeerReview}
        />
      )}

      {/* Feature 1: Live Thought Ticker */}
      {tab === 'ticker' && (
        <LiveTicker items={tickerItems} onRefresh={load} />
      )}

      {/* Feature 5: Gamification & Badges */}
      {tab === 'gamification' && (
        <GamificationLeaderboard stats={gamification} />
      )}

      {tab === 'agents' && (
        <section className="ob-section">
          <div className="ob-section-heading">
            <div>
              <h2>Bot ayarları</h2>
              <p className="ob-note">Her bot için kimlik, oda, model, çalışma sınırı ve izin seviyesi.</p>
            </div>
            <button className="ob-secondary" onClick={() => postSettings({ scope: 'reset-all' }).then(load)}>Tümünü sıfırla</button>
          </div>
          <div className="ob-agent-grid">
            {agents.map((agent) => (
              <button className="ob-agent-card" key={agent.id} onClick={() => setSelected(agent)}>
                <span className={`ob-status-dot ${agent.status}`} />
                <strong>{agent.settings.displayName || agent.name}</strong>
                <small>{agent.settings.title || agent.role || 'Genel ajan'}</small>
                <em>{agent.settings.room || 'Otomatik oda'} · {agent.settings.model || 'Varsayılan model'}</em>
                <span className="ob-agent-edit">Düzenle →</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === 'models' && settings && (
        <ModelRouting
          settings={settings}
          models={models}
          onSave={saveRouting}
          onToggle={(autoAssignModels) => saveOffice({ autoAssignModels })}
        />
      )}

      {tab === 'office' && settings && (
        <OfficeSettings
          settings={settings.office}
          onSave={saveOffice}
        />
      )}

      {selected && selectedSettings && (
        <AgentEditor
          agent={selected}
          initial={selectedSettings}
          onCancel={() => setSelected(null)}
          onSave={(values) => saveAgent(selected.id, values)}
        />
      )}
    </main>
  );
}

function OperationsCenter({
  data,
  agents,
  gamification,
  tickerItems,
  orchestrationTasks,
  office,
  onModeChange,
  onApprove
}: {
  data: Overview;
  agents: Agent[];
  gamification: GamificationStats[];
  tickerItems: TickerItem[];
  orchestrationTasks: OrchestrationTask[];
  office: Settings['office'];
  onModeChange: (values: Partial<Settings['office']>) => void;
  onApprove: (taskId: string, assignmentId: string) => void;
}) {
  const statsByAgent = useMemo(() => new Map(gamification.map((item) => [item.agentId, item])), [gamification]);
  const roomRows = useMemo(() => rooms.map((room) => {
    const people = agents.filter((agent) => (agent.settings.room || 'Çalışma') === room).length;
    const assignments = orchestrationTasks.flatMap((task) => task.assignments || []).filter((item) => item.room === room && item.status !== 'completed').length;
    return { room, people, assignments, total: people + assignments };
  }), [agents, orchestrationTasks]);
  const timeline = useMemo(() => [
    ...tickerItems.slice(0, 12).map((item) => ({ id: item.id, title: item.agentName, text: item.text, at: item.createdAt, kind: item.itemType })),
    ...orchestrationTasks.slice(0, 8).map((task) => ({ id: `task-${task.id}`, title: 'Director', text: `${task.category?.label || 'Görev'} · ${task.prompt}`, at: task.updatedAt || task.createdAt || new Date().toISOString(), kind: task.phase }))
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()).slice(0, 12), [tickerItems, orchestrationTasks]);
  const queue = useMemo(() => orchestrationTasks.filter((task) => task.status !== 'completed').sort((a, b) => {
    const rank = (item: OrchestrationTask) => item.status === 'failed' || item.phase === 'blocked' ? 4 : item.phase === 'working' ? 3 : item.phase === 'peer_review' ? 2 : 1;
    return rank(b) - rank(a);
  }), [orchestrationTasks]);
  const approvals = orchestrationTasks.flatMap((task) => (task.assignments || []).filter((item) => item.peerReview?.status === 'pending').map((item) => ({ task, item })));
  const recoveries = orchestrationTasks.flatMap((task) => (task.selfHealingEvents || []).map((event) => ({ ...event, task: task.prompt })));

  return (
    <section className="ob-operations">
      <div className="ob-section ob-operations-hero">
        <span className="ob-eyebrow">OPENBOT OPERASYON MERKEZİ</span>
        <h2>Zaman, yetenek ve görev akışı tek görünümde</h2>
        <p className="ob-note">Türkçe arayüz aktif. Director kararları, oda yoğunluğu ve ajan durumları canlı veriden hesaplanır.</p>
        <div className="ob-mode-row">
          <b>Çalışma modu</b>
          {([['comfortable', 'Normal', 'auto'], ['focus', 'Odak', 'day'], ['compact', 'Yoğun', 'day'], ['comfortable', 'Gece', 'night']] as const).map(([density, label, nightMode]) => (
            <button key={`${density}-${nightMode}`} className={office.density === density && office.nightMode === nightMode ? 'ob-mode active' : 'ob-mode'} onClick={() => onModeChange({ density, nightMode })}>{label}</button>
          ))}
        </div>
      </div>

      <div className="ob-ops-grid">
        <section className="ob-section">
          <div className="ob-section-heading"><div><h2>Görev zaman çizelgesi</h2><p className="ob-note">Son kararlar, raporlar ve ajan hareketleri.</p></div></div>
          <div className="ob-timeline">
            {timeline.length === 0 ? <p className="ob-empty">Henüz zaman çizelgesi verisi yok.</p> : timeline.map((item) => <article key={item.id} className="ob-timeline-item"><span className="ob-live-pulse" /><div><b>{item.title}</b><p>{item.text}</p></div><time>{new Date(item.at).toLocaleTimeString()}</time></article>)}
          </div>
        </section>

        <section className="ob-section">
          <h2>Oda yoğunluğu</h2>
          <p className="ob-note">Ajan ve aktif görevlerin işlevsel bölgelere dağılımı.</p>
          <div className="ob-room-load">{roomRows.map((row) => <div className="ob-room-row" key={row.room}><div><b>{row.room}</b><small>{row.people} ajan · {row.assignments} görev</small></div><span><i style={{ width: `${Math.min(100, row.total * 18 + 4)}%` }} /></span></div>)}</div>
        </section>
      </div>

      <section className="ob-section">
        <div className="ob-section-heading"><div><h2>Ajan yetenek kartları</h2><p className="ob-note">Rol, model, oda ve başarı geçmişine göre hızlı seçim.</p></div></div>
        <div className="ob-capability-grid">{agents.slice(0, 12).map((agent) => { const stat = statsByAgent.get(agent.id); return <article className="ob-capability-card" key={agent.id}><div className="ob-capability-head"><span className={`ob-status-dot ${agent.status}`} /><b>{agent.settings.displayName || agent.name}</b><span className="ob-priority">Öncelik {agent.settings.priority ?? 50}</span></div><p>{agent.settings.title || agent.role || 'Genel ajan'}</p><small>{agent.settings.room || 'Çalışma'} · {agent.settings.model || 'Varsayılan model'}</small><div className="ob-capability-stats"><span>{stat?.completedTasks || 0} tamamlanan</span><span>Seviye {stat?.level || 1}</span></div></article>; })}</div>
      </section>

      <div className="ob-ops-grid">
        <section className="ob-section"><h2>Öncelik kuyruğu</h2><p className="ob-note">Bloklu ve çalışan işler otomatik öne çıkarılır.</p>{queue.length === 0 ? <p className="ob-empty">Aktif görev yok.</p> : queue.slice(0, 8).map((task) => <div className="ob-queue-row" key={task.id}><span className={`ob-priority-dot ${task.phase}`} /><div><b>{task.prompt}</b><small>{task.category?.label || task.phase}</small></div><strong>{task.phase === 'blocked' ? 'Kritik' : task.phase === 'working' ? 'Yüksek' : 'Normal'}</strong></div>)}</section>
        <section className="ob-section"><h2>Director onay kuyruğu <span className="ob-count">{approvals.length}</span></h2>{approvals.length === 0 ? <p className="ob-empty">Bekleyen inceleme yok.</p> : approvals.map(({ task, item }) => <div className="ob-approval-row" key={`${task.id}-${item.id}`}><div><b>{item.agent}</b><small>{task.prompt}</small></div><button className="ob-small-btn" onClick={() => onApprove(task.id, item.id)}>Onayla</button></div>)}</section>
      </div>

      <div className="ob-ops-grid">
        <section className="ob-section"><h2>Görev bağımlılıkları</h2>{orchestrationTasks.filter((task) => task.executionPlan?.length).slice(0, 4).map((task) => <div key={task.id}><b>{task.prompt}</b><DependencyGraph stages={task.executionPlan || []} /></div>)}{!orchestrationTasks.some((task) => task.executionPlan?.length) && <p className="ob-empty">Bağımlılık grafiği oluşturulmuş görev yok.</p>}</section>
        <section className="ob-section"><h2>Hata ve kurtarma geçmişi</h2>{recoveries.length === 0 ? <p className="ob-empty">Kurtarma olayı yok.</p> : recoveries.slice(0, 8).map((event, index) => <div className="ob-recovery-row" key={`${event.ts}-${index}`}><b>🛡️ {event.from} → {event.to}</b><small>{event.reason} · {new Date(event.ts).toLocaleString()}</small></div>)}</section>
      </div>
    </section>
  );
}

function CommandCenter({
  data,
  orchestrationTasks,
  agents,
  onOpen
}: {
  data: Overview;
  orchestrationTasks: OrchestrationTask[];
  agents: Agent[];
  onOpen: (tab: 'ticker' | 'agents' | 'models') => void;
}) {
  const activeTasks = orchestrationTasks.filter((task) => task.status !== 'completed');
  const activeAgents = agents.filter((agent) => agent.status === 'work' || agent.status === 'working');
  const blockedTasks = data.board.blocked.length;
  const health = blockedTasks === 0 && data.daily.failed === 0 ? 'Stabil' : blockedTasks > 0 ? 'Dikkat gerekiyor' : 'İzleniyor';

  return (
    <section className="ob-command-center" aria-label="Komuta merkezi">
      <div className="ob-command-copy">
        <span className="ob-eyebrow">OPENBOT OPERASYON MERKEZİ</span>
        <h2>Ofis şu an <strong>{health.toLowerCase()}</strong></h2>
        <p>{activeTasks.length ? `${activeTasks.length} orkestrasyon görevi Director tarafından izleniyor.` : 'Aktif orkestrasyon görevi yok; yeni görevler için Director hazır.'}</p>
      </div>
      <div className="ob-command-metrics">
        <button onClick={() => onOpen('ticker')}><b>{data.daily.running}</b><span>Çalışan tur</span></button>
        <button onClick={() => onOpen('agents')}><b>{activeAgents.length}</b><span>Aktif ajan</span></button>
        <button onClick={() => onOpen('models')}><b>{blockedTasks}</b><span>Bloklu görev</span></button>
      </div>
      <div className="ob-command-status"><span className="ob-live-pulse" /> Veri akışı canlı · {new Date(data.generatedAt).toLocaleTimeString()}</div>
    </section>
  );
}

function DependencyGraph({ stages }: { stages: { id: string; label: string; dependsOn: string[]; status: string }[] }) {
  return (
    <div className="ob-dependency-graph" aria-label="Görev aşama grafiği">
      <div className="ob-graph-label">Bağımlılık akışı</div>
      <div className="ob-graph-track">
        {stages.map((stage, index) => (
          <div className="ob-graph-step-wrap" key={stage.id}>
            {index > 0 && <span className="ob-graph-arrow" aria-hidden="true">→</span>}
            <div className={`ob-graph-step ${stage.status}`}>
              <span>{index + 1}</span>
              <div><b>{stage.label}</b><small>{stageStatusLabel(stage.status)}</small></div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DirectCommandPanel({
  agents,
  result,
  onSend
}: {
  agents: Agent[];
  result: string;
  onSend: (agentId: string, text: string) => Promise<void>;
}) {
  const available = agents.filter((agent) => agent.settings.enabled !== false);
  const [agentId, setAgentId] = useState('');
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [localError, setLocalError] = useState('');
  const templates = [
    ['Durum raporu', 'Mevcut görevin durumunu, risklerini ve sıradaki adımı kısa raporla.'],
    ['Hata avı', 'Son çıktıyı incele, olası hataları bul ve önem sırasına göre düzeltme öner.'],
    ['Araştırma', 'Bu konuyu güvenilir kaynaklarla araştır ve Director için maddeli özet hazırla.'],
    ['Teslim kontrolü', 'Görevi tamamlamadan önce çıktıyı doğrula, eksikleri ve test sonucunu raporla.']
  ] as const;

  useEffect(() => {
    if (!agentId && available[0]) setAgentId(available[0].id);
  }, [agentId, available]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!agentId || !text.trim() || sending) return;
    setSending(true);
    setLocalError('');
    try {
      await onSend(agentId, text.trim());
      setText('');
    } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : 'Emir gönderilemedi.');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="ob-section ob-command-panel">
      <div className="ob-section-heading">
        <div>
          <span className="ob-eyebrow">DIRECTOR KUMANDASI</span>
          <h2>Bir bota doğrudan emir ver</h2>
          <p className="ob-note">Emir, seçtiğin botun OpenBot konuşmasına gönderilir; Director orkestrasyonuna bağlı yeni bir görev açmaz.</p>
        </div>
      </div>
      <form className="ob-command-form" onSubmit={submit}>
        <label>
          Bot
          <select value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={sending || available.length === 0}>
            {available.length === 0 && <option value="">Aktif bot yok</option>}
            {available.map((agent) => <option value={agent.id} key={agent.id}>{agent.settings.displayName || agent.name} · {agent.role || 'Genel ajan'}</option>)}
          </select>
        </label>
        <label className="ob-command-text">
          Emir
          <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={4000} rows={5} placeholder="Örn. Bu görevin mevcut durumunu incele ve yalnızca riskleri raporla." disabled={sending || available.length === 0} />
          <small>{text.length}/4000</small>
        </label>
        <div className="ob-template-row"><span>Hazır şablonlar</span>{templates.map(([label, value]) => <button type="button" className="ob-template" key={label} onClick={() => setText(value)} disabled={sending || available.length === 0}>{label}</button>)}</div>
        <div className="ob-command-actions">
          <button className="ob-primary" type="submit" disabled={sending || !agentId || !text.trim()}>{sending ? 'Gönderiliyor…' : 'Emri gönder'}</button>
          <span className="ob-note">Mesaj, yerel OpenBot otomasyon bağlantısı üzerinden iletilir.</span>
        </div>
      </form>
      {(result || localError) && <p className={localError ? 'ob-error ob-alert' : 'ob-saved'} role="status">{localError || `✓ ${result}`}</p>}
    </section>
  );
}

function LiveTicker({ items, onRefresh }: { items: TickerItem[]; onRefresh: () => void }) {
  const [filterAgent, setFilterAgent] = useState('');
  const agentNames = useMemo(() => Array.from(new Set(items.map((i) => i.agentName))).sort(), [items]);
  const filtered = useMemo(() => filterAgent ? items.filter((i) => i.agentName === filterAgent) : items, [items, filterAgent]);

  const itemBadge = (type: string) => {
    switch (type) {
      case 'commentary': return <span className="ob-chip-thought">🧠 Düşünce</span>;
      case 'final_answer': return <span className="ob-chip-answer">💬 Yanıt</span>;
      case 'plan': return <span className="ob-chip-plan">📋 Plan</span>;
      case 'agent-exchange': return <span className="ob-chip-agent">🤝 İletişim</span>;
      default: return <span className="ob-chip-default">{type}</span>;
    }
  };

  return (
    <section className="ob-section">
      <div className="ob-section-heading">
        <div>
          <h2>Canlı Düşünce ve Eylem Akışı (Live Ticker)</h2>
          <p className="ob-note">Ajanların arka planda ürettiği anlık akıl yürütmeler, kararlar ve araç eylemleri.</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          <select value={filterAgent} onChange={(e) => setFilterAgent(e.target.value)} style={{ padding: '6px 10px', background: '#101722', color: '#eef5ff', border: '1px solid #344356', borderRadius: '7px' }}>
            <option value="">Tüm Ajanlar ({items.length})</option>
            {agentNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <button className="ob-secondary" onClick={onRefresh}>Yenile</button>
        </div>
      </div>
      <div className="ob-ticker-stream">
        {filtered.length === 0 ? (
          <p className="ob-empty">Akışta henüz kayıtlı düşünce bulunmuyor.</p>
        ) : (
          filtered.map((item) => (
            <article key={item.id} className="ob-ticker-card">
              <div className="ob-ticker-meta">
                <span className="ob-ticker-agent"><strong>{item.agentName}</strong> {item.role && <small>({item.role})</small>}</span>
                {itemBadge(item.itemType)}
                <time className="ob-ticker-time">{new Date(item.createdAt).toLocaleTimeString()}</time>
              </div>
              <p className="ob-ticker-text">{item.text}</p>
            </article>
          ))
        )}
      </div>
    </section>
  );
}

function GamificationLeaderboard({ stats }: { stats: GamificationStats[] }) {
  return (
    <section className="ob-section">
      <div className="ob-section-heading">
        <div>
          <h2>Lonca Ajan Seviyeleri ve Başarımlar (Gamification & XP)</h2>
          <p className="ob-note">Başarılı görevler, Lonca ikili incelemeleri (Peer Review) ve oto-iyileştirme ile kazanılan unvanlar.</p>
        </div>
      </div>
      <div className="ob-gamification-grid">
        {stats.map((a) => (
          <article key={a.agentId} className="ob-xp-card">
            <div className="ob-xp-top">
              <div className="ob-xp-title-wrap">
                <span className="ob-lvl-icon">{a.levelIcon}</span>
                <div>
                  <strong>{a.name}</strong>
                  <span className="ob-lvl-badge">Lv {a.level} · {a.levelTitle}</span>
                </div>
              </div>
              <div className="ob-xp-count"><b>{a.xp}</b> <small>XP</small></div>
            </div>
            <div className="ob-progress-bar">
              <div className="ob-progress-fill" style={{ width: `${a.progress}%` }} />
            </div>
            <div className="ob-xp-metrics">
              <span>🎯 Görev: <b>{a.completedTasks}</b></span>
              <span>🏛️ İnceleme: <b>{a.peerReviews}</b></span>
              <span>🔥 Kurtarma: <b>{a.healedTasks}</b></span>
            </div>
            <div className="ob-badges-row">
              {a.badges.map((b) => (
                <span key={b.id} className="ob-badge-chip" title={`${b.name}: ${b.desc}`}>
                  <i>{b.icon}</i> {b.name}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function ModelRouting({ settings, models, onSave, onToggle }: { settings: Settings; models: Model[]; onSave: (values: Settings['modelRouting']) => void; onToggle: (enabled: boolean) => void }) {
  const [routing, setRouting] = useState(settings.modelRouting || {});
  useEffect(() => setRouting(settings.modelRouting || {}), [settings.modelRouting]);
  const choose = (kind: string, model: string) => setRouting((current) => ({ ...current, [kind]: { provider: 'opencode', model } }));
  return (
    <section className="ob-section ob-settings">
      <div className="ob-section-heading">
        <div>
          <h2>Director model yönlendirme</h2>
          <p className="ob-note">Ücretsiz yerel modelleri görev türüne göre otomatik seçer ve görev gönderirken ilgili ajana uygular.</p>
        </div>
        <label className="ob-switch">
          <input type="checkbox" checked={settings.office.autoAssignModels !== false} onChange={(event) => onToggle(event.target.checked)} /> Otomatik atama
        </label>
      </div>
      <div className="ob-model-catalog">
        <b>Çalışan yerel modeller</b>
        {models.length === 0 ? <span className="ob-empty">Ollama modeli bulunamadı</span> : models.map((model) => (
          <span className="ob-model-chip" key={`${model.provider}:${model.model}`}>{model.model} · {model.size || 'yerel'}</span>
        ))}
      </div>
      <div className="ob-form-grid">
        {routeKinds.map(([kind, label]) => (
          <label key={kind}>
            {label}
            <select value={routing[kind]?.model || ''} onChange={(event) => choose(kind, event.target.value)}>
              <option value="">Model seçin</option>
              {models.map((model) => (
                <option key={`${kind}:${model.model}`} value={model.model}>{model.model}</option>
              ))}
            </select>
            <small>{routing[kind]?.provider || 'atanmamış'}</small>
          </label>
        ))}
      </div>
      <div className="ob-modal-actions">
        <button className="ob-primary" onClick={() => onSave(routing)}>Yönlendirmeyi kaydet</button>
      </div>
    </section>
  );
}

function OfficeSettings({ settings, onSave }: { settings: Settings['office']; onSave: (values: Partial<Settings['office']>) => void }) {
  const notif = settings.notifications || {
    enabled: false,
    webhookUrl: '',
    telegramBotToken: '',
    telegramChatId: '',
    events: { taskCompleted: true, taskFailed: true, selfHealing: true, approvalNeeded: true }
  };
  const [notifState, setNotifState] = useState<NotificationsConfig>(notif);
  const [testResult, setTestResult] = useState<string>('');

  const sendTestNotification = async () => {
    try {
      setTestResult('Gönderiliyor...');
      const res = await fetch('/api/openbot/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: notifState })
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setTestResult('✓ Test bildirimi başarıyla gönderildi!');
      } else {
        setTestResult(`✗ Hata: ${JSON.stringify(data.results || data.message || 'Gönderilemedi')}`);
      }
    } catch (e) {
      setTestResult(`✗ Bağlantı hatası: ${e instanceof Error ? e.message : 'Bilinmeyen hata'}`);
    }
  };

  const updateNotif = (patch: Partial<NotificationsConfig>) => {
    const next = { ...notifState, ...patch };
    setNotifState(next);
    onSave({ notifications: next });
  };

  return (
    <section className="ob-section ob-settings">
      <h2>Ofis ayarları</h2>
      <p className="ob-note">Panel görünümü, yenileme ve harici bildirim (Webhook / Telegram) entegrasyonu.</p>
      <div className="ob-form-grid">
        <label>
          Yenileme aralığı (sn)
          <input type="number" min="5" max="300" value={settings.refreshSeconds} onChange={(event) => onSave({ refreshSeconds: Number(event.target.value) })} />
        </label>
        <label>
          Tema
          <select value={settings.theme} onChange={(event) => onSave({ theme: event.target.value })}>
            <option value="midnight">Midnight</option>
            <option value="graphite">Graphite</option>
            <option value="aurora">Aurora</option>
          </select>
        </label>
        <label>
          Yoğunluk
          <select value={settings.density} onChange={(event) => onSave({ density: event.target.value })}>
            <option value="comfortable">Rahat</option>
            <option value="compact">Sıkı</option>
            <option value="focus">Odak</option>
          </select>
        </label>
        <label>
          Gece modu
          <select value={settings.nightMode} onChange={(event) => onSave({ nightMode: event.target.value })}>
            <option value="auto">Otomatik</option>
            <option value="day">Gündüz</option>
            <option value="night">Gece</option>
          </select>
        </label>
      </div>
      <div className="ob-check-grid">
        {([['autoRefresh', 'Otomatik yenile'], ['showBoard', 'Görev panosunu göster'], ['showPerformance', 'Performansı göster'], ['showWaits', 'Bekleyenleri göster'], ['desktopNotifications', 'Masaüstü bildirimleri']] as const).map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" checked={settings[key]} onChange={(event) => onSave({ [key]: event.target.checked })} /> {label}
          </label>
        ))}
      </div>

      <hr style={{ borderColor: '#293545', margin: '24px 0' }} />

      {/* Feature 4: Harici Bildirimler */}
      <h3>🔔 Harici Bildirim Entegrasyonu (Webhook & Telegram)</h3>
      <p className="ob-note">Director görevleri tamamlandığında, arızalandığında veya watchdog devreye girdiğinde anlık bildirim alın.</p>
      <div className="ob-check-grid">
        <label>
          <input type="checkbox" checked={notifState.enabled} onChange={(e) => updateNotif({ enabled: e.target.checked })} /> <strong>Harici Bildirimleri Aktif Et</strong>
        </label>
      </div>
      <div className="ob-form-grid">
        <label>
          Discord / Slack / Genel Webhook URL
          <input value={notifState.webhookUrl} onChange={(e) => updateNotif({ webhookUrl: e.target.value })} placeholder="https://discord.com/api/webhooks/..." />
        </label>
        <label>
          Telegram Bot Token
          <input value={notifState.telegramBotToken} onChange={(e) => updateNotif({ telegramBotToken: e.target.value })} placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11" />
        </label>
        <label>
          Telegram Chat ID
          <input value={notifState.telegramChatId} onChange={(e) => updateNotif({ telegramChatId: e.target.value })} placeholder="-100123456789 veya 987654321" />
        </label>
      </div>
      <div className="ob-modal-actions" style={{ justifyContent: 'flex-start', alignItems: 'center' }}>
        <button className="ob-secondary" onClick={sendTestNotification}>🧪 Test Bildirimi Gönder</button>
        {testResult && <span style={{ marginLeft: '12px', fontSize: '.9rem', color: testResult.startsWith('✓') ? '#8fe0b4' : '#ff9e9e' }}>{testResult}</span>}
      </div>
    </section>
  );
}

function AgentEditor({ agent, initial, onCancel, onSave }: { agent: Agent; initial: AgentSettings; onCancel: () => void; onSave: (values: AgentSettings) => void }) {
  const [form, setForm] = useState<AgentSettings>({ enabled: true, room: 'Çalışma', priority: 50, provider: 'openbot', model: '', temperature: 0.7, maxTurns: 50, permissions: { read: 'allow', write: 'ask', execute: 'ask', network: 'ask', messaging: 'ask' }, ...initial });
  const update = (patch: Partial<AgentSettings>) => setForm((current) => ({ ...current, ...patch }));
  const updatePermission = (key: string, value: string) => update({ permissions: { ...form.permissions, [key]: value } });
  return (
    <div className="ob-modal-backdrop" role="presentation">
      <section className="ob-modal" role="dialog" aria-modal="true" aria-label={`${agent.name} bot ayarları`}>
        <div className="ob-section-heading">
          <div>
            <h2>{agent.name}</h2>
            <p className="ob-note">{agent.id}</p>
          </div>
          <button className="ob-close" onClick={onCancel}>×</button>
        </div>
        <div className="ob-form-grid">
          <label>Görünen ad<input value={form.displayName || ''} onChange={(event) => update({ displayName: event.target.value })} placeholder={agent.name} /></label>
          <label>Rol / unvan<input value={form.title || ''} onChange={(event) => update({ title: event.target.value })} placeholder={agent.role || 'Ajan'} /></label>
          <label>Oda<select value={form.room} onChange={(event) => update({ room: event.target.value })}>{rooms.map((room) => <option key={room}>{room}</option>)}</select></label>
          <label>Öncelik ({form.priority})<input type="range" min="0" max="100" value={form.priority} onChange={(event) => update({ priority: Number(event.target.value) })} /></label>
          <label>Sağlayıcı<input value={form.provider || ''} onChange={(event) => update({ provider: event.target.value })} /></label>
          <label>Model<input value={form.model || ''} onChange={(event) => update({ model: event.target.value })} placeholder="Varsayılan" /></label>
          <label>Sıcaklık ({form.temperature})<input type="range" min="0" max="2" step="0.1" value={form.temperature} onChange={(event) => update({ temperature: Number(event.target.value) })} /></label>
          <label>Maksimum tur<input type="number" min="1" max="500" value={form.maxTurns} onChange={(event) => update({ maxTurns: Number(event.target.value) })} /></label>
        </div>
        <div className="ob-check-grid">
          <label><input type="checkbox" checked={form.enabled !== false} onChange={(event) => update({ enabled: event.target.checked })} /> Bu botu ofiste aktif tut</label>
        </div>
        <h3>İzin politikası</h3>
        <div className="ob-permission-grid">
          {permissionKeys.map(([key, label]) => (
            <label key={key}>
              {label}
              <select value={form.permissions?.[key] || 'ask'} onChange={(event) => updatePermission(key, event.target.value)}>
                <option value="ask">Sor</option>
                <option value="allow">İzin ver</option>
                <option value="deny">Reddet</option>
              </select>
            </label>
          ))}
        </div>
        <div className="ob-modal-actions">
          <button className="ob-secondary" onClick={onCancel}>Vazgeç</button>
          <button className="ob-primary" onClick={() => onSave(form)}>Kaydet</button>
        </div>
      </section>
    </div>
  );
}
