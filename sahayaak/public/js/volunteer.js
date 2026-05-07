// Volunteer Dashboard JS
const API = '';
let token = localStorage.getItem('sahaayak_token');
let user = JSON.parse(localStorage.getItem('sahaayak_user') || 'null');
let allTasks = [];
let socket;
let volMap;
let selectedSkills = new Set();

// Auth guard
if (!token || !user || user.role !== 'volunteer') {
  window.location.href = '/login';
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setUserUI();
  initSocket();
  loadAll();
  initSkillButtons();
  checkEmergency();
});

function setUserUI() {
  document.getElementById('userName').textContent = user.name.split(' ')[0];
  document.getElementById('greetName').textContent = user.name.split(' ')[0];
  document.getElementById('userAvatar').textContent = user.name[0].toUpperCase();
}

function apiFetch(path, opts = {}) {
  return fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, ...(opts.headers || {}) }
  });
}

async function loadAll() {
  await Promise.all([loadTasks(), loadProfile(), loadNotifications(), loadStats()]);
}

// ── TASKS ──────────────────────────────────────────────────────────────────────
async function loadTasks() {
  try {
    const res = await apiFetch('/api/volunteers/tasks');
    allTasks = await res.json();
    renderTasks();
    renderActiveTasks();
  } catch (e) { console.error(e); }
}

function renderTasks() {
  const filter = document.getElementById('taskFilter')?.value || 'all';
  const filtered = filter === 'all' ? allTasks : allTasks.filter(t => t.status === filter);
  const grid = document.getElementById('tasksGrid');
  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><h3>No tasks</h3><p>No tasks match this filter.</p></div>';
    return;
  }
  grid.innerHTML = filtered.map(t => taskCardHTML(t)).join('');
}

function renderActiveTasks() {
  const active = allTasks.filter(t => t.status === 'assigned' || t.status === 'in-progress');
  const el = document.getElementById('activeTasks');
  if (!active.length) {
    el.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><h3>No active tasks</h3><p>Tasks assigned to you will appear here.</p></div>';
    return;
  }
  el.innerHTML = `<div class="tasks-grid">${active.map(t => taskCardHTML(t)).join('')}</div>`;
  // Update stats
  const statsRes = { total: allTasks.length, inProgress: active.filter(t => t.status === 'in-progress').length };
  document.getElementById('statTotal').textContent = allTasks.length;
  document.getElementById('statInProgress').textContent = statsRes.inProgress;
}

function taskCardHTML(t) {
  const skillsHTML = (t.required_skills || []).map(s => `<span class="skill-tag">${s}</span>`).join('');
  let actions = '';
  if (t.status === 'assigned') {
    actions = `<button class="btn btn-success btn-sm" onclick="respondTask(${t.id},'accept')"><i class="fas fa-check"></i> Accept</button>
               <button class="btn btn-danger btn-sm" onclick="respondTask(${t.id},'reject')"><i class="fas fa-times"></i> Reject</button>`;
  } else if (t.status === 'in-progress') {
    actions = `<button class="btn btn-primary-glow btn-sm" onclick="markComplete(${t.id})"><i class="fas fa-check"></i> Completed</button>`;
  } else if (t.status === 'pending-verification') {
    actions = `<span class="badge badge-warning" style="font-size:11px;background:rgba(245,158,11,0.1);color:#f59e0b;padding:4px 8px;border-radius:4px">
                 <i class="fas fa-clock"></i> Verification Pending
               </span>`;
  }
  return `
  <div class="task-card ${t.urgency}" onclick="viewTask(${t.id})">
    <div class="task-card-header">
      <div class="task-card-title">${t.title}</div>
      <span class="urgency-badge ${t.urgency}">${t.urgency}</span>
    </div>
    <p class="task-card-desc">${t.description}</p>
    <div class="task-meta">
      <span class="task-meta-item"><i class="fas fa-map-marker-alt"></i>${t.location_name || 'Location TBD'}</span>
      <span class="task-meta-item"><i class="fas fa-clock"></i>${t.estimated_duration || 60} min</span>
    </div>
    ${skillsHTML ? `<div class="task-skills">${skillsHTML}</div>` : ''}
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
      <span class="status-badge ${t.status}">${t.status}</span>
      <div style="display:flex;gap:6px" onclick="event.stopPropagation()">${actions}</div>
    </div>
  </div>`;
}

