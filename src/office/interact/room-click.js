// 3D ofis: bir odaya tıklandığında o bölgedeki ajanı ve görevleri gösteren panel.
import * as THREE from 'three';
import { camera, renderer, scene } from '../scene/renderer.js';
import { t as tr } from '../../i18n/index.js';

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let panel = null;

function getRoomPlaques() {
  return scene.children.filter((o) => o.userData && o.userData.room && o.userData.roomIndex !== undefined);
}

function escapeHtml(text) {
  const d = document.createElement('div'); d.textContent = text; return d.innerHTML;
}

function closePanel() {
  if (panel) { panel.remove(); panel = null; }
}

function showRoomPanel(room) {
  closePanel();

  panel = document.createElement('div');
  panel.className = 'ob-room-panel';
  panel.style.position = 'absolute';
  panel.style.left = '0';
  panel.style.top = '0';
  panel.style.width = '100%';
  panel.style.height = '100%';
  panel.style.pointerEvents = 'none';
  panel.style.display = 'grid';
  panel.style.placeItems = 'center';
  panel.style.padding = '24px';
  panel.style.boxSizing = 'border-box';

  const card = document.createElement('div');
  card.className = 'ob-room-card';
  card.style.pointerEvents = 'auto';
  card.style.width = 'min(360px, 92vw)';
  card.style.padding = '20px';
  card.style.border = '1px solid #3c4d63';
  card.style.borderRadius = '14px';
  card.style.background = '#151d28';
  card.style.color = '#e8edf4';
  card.style.boxShadow = '0 22px 80px rgb(0 0 0 / 45%)';
  card.style.font = '14px/1.5 system-ui, sans-serif';
  card.style.display = 'grid';
  card.style.gap = '12px';

  const close = document.createElement('button');
  close.textContent = '×';
  close.style.alignSelf = 'flex-start';
  close.style.width = '30px';
  close.style.height = '30px';
  close.style.border = '0';
  close.style.borderRadius = '50%';
  close.style.background = '#263243';
  close.style.color = '#c7d2df';
  close.style.fontSize = '1.4rem';
  close.style.cursor = 'pointer';
  close.onclick = closePanel;

  const title = document.createElement('h2');
  title.textContent = escapeHtml(room.userData.room);
  title.style.margin = '0';
  title.style.fontSize = '1.4rem';
  title.style.color = '#f4f7fb';

  const purpose = document.createElement('p');
  purpose.textContent = escapeHtml(room.userData.roomPurpose || '');
  purpose.style.margin = '0';
  purpose.style.color = '#a5b0bf';
  purpose.style.fontSize = '0.88rem';

  const agentsBox = document.createElement('div');
  agentsBox.className = 'ob-room-agents';
  agentsBox.style.display = 'grid';
  agentsBox.style.gap = '8px';

  const agentsTitle = document.createElement('div');
  agentsTitle.textContent = tr('world.dept.agents') || 'Oda ajanları';
  agentsTitle.style.fontSize = '0.8rem';
  agentsTitle.style.color = '#8ecbff';
  agentsTitle.style.textTransform = 'uppercase';
  agentsTitle.style.letterSpacing = '0.08em';
  agentsBox.appendChild(agentsTitle);

  const agentsList = document.createElement('div');
  agentsList.style.display = 'grid';
  agentsList.style.gap = '6px';
  agentsBox.appendChild(agentsList);

  const note = document.createElement('p');
  note.textContent = tr('world.dept.clickNote') || 'Bu bölgedeki görevler için OpenBot kontrol merkezini açın.';
  note.style.margin = '0';
  note.style.color = '#728498';
  note.style.fontSize = '0.8rem';

  card.appendChild(close);
  card.appendChild(title);
  card.appendChild(purpose);
  card.appendChild(agentsBox);
  card.appendChild(note);
  panel.appendChild(card);
  renderer.domElement.parentNode.appendChild(panel);

  // Fetch agents for this room
  fetch('/api/openbot/settings', { cache: 'no-store' })
    .then((r) => r.ok ? r.json() : null)
    .then((data) => {
      if (!data || !data.agents) return;
      const roomAgents = Object.entries(data.agents).filter(([, s]) => s.room === room.userData.room);
      agentsList.replaceChildren();
      if (roomAgents.length === 0) {
        const empty = document.createElement('div');
        empty.textContent = tr('world.dept.noAgents') || 'Bu odada atanmış ajan yok.';
        empty.style.color = '#728498';
        empty.style.fontSize = '0.85rem';
        empty.style.fontStyle = 'italic';
        agentsList.appendChild(empty);
        return;
      }
      for (const [id, s] of roomAgents) {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.alignItems = 'center';
        row.style.gap = '8px';
        row.style.padding = '6px';
        row.style.borderRadius = '6px';
        row.style.background = '#0c131d';
        const dot = document.createElement('span');
        dot.style.width = '8px';
        dot.style.height = '8px';
        dot.style.borderRadius = '50%';
        dot.style.background = s.enabled === false ? '#667487' : '#6ce0a0';
        const name = document.createElement('span');
        name.textContent = escapeHtml(s.displayName || id);
        name.style.fontSize = '0.88rem';
        name.style.color = '#e8edf4';
        const role = document.createElement('span');
        role.textContent = escapeHtml(s.title || '');
        role.style.fontSize = '0.78rem';
        role.style.color = '#9eacbb';
        row.appendChild(dot);
        row.appendChild(name);
        row.appendChild(role);
        agentsList.appendChild(row);
      }
    })
    .catch(() => {
      agentsList.replaceChildren();
      const err = document.createElement('div');
      err.textContent = tr('world.dept.loadError') || 'Ajanlar yüklenemedi.';
      err.style.color = '#ff9e9e';
      err.style.fontSize = '0.85rem';
      agentsList.appendChild(err);
    });
}

function onCanvasPointerDown(event) {
  if (document.body.classList.contains('is-fp')) return;
  if (panel) { closePanel(); return; }

  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const plaques = getRoomPlaques();
  const intersects = raycaster.intersectObjects(plaques, false);

  if (intersects.length > 0) {
    event.preventDefault();
    showRoomPanel(intersects[0].object);
  } else {
    closePanel();
  }
}

export function setup() {
  renderer.domElement.addEventListener('pointerdown', onCanvasPointerDown, { passive: false });
}
