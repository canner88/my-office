import { el } from '../core/env.js';
import { icon } from './icons.js';
import { toast } from './activity.js';
import { TOKEN, applyOrchestrationTask } from '../net/live.js';

const q = (id = '') => { const params = new URLSearchParams(); if (id) params.set('id', id); if (TOKEN) params.set('k', TOKEN); const text = params.toString(); return text ? `?${text}` : ''; };
const call = (method, body = null, id = '') => fetch(`/api/openbot/orchestration${q(id)}`, {
  method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined
}).then((r) => r.json());

let poller = null;
export function mountDirectorChat(host) {
  host.querySelector('#director-chat')?.remove();
  clearInterval(poller); poller = null;
  const root = el('section', 'director-chat'); root.id = 'director-chat';
  const title = el('div', 'director-chat-title');
  title.append(icon('sparkle'), el('strong', null, 'Director görev merkezi'), el('span', 'director-chat-live', 'OpenBot koordinasyonu'));
  const input = el('textarea', 'director-chat-input'); input.rows = 4; input.maxLength = 4000; input.placeholder = 'Görevi yazın… Örn: API performansını analiz et, düzelt ve raporla.';
  const actions = el('div', 'director-chat-actions');
  const send = el('button', 'btn btn--primary', 'Toplantıyı başlat'); send.type = 'button'; send.append(icon('send'));
  const refresh = el('button', 'btn btn--sm', 'Durumu yenile'); refresh.type = 'button';
  actions.append(send, refresh);
  const status = el('div', 'director-chat-status', 'Director görevi alır, toplantıyı açar ve uygun ajanlara dağıtır.');
  const board = el('div', 'director-chat-board');
  const report = el('pre', 'director-chat-report'); report.hidden = true;
  const speak = el('button', 'btn btn--sm director-chat-speak', 'Sesli özeti söyle'); speak.type = 'button'; speak.hidden = true; speak.append(icon('volume'));
  root.append(title, input, actions, status, board, report, speak);
  host.append(root);
  let activeId = null;
  const autoStarted = new Set();

  const paint = (task) => {
    if (!task) return;
    activeId = task.id;
    applyOrchestrationTask(task);
    status.textContent = `${task.status === 'completed' ? 'Tamamlandı' : task.status === 'working' ? 'Ajanlar çalışıyor' : 'Toplantı'} · ${task.integration?.message || ''}`;
    board.replaceChildren();
    const meeting = el('div', 'director-chat-meeting');
    meeting.append(el('b', null, task.meeting?.status === 'completed' ? '✓ Toplantı tamamlandı' : '● Toplantı masasında'), el('span', null, `${task.meeting?.participants?.length || 0} katılımcı`));
    board.append(meeting);
    const list = el('ul', 'director-chat-assignments');
    for (const item of task.assignments || []) {
      const li = el('li', `director-chat-assignment is-${item.status}`);
      const details = el('div'); details.append(el('b', null, item.agent), el('small', null, `${item.role} · ${item.room} · ${item.zone || 'Görev'}`));
      li.append(el('span', 'director-chat-dot'), details, el('em', null, item.status === 'completed' ? 'Rapor alındı' : item.dispatch === 'failed' ? 'Gönderilemedi' : 'Rapor bekleniyor'));
      list.append(li);
    }
    board.append(list);
    if (task.finalReport) { report.hidden = false; report.textContent = task.finalReport; speak.hidden = false; speak.onclick = () => { if (!('speechSynthesis' in window)) { toast('Bu tarayıcı sesli okumayı desteklemiyor.'); return; } speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(task.spokenSummary || task.finalReport)); }; }
    if (task.status !== 'completed' && task.status !== 'failed' && task.status !== 'cancelled') {
      const action = el('button', 'btn btn--sm director-chat-finish', task.phase === 'meeting' ? 'Toplantıyı kapat ve görevi dağıt' : task.phase === 'regroup' ? 'Director raporunu oluştur' : task.integration?.connected ? 'Ajan sonuçlarını yenile' : 'Yerel çıktıları derle'); action.type = 'button';
      action.onclick = async () => { action.disabled = true; try { const op = task.phase === 'meeting' ? 'advance' : task.phase === 'regroup' ? 'complete' : task.integration?.connected ? 'advance' : 'complete'; const r = await call('POST', { op, id: task.id }); if (!r?.ok) throw new Error(r?.message); paint(r.task); } catch (err) { toast(err.message || 'Director akışı güncellenemedi.'); action.disabled = false; } }; board.append(action);
    }
  };
  const autoAdvanceMeeting = async (task) => {
    if (!task?.id || task.phase !== 'meeting' || autoStarted.has(task.id)) return;
    autoStarted.add(task.id);
    setTimeout(async () => {
      try { const r = await call('POST', { op: 'advance', id: task.id }); if (r?.task) paint(r.task); }
      catch { autoStarted.delete(task.id); }
    }, 1200);
  };
  const refreshState = async () => { try { const r = await call('GET', null, activeId); if (r?.task) { paint(r.task); autoAdvanceMeeting(r.task); } } catch { /* transient */ } };
  send.onclick = async () => { const prompt = input.value.trim(); if (!prompt) { input.focus(); return; } send.disabled = true; try { const r = await call('POST', { op: 'create', prompt }); if (!r?.ok) throw new Error(r?.message); input.value = ''; paint(r.task); autoAdvanceMeeting(r.task); clearInterval(poller); poller = setInterval(refreshState, 2500); } catch (err) { toast(err.message || 'Director görevi başlatamadı.'); } finally { send.disabled = false; } };
  refresh.onclick = refreshState;
  refreshState();
  return root;
}