async function respondTask(id, action) {
  try {
    const res = await apiFetch(`/api/volunteers/tasks/${id}/respond`, { method: 'PUT', body: JSON.stringify({ action }) });
    const data = await res.json();
    showToast(data.message || data.error, res.ok ? 'success' : 'error');
    if (res.ok) { await loadTasks(); socket?.emit('task_update', { taskId: id, action }); }
  } catch (e) { showToast('Request failed', 'error'); }
}

async function markComplete(id) {
  try {
    const res = await apiFetch(`/api/volunteers/tasks/${id}/status`, { method: 'PUT', body: JSON.stringify({ status: 'pending-verification' }) });
    const data = await res.json();
    showToast(data.message || data.error, res.ok ? 'success' : 'error');
    if (res.ok) { await loadAll(); socket?.emit('task_update', { taskId: id, status: 'pending-verification' }); }
  } catch (e) { showToast('Request failed', 'error'); }
}

function viewTask(id) {
  const t = allTasks.find(t => t.id === id);
  if (!t) return;
  document.getElementById('taskModalTitle').textContent = t.title;
  document.getElementById('taskModalBody').innerHTML = `
    <div class="flex items-center gap-2 mb-4">
      <span class="urgency-badge ${t.urgency}">${t.urgency} priority</span>
      <span class="status-badge ${t.status}">${t.status}</span>
    </div>
    <p style="color:var(--text-muted);font-size:14px;margin-bottom:16px;line-height:1.7">${t.description}</p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px">
      <div><strong>📍 Location</strong><p style="color:var(--text-muted)">${t.location_name || 'TBD'}</p></div>
      <div><strong>⏱ Duration</strong><p style="color:var(--text-muted)">${t.estimated_duration || 60} minutes</p></div>
      <div><strong>📅 Created</strong><p style="color:var(--text-muted)">${new Date(t.created_at).toLocaleDateString()}</p></div>
      <div><strong>🔧 Skills</strong><p style="color:var(--text-muted)">${(t.required_skills || []).join(', ') || 'None'}</p></div>
    </div>`;
  let footer = '';
  if (t.status === 'assigned') {
    footer = `<button class="btn btn-success" onclick="respondTask(${t.id},'accept');closeModal('taskModal')"><i class="fas fa-check"></i> Accept</button>
              <button class="btn btn-danger" onclick="respondTask(${t.id},'reject');closeModal('taskModal')"><i class="fas fa-times"></i> Reject</button>`;
  } else if (t.status === 'in-progress') {
    footer = `<button class="btn btn-primary-glow" onclick="markComplete(${t.id});closeModal('taskModal')"><i class="fas fa-flag-checkered"></i> Mark Complete</button>`;
  }
  document.getElementById('taskModalFooter').innerHTML = footer;
  document.getElementById('taskModal').classList.remove('hidden');
}

// ── STATS ──────────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await apiFetch(`/api/analytics/volunteer/${user.id}`);
    const d = await res.json();
    document.getElementById('statTotal').textContent = d.assignedTasks || 0;
    document.getElementById('statInProgress').textContent = d.inProgress || 0;
    document.getElementById('statCompleted').textContent = d.completed || 0;
    document.getElementById('statAvgTime').textContent = d.avgResponseTime || '--';
    document.getElementById('profileCompleted').textContent = d.completed || 0;
  } catch (e) {}
}

