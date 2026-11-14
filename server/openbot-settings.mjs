import fs from 'node:fs';
import path from 'node:path';

const ROOMS = ['Çalışma', 'Yönetim', 'Mesaj', 'Kod'];
const THEMES = ['midnight', 'graphite', 'aurora'];
const DENSITIES = ['comfortable', 'compact', 'focus'];
const LEVELS = ['ask', 'allow', 'deny'];
const DEFAULT_MODEL_ROUTING = {
  engineering: { provider: 'opencode', model: 'ollama/llama3.2:3b', fallbackProvider: 'opencode', fallbackModel: 'ollama/gemma4:latest' },
  research: { provider: 'opencode', model: 'ollama/gemma4:latest', fallbackProvider: 'opencode', fallbackModel: 'ollama/gemma4:latest' },
  communications: { provider: 'opencode', model: 'ollama/llama3.2:3b', fallbackProvider: 'opencode', fallbackModel: 'ollama/gemma4:latest' },
  design: { provider: 'opencode', model: 'ollama/gemma4:latest', fallbackProvider: 'opencode', fallbackModel: 'ollama/gemma4:latest' },
  operations: { provider: 'opencode', model: 'ollama/gemma4:latest', fallbackProvider: 'opencode', fallbackModel: 'ollama/gemma4:latest' },
  general: { provider: 'opencode', model: 'ollama/llama3.2:3b', fallbackProvider: 'opencode', fallbackModel: 'ollama/gemma4:latest' },
};
const DEFAULTS = {
  office: {
    refreshSeconds: 30,
    theme: 'midnight',
    density: 'comfortable',
    showPerformance: true,
    showBoard: true,
    showWaits: true,
    desktopNotifications: false,
    nightMode: 'auto',
    autoRefresh: true,
    autoAssignModels: true,
    notifications: {
      enabled: true,
      whatsappOrchestrator: true,
      telegramOrchestrator: true,
      webhookUrl: '',
      telegramBotToken: '',
      telegramChatId: '',
      events: { taskCompleted: true, taskFailed: true, selfHealing: true, approvalNeeded: true }
    }
  },
  modelRouting: DEFAULT_MODEL_ROUTING,
  agents: {},
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const cleanText = (value, max) => String(value ?? '').trim().slice(0, max);
function normalizeAgent(input = {}) {
  const output = {};
  if (input.displayName !== undefined) output.displayName = cleanText(input.displayName, 48);
  if (input.title !== undefined) output.title = cleanText(input.title, 100);
  if (input.room !== undefined && ROOMS.includes(input.room)) output.room = input.room;
  if (input.priority !== undefined) output.priority = Math.max(0, Math.min(100, Number(input.priority) || 0));
  if (input.enabled !== undefined) output.enabled = !!input.enabled;
  if (input.model !== undefined) output.model = cleanText(input.model, 120);
  if (input.provider !== undefined) output.provider = cleanText(input.provider, 60);
  if (input.temperature !== undefined) output.temperature = Math.max(0, Math.min(2, Number(input.temperature) || 0));
  if (input.maxTurns !== undefined) output.maxTurns = Math.max(1, Math.min(500, Math.round(Number(input.maxTurns) || 1)));
  if (input.permissions && typeof input.permissions === 'object') {
    output.permissions = {};
    for (const key of ['read', 'write', 'execute', 'network', 'messaging']) if (LEVELS.includes(input.permissions[key])) output.permissions[key] = input.permissions[key];
  }
  return output;
}
function normalizeRouting(input = {}) {
  const output = {};
  for (const [kind, value] of Object.entries(input || {})) {
    if (!DEFAULT_MODEL_ROUTING[kind] || !value || typeof value !== 'object') continue;
    const provider = cleanText(value.provider, 60);
    const model = cleanText(value.model, 120);
    const fallbackProvider = cleanText(value.fallbackProvider || DEFAULT_MODEL_ROUTING[kind].fallbackProvider, 60);
    const fallbackModel = cleanText(value.fallbackModel || DEFAULT_MODEL_ROUTING[kind].fallbackModel, 120);
    if (provider && model && fallbackProvider && fallbackModel) output[kind] = { provider, model, fallbackProvider, fallbackModel };
  }
  return output;
}
function normalizeOffice(input = {}) {
  const output = {};
  if (input.refreshSeconds !== undefined) output.refreshSeconds = Math.max(5, Math.min(300, Math.round(Number(input.refreshSeconds) || 30)));
  if (THEMES.includes(input.theme)) output.theme = input.theme;
  if (DENSITIES.includes(input.density)) output.density = input.density;
  for (const key of ['showPerformance', 'showBoard', 'showWaits', 'desktopNotifications', 'autoRefresh', 'autoAssignModels']) if (input[key] !== undefined) output[key] = !!input[key];
  if (['auto', 'day', 'night'].includes(input.nightMode)) output.nightMode = input.nightMode;
  if (input.notifications && typeof input.notifications === 'object') {
    output.notifications = {
      enabled: input.notifications.enabled !== false,
      whatsappOrchestrator: input.notifications.whatsappOrchestrator !== false,
      telegramOrchestrator: input.notifications.telegramOrchestrator !== false,
      webhookUrl: cleanText(input.notifications.webhookUrl, 500),
      telegramBotToken: cleanText(input.notifications.telegramBotToken, 200),
      telegramChatId: cleanText(input.notifications.telegramChatId, 100),
      events: {
        taskCompleted: input.notifications.events?.taskCompleted !== false,
        taskFailed: input.notifications.events?.taskFailed !== false,
        selfHealing: input.notifications.events?.selfHealing !== false,
        approvalNeeded: input.notifications.events?.approvalNeeded !== false
      }
    };
  }
  return output;
}
export function createOpenBotSettings(dataDir) {
  const file = path.join(dataDir, 'openbot-settings.json');
  let state = clone(DEFAULTS);
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const savedRouting = saved.modelRouting || {};
    const modelRouting = Object.fromEntries(Object.entries(DEFAULT_MODEL_ROUTING).map(([kind, defaults]) => [kind, { ...defaults, ...(savedRouting[kind] || {}) }]));
    state = { ...state, ...saved, office: { ...state.office, ...(saved.office || {}) }, modelRouting: normalizeRouting(modelRouting), agents: saved.agents || {} };
  } catch {}
  const save = () => { fs.mkdirSync(dataDir, { recursive: true }); const tmp = `${file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(state, null, 2)); fs.renameSync(tmp, file); };
  return {
    file,
    get() { return clone(state); },
    getAgent(id) { return clone(state.agents[String(id)] || {}); },
    setOffice(input) { state.office = { ...state.office, ...normalizeOffice(input) }; save(); return this.get(); },
    setModelRouting(input) { state.modelRouting = { ...state.modelRouting, ...normalizeRouting(input) }; save(); return this.get(); },
    getRouting(kind) { return clone(state.modelRouting?.[kind] || {}); },
    setAgent(id, input) { const key = String(id || '').slice(0, 120); if (!key) throw new Error('agent id is required'); state.agents[key] = { ...state.agents[key], ...normalizeAgent(input) }; save(); return this.get(); },
    resetAgent(id) { delete state.agents[String(id)]; save(); return this.get(); },
    resetAll() { state = clone(DEFAULTS); save(); return this.get(); },
  };
}
export { DEFAULTS, DEFAULT_MODEL_ROUTING, ROOMS, THEMES, DENSITIES, LEVELS };