// ── PROFILE ────────────────────────────────────────────────────────────────────
async function loadProfile() {
  try {
    const res = await apiFetch('/api/volunteers/profile');
    const d = await res.json();
    document.getElementById('profileName').textContent = d.name;
    document.getElementById('profileAvatar').textContent = d.name[0].toUpperCase();
    document.getElementById('profileRating').textContent = d.profile?.rating?.toFixed(1) || '5.0';
    document.getElementById('profilePoints').textContent = d.profile?.points || 0;
    document.getElementById('editName').value = d.name || '';
    document.getElementById('editPhone').value = d.phone || '';
    document.getElementById('editBio').value = d.profile?.bio || '';
    document.getElementById('editLocation').value = d.profile?.location_name || '';
    document.getElementById('editLat').value = d.profile?.latitude || 0;
    document.getElementById('editLng').value = d.profile?.longitude || 0;
    if (d.profile?.availability) document.getElementById('profileAvailability').value = d.profile.availability;
    // Set skills
    const skills = d.profile?.skills || [];
    selectedSkills = new Set(skills);
    document.querySelectorAll('#editSkills .skill-btn').forEach(btn => {
      btn.classList.toggle('active', skills.includes(btn.dataset.skill));
    });
  } catch (e) {}
}

function initSkillButtons() {
  document.querySelectorAll('#editSkills .skill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const skill = btn.dataset.skill;
      if (selectedSkills.has(skill)) { selectedSkills.delete(skill); btn.classList.remove('active'); }
      else { selectedSkills.add(skill); btn.classList.add('active'); }
    });
  });
}

async function saveProfile() {
  const al = document.getElementById('profileAlert');
  try {
    const body = {
      name: document.getElementById('editName').value,
      phone: document.getElementById('editPhone').value,
      bio: document.getElementById('editBio').value,
      skills: [...selectedSkills],
      availability: document.getElementById('profileAvailability').value,
      latitude: parseFloat(document.getElementById('editLat').value) || 0,
      longitude: parseFloat(document.getElementById('editLng').value) || 0,
      location_name: document.getElementById('editLocation').value
    };
    const res = await apiFetch('/api/volunteers/profile', { method: 'PUT', body: JSON.stringify(body) });
    const d = await res.json();
    al.textContent = d.message || d.error;
    al.className = `alert alert-${res.ok ? 'success' : 'error'}`;
    if (res.ok) { user.name = body.name; localStorage.setItem('sahaayak_user', JSON.stringify(user)); setUserUI(); }
  } catch (e) { al.textContent = 'Save failed'; al.className = 'alert alert-error'; }
}

function detectMyLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById('editLat').value = pos.coords.latitude;
    document.getElementById('editLng').value = pos.coords.longitude;
    document.getElementById('editLocation').value = `${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)}`;
  });
}

async function updateMyLocation() {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(async pos => {
    await apiFetch('/api/volunteers/location', { method: 'PUT', body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude }) });
    showToast('Location updated!', 'success');
  });
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
let notifications = [];
async function loadNotifications() {
  try {
    const res = await apiFetch('/api/volunteers/notifications');
    notifications = await res.json();
    renderNotifications();
  } catch (e) {}
}

function renderNotifications() {
  const unread = notifications.filter(n => !n.is_read).length;
  const badge = document.getElementById('notifBadge');
  badge.textContent = unread;
  badge.classList.toggle('hidden', unread === 0);
  const list = document.getElementById('notifList');
  if (!notifications.length) { list.innerHTML = '<div class="notif-empty"><i class="fas fa-bell-slash"></i><p>No notifications</p></div>'; return; }
  list.innerHTML = notifications.slice(0, 20).map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'} ${n.type === 'emergency' ? 'emergency' : ''}">
      <div class="notif-item-title">${n.title}</div>
      <div class="notif-item-msg">${n.message}</div>
      <div class="notif-item-time">${timeAgo(n.created_at)}</div>
    </div>`).join('');
}

async function markAllRead() {
  await apiFetch('/api/volunteers/notifications/read', { method: 'PUT' });
  notifications.forEach(n => n.is_read = 1);
  renderNotifications();
}

document.getElementById('notifBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('notifPanel').classList.toggle('hidden');
});
document.addEventListener('click', () => document.getElementById('notifPanel').classList.add('hidden'));
document.getElementById('notifPanel').addEventListener('click', e => e.stopPropagation());

// ── MAP ────────────────────────────────────────────────────────────────────────
async function initMap() {
  if (volMap) return;
  volMap = L.map('mapContainer', { zoomControl: true }).setView([28.6139, 77.2090], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 18
  }).addTo(volMap);
  await refreshMapData();
}

async function refreshMapData() {
  if (!volMap) return;
  try {
    const res = await apiFetch('/api/tasks/map/data');
    const { tasks, volunteers } = await res.json();
    volMap.eachLayer(l => { if (l instanceof L.Marker || l instanceof L.Circle) volMap.removeLayer(l); });
    // Draw tasks
    for (const t of tasks) {
      if (!t.latitude && !t.longitude) continue;
      const col = t.urgency === 'high' ? '#ef4444' : t.urgency === 'medium' ? '#f59e0b' : '#22c55e';
      L.circleMarker([t.latitude, t.longitude], { radius: 14, color: col, fillColor: col, fillOpacity: 0.7, weight: 2 })
        .addTo(volMap).bindPopup(`<strong>${t.title}</strong><br>${t.urgency} priority<br>${t.status}`);
    }
    // Draw self
    const myVol = volunteers.find(v => v.id === user.id);
    if (myVol && myVol.latitude) {
      L.marker([myVol.latitude, myVol.longitude], {
        icon: L.divIcon({ className: '', html: `<div style="background:#6c63ff;width:20px;height:20px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 10px #6c63ff"></div>`, iconSize: [20, 20] })
      }).addTo(volMap).bindPopup(`<strong>You: ${user.name}</strong>`);
      volMap.setView([myVol.latitude, myVol.longitude], 13);
    }
  } catch (e) {}
}

// ── EMERGENCY ─────────────────────────────────────────────────────────────────
async function checkEmergency() {
  try {
    const res = await apiFetch('/api/admin/emergency/status');
    const d = await res.json();
    if (d.active) {
      document.getElementById('emergencyBanner').classList.remove('hidden');
      document.getElementById('emergencyBannerNav').style.display = 'flex';
      document.getElementById('emergencyTitle').textContent = d.event?.title || 'Emergency active!';
    }
  } catch (e) {}
}

// ── SOCKET ─────────────────────────────────────────────────────────────────────
function initSocket() {
  socket = io();
  socket.emit('register', user.id);
  socket.on('notification', async (n) => {
    notifications.unshift(n);
    renderNotifications();
    showToast(n.title, n.type === 'emergency' ? 'error' : 'info');
    await loadTasks();
  });
  socket.on('emergency_alert', (data) => {
    document.getElementById('emergencyBanner').classList.remove('hidden');
    document.getElementById('emergencyBannerNav').style.display = 'flex';
    document.getElementById('emergencyTitle').textContent = data.title || 'Emergency active!';
    showToast('🚨 EMERGENCY MODE ACTIVATED!', 'error');
  });
  socket.on('task_changed', () => loadTasks());
}

// ── TABS ────────────────────────────────────────────────────────────────────────
function switchTab(name, el) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  document.getElementById(`tab-${name}`).classList.add('active');
  if (el) el.classList.add('active');
  if (name === 'map') setTimeout(initMap, 100);
}

// ── HELPERS ────────────────────────────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function timeAgo(dt) {
  const diff = (Date.now() - new Date(dt)) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return new Date(dt).toLocaleDateString();
}

let toastTimer;
function showToast(msg, type = 'info') {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;z-index:9999;padding:12px 20px;border-radius:10px;font-size:14px;font-weight:600;max-width:320px;box-shadow:0 8px 32px rgba(0,0,0,0.4);transition:all .3s';
    document.body.appendChild(toast);
  }
  const colors = { success: '#22c55e', error: '#ef4444', info: '#6c63ff', warning: '#f59e0b' };
  toast.style.background = colors[type] || colors.info;
  toast.style.color = '#fff';
  toast.textContent = msg;
  toast.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}

function logout() {
  fetch('/api/auth/logout', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
  localStorage.clear();
  window.location.href = '/login';
}
