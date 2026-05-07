// Admin Dashboard JS
const API = '';
let token = localStorage.getItem('sahaayak_token');
let user = JSON.parse(localStorage.getItem('sahaayak_user') || 'null');
let allTasks = [];
let allVolunteers = [];
let socket;
let adminMap;
let charts = {};
let selectedSkills = new Set();

// Auth guard
if (!token || !user || user.role !== 'admin') {
  window.location.href = '/login?role=admin';
}

// ── INIT ──────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  setUserUI();
  initSocket();
  loadAll();
  initSkillButtons();
  checkEmergencyStatus();
});

function setUserUI() {
  document.getElementById('userName').textContent = user.name;
  document.getElementById('userAvatar').textContent = user.name[0].toUpperCase();
}

function apiFetch(path, opts = {}) {
  return fetch(API + path, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      ...(opts.headers || {})
    }
  });
}

async function loadAll() {
  await Promise.all([
    loadStats(),
    loadTasks(),
    loadVolunteers(),
    loadNotifications()
  ]);
}

// ── STATS & ANALYTICS ──────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res = await apiFetch('/api/analytics/overview');
    const d = await res.json();
    
    // Overview stats
    document.getElementById('statVolunteers').textContent = d.totalVolunteers;
    document.getElementById('statActive').textContent = d.activeVolunteers;
    document.getElementById('statOpen').textContent = d.openTasks;
    document.getElementById('statAssigned').textContent = d.assignedTasks;
    document.getElementById('statCompleted').textContent = d.completedTasks;
    document.getElementById('statHighUrgency').textContent = d.highUrgency;

    // Analytics tab stats
    const aStats = document.getElementById('analyticsStats');
    if (aStats) {
      aStats.innerHTML = `
        <div class="stat-card purple"><div class="stat-card-value">${d.avgResponseTime}m</div><div class="stat-card-label">Avg. Response Time</div></div>
        <div class="stat-card green"><div class="stat-card-value">${d.availableVolunteers}</div><div class="stat-card-label">Available Now</div></div>
        <div class="stat-card orange"><div class="stat-card-value">${Math.round((d.completedTasks/d.totalTasks)*100 || 0)}%</div><div class="stat-card-label">Completion Rate</div></div>
      `;
    }

    renderCharts(d);
    renderTopVolunteers(d.topVolunteers);
  } catch (e) { console.error('Stats error:', e); }
}

function renderCharts(data) {
  // Status Chart
  renderChart('chartStatus', 'doughnut', {
    labels: data.tasksByStatus.map(s => s.status),
    datasets: [{
      data: data.tasksByStatus.map(s => s.count),
      backgroundColor: ['#6c63ff', '#f59e0b', '#22c55e', '#3b82f6', '#94a3b8']
    }]
  });

  // Urgency Chart
  renderChart('chartUrgency', 'pie', {
    labels: data.tasksByUrgency.map(u => u.urgency),
    datasets: [{
      data: data.tasksByUrgency.map(u => u.count),
      backgroundColor: ['#ef4444', '#f59e0b', '#22c55e']
    }]
  });

  // Timeline Chart
  renderChart('chartTimeline', 'line', {
    labels: data.tasksOverTime.map(t => t.day),
    datasets: [{
      label: 'Tasks Created',
      data: data.tasksOverTime.map(t => t.count),
      borderColor: '#6c63ff',
      tension: 0.4,
      fill: true,
      backgroundColor: 'rgba(108, 99, 255, 0.1)'
    }]
  });

  // Skills Chart
  renderChart('chartSkills', 'bar', {
    labels: data.skillDemand.map(s => s.skill),
    datasets: [{
      label: 'Demand Count',
      data: data.skillDemand.map(s => s.count),
      backgroundColor: '#3b82f6'
    }]
  }, { indexAxis: 'y' });
}

function renderChart(id, type, data, options = {}) {
  const ctx = document.getElementById(id);
  if (!ctx) return;
  if (charts[id]) charts[id].destroy();
  charts[id] = new Chart(ctx, {
    type, data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { position: 'bottom', labels: { color: '#94a3b8', font: { size: 10 } } } },
      ...options
    }
  });
}

function renderTopVolunteers(vols) {
  const list = document.getElementById('topVolsList');
  if (!list) return;
  list.innerHTML = vols.map(v => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
      <div style="display:flex;align-items:center;gap:10px">
        <div style="width:32px;height:32px;border-radius:50%;background:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">${v.name[0]}</div>
        <div><div style="font-weight:600;font-size:13px">${v.name}</div><div style="font-size:11px;color:var(--text-muted)">${v.tasks_completed} tasks</div></div>
      </div>
      <div style="color:var(--warning);font-size:12px"><i class="fas fa-star"></i> ${v.rating.toFixed(1)}</div>
    </div>
  `).join('');
}

// ── TASKS ──────────────────────────────────────────────────────────────────────
async function loadTasks() {
  try {
    const res = await apiFetch('/api/tasks');
    allTasks = await res.json();
    renderRecentTasks();
    renderAdminTasks();
  } catch (e) { console.error(e); }
}

function renderRecentTasks() {
  const list = document.getElementById('recentTasksList');
  if (!list) return;
  const recent = allTasks.slice(0, 5);
  list.innerHTML = recent.map(t => `
    <div class="task-item" onclick="switchTab('tasks', document.querySelectorAll('.sidebar-link')[1])">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:4px">
        <span style="font-weight:600;font-size:14px">${t.title}</span>
        <span class="urgency-badge ${t.urgency}">${t.urgency}</span>
      </div>
      <div style="font-size:12px;color:var(--text-muted);display:flex;align-items:center;gap:10px">
        <span><i class="fas fa-map-marker-alt"></i> ${t.location_name || 'Delhi'}</span>
        <span><i class="fas fa-user"></i> ${t.volunteer_name || 'Unassigned'}</span>
        <span class="status-badge ${t.status}">${t.status}</span>
      </div>
    </div>
  `).join('');
}

function renderAdminTasks() {
  const grid = document.getElementById('adminTasksGrid');
  if (!grid) return;
  
  const statusFilter = document.getElementById('taskStatusFilter').value;
  const urgencyFilter = document.getElementById('taskUrgencyFilter').value;
  
  const filtered = allTasks.filter(t => {
    return (statusFilter === 'all' || t.status === statusFilter) &&
           (urgencyFilter === 'all' || t.urgency === urgencyFilter);
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="empty-state" style="grid-column:1/-1"><i class="fas fa-search"></i><h3>No tasks found</h3></div>';
    return;
  }

  grid.innerHTML = filtered.map(t => `
    <div class="task-card ${t.urgency}">
      <div class="task-card-header">
        <div class="task-card-title">${t.title}</div>
        <span class="urgency-badge ${t.urgency}">${t.urgency}</span>
      </div>
      <p class="task-card-desc">${t.description}</p>
      <div class="task-meta">
        <span class="task-meta-item"><i class="fas fa-map-marker-alt"></i>${t.location_name}</span>
        <span class="task-meta-item"><i class="fas fa-user"></i>${t.volunteer_name || 'Unassigned'}</span>
      </div>
      <div class="task-skills">
        ${(t.required_skills || []).map(s => `<span class="skill-tag">${s}</span>`).join('')}
      </div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-top:12px">
        <span class="status-badge ${t.status}">${t.status}</span>
        <div style="display:flex;gap:6px">
          ${t.status === 'open' ? `<button class="btn btn-primary-glow btn-sm" onclick="openAssignModal(${t.id})">Assign</button>` : ''}
          ${t.status === 'pending-verification' ? `<button class="btn btn-success btn-sm" onclick="verifyTask(${t.id})"><i class="fas fa-certificate"></i> Verify</button>` : ''}
          <button class="btn btn-ghost btn-sm" onclick="editTask(${t.id})"><i class="fas fa-edit"></i></button>
          <button class="btn btn-ghost btn-sm" onclick="deleteTask(${t.id})"><i class="fas fa-trash"></i></button>
        </div>
      </div>
    </div>
  `).join('');
}

// ── TASK FORM ──────────────────────────────────────────────────────────────────
let editingTaskId = null;

function openCreateTask() {
  editingTaskId = null;
  document.getElementById('taskFormTitle').textContent = 'Create New Task';
  document.getElementById('ftTitle').value = '';
  document.getElementById('ftDesc').value = '';
  document.getElementById('ftUrgency').value = 'medium';
  document.getElementById('ftDuration').value = '60';
  document.getElementById('ftLocation').value = '';
  document.getElementById('ftLat').value = '28.6139';
  document.getElementById('ftLng').value = '77.2090';
  selectedSkills.clear();
  document.querySelectorAll('#ftSkills .skill-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('taskFormModal').classList.remove('hidden');
}

function initSkillButtons() {
  document.querySelectorAll('.skill-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const skill = btn.dataset.skill;
      if (selectedSkills.has(skill)) {
        selectedSkills.delete(skill);
        btn.classList.remove('active');
      } else {
        selectedSkills.add(skill);
        btn.classList.add('active');
      }
    });
  });
}

async function saveTask() {
  const body = {
    title: document.getElementById('ftTitle').value,
    description: document.getElementById('ftDesc').value,
    urgency: document.getElementById('ftUrgency').value,
    estimated_duration: parseInt(document.getElementById('ftDuration').value),
    location_name: document.getElementById('ftLocation').value,
    latitude: parseFloat(document.getElementById('ftLat').value),
    longitude: parseFloat(document.getElementById('ftLng').value),
    required_skills: [...selectedSkills]
  };

  if (!body.title || !body.description) {
    return showFormAlert('taskFormAlert', 'Title and description are required.');
  }

  try {
    const url = editingTaskId ? `/api/tasks/${editingTaskId}` : '/api/tasks';
    const method = editingTaskId ? 'PUT' : 'POST';
    const res = await apiFetch(url, { method, body: JSON.stringify(body) });
    if (res.ok) {
      closeModal('taskFormModal');
      loadTasks();
      loadStats();
      showToast(editingTaskId ? 'Task updated!' : 'Task created!', 'success');
      socket?.emit('task_update', { action: editingTaskId ? 'updated' : 'created' });
    } else {
      const d = await res.json();
      showFormAlert('taskFormAlert', d.error || 'Failed to save task.');
    }
  } catch (e) { showFormAlert('taskFormAlert', 'Network error.'); }
}

function editTask(id) {
  const t = allTasks.find(x => x.id === id);
  if (!t) return;
  editingTaskId = id;
  document.getElementById('taskFormTitle').textContent = 'Edit Task';
  document.getElementById('ftTitle').value = t.title;
  document.getElementById('ftDesc').value = t.description;
  document.getElementById('ftUrgency').value = t.urgency;
  document.getElementById('ftDuration').value = t.estimated_duration;
  document.getElementById('ftLocation').value = t.location_name;
  document.getElementById('ftLat').value = t.latitude;
  document.getElementById('ftLng').value = t.longitude;
  
  selectedSkills = new Set(t.required_skills || []);
  document.querySelectorAll('#ftSkills .skill-btn').forEach(btn => {
    btn.classList.toggle('active', selectedSkills.has(btn.dataset.skill));
  });
  
  document.getElementById('taskFormModal').classList.remove('hidden');
}

async function deleteTask(id) {
  if (!confirm('Are you sure you want to delete this task?')) return;
  try {
    const res = await apiFetch(`/api/tasks/${id}`, { method: 'DELETE' });
    if (res.ok) {
      loadTasks();
      loadStats();
      showToast('Task deleted.', 'info');
      socket?.emit('task_update', { taskId: id, action: 'deleted' });
    }
  } catch (e) {}
}

async function verifyTask(id) {
  if (!confirm('Verify completion of this task and award points to the volunteer?')) return;
  try {
    const res = await apiFetch(`/api/tasks/${id}/verify`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      showToast(data.message, 'success');
      loadTasks();
      loadStats();
      socket?.emit('task_update', { taskId: id, action: 'verified' });
    } else {
      alert(data.error || 'Verification failed.');
    }
  } catch (e) { showToast('Request failed.', 'error'); }
}

// ── ASSIGNMENT ─────────────────────────────────────────────────────────────────
async function openAssignModal(taskId) {
  const modal = document.getElementById('assignModal');
  const body = document.getElementById('assignModalBody');
  const footer = document.getElementById('assignModalFooter');
  
  body.innerHTML = '<div style="padding:40px;text-align:center"><span class="spinner"></span><p>Calculating best matches...</p></div>';
  modal.classList.remove('hidden');

  try {
    const res = await apiFetch(`/api/tasks/${taskId}/score-volunteers`);
    const scored = await res.json();
    
    body.innerHTML = `
      <div style="margin-bottom:15px;display:flex;justify-content:space-between;align-items:center">
        <h4 style="margin:0">Top Recommendations</h4>
        <button class="btn btn-primary-glow btn-sm" onclick="autoAssign(${taskId})"><i class="fas fa-magic"></i> Auto-Assign Best</button>
      </div>
      <div class="scroll-area" style="max-height:400px">
        ${scored.map(v => `
          <div class="volunteer-score-item" style="display:flex;justify-content:space-between;align-items:center;padding:12px;border-radius:10px;background:rgba(255,255,255,0.03);margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:12px">
              <div style="width:40px;height:40px;border-radius:50%;background:rgba(108,99,255,0.2);display:flex;align-items:center;justify-content:center;font-weight:700">${v.name[0]}</div>
              <div>
                <div style="font-weight:600">${v.name} <span class="status-dot ${v.is_online ? 'online' : 'offline'}"></span></div>
                <div style="font-size:11px;color:var(--text-muted)">${v.distance}km away • ${v.skills.length} skills match</div>
              </div>
            </div>
            <div style="text-align:right">
              <div style="font-size:18px;font-weight:800;color:var(--primary)">${v.score.toFixed(1)}</div>
              <button class="btn btn-ghost btn-sm" style="padding:2px 8px;font-size:11px" onclick="manualAssign(${taskId}, ${v.id})">Assign</button>
            </div>
          </div>
        `).join('')}
      </div>
    `;
    footer.innerHTML = `<button class="btn btn-ghost" onclick="closeModal('assignModal')">Close</button>`;
  } catch (e) { body.innerHTML = '<p class="error">Failed to load recommendations.</p>'; }
}

async function autoAssign(taskId) {
  try {
    const isEmergency = document.getElementById('emergencyToggle').checked;
    const res = await apiFetch(`/api/tasks/${taskId}/auto-assign`, {
      method: 'POST',
      body: JSON.stringify({ emergencyMode: isEmergency })
    });
    const d = await res.json();
    if (res.ok) {
      showToast(`Assigned to ${d.volunteer.name} (Score: ${d.volunteer.score})`, 'success');
      closeModal('assignModal');
      loadTasks();
      socket?.emit('task_update', { taskId, action: 'assigned' });
    } else {
      alert(d.error);
    }
  } catch (e) {}
}

async function manualAssign(taskId, volId) {
  try {
    const res = await apiFetch(`/api/tasks/${taskId}/manual-assign`, {
      method: 'POST',
      body: JSON.stringify({ volunteer_id: volId })
    });
    if (res.ok) {
      showToast('Volunteer assigned.', 'success');
      closeModal('assignModal');
      loadTasks();
      socket?.emit('task_update', { taskId, action: 'assigned' });
    }
  } catch (e) {}
}

// ── VOLUNTEERS ────────────────────────────────────────────────────────────────
async function loadVolunteers() {
  try {
    const res = await apiFetch('/api/admin/volunteers');
    allVolunteers = await res.json();
    renderVolunteers();
  } catch (e) {}
}

function renderVolunteers() {
  const tbody = document.getElementById('volTableBody');
  if (!tbody) return;
  
  const search = document.getElementById('volSearch').value.toLowerCase();
  const filter = document.getElementById('volAvailFilter').value;
  
  const filtered = allVolunteers.filter(v => {
    const matchesSearch = v.name.toLowerCase().includes(search) || 
                          v.skills.some(s => s.toLowerCase().includes(search));
    const matchesFilter = filter === 'all' || v.availability === filter;
    return matchesSearch && matchesFilter;
  });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;padding:32px">No volunteers found</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(v => `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:10px">
          <div style="width:30px;height:30px;border-radius:50%;background:rgba(108,99,255,0.1);color:var(--primary);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:12px">${v.name[0]}</div>
          <div><div style="font-weight:600">${v.name}</div><div style="font-size:11px;color:var(--text-muted)">${v.email}</div></div>
        </div>
      </td>
      <td><div style="display:flex;flex-wrap:wrap;gap:4px">${v.skills.slice(0,3).map(s => `<span class="skill-tag">${s}</span>`).join('')}${v.skills.length > 3 ? '...' : ''}</div></td>
      <td><span class="status-badge ${v.availability}">${v.availability}</span></td>
      <td><span class="status-dot ${v.is_online ? 'online' : 'offline'}"></span> ${v.is_online ? 'Online' : 'Offline'}</td>
      <td style="text-align:center">${v.tasks_completed}</td>
      <td><button class="btn btn-ghost btn-sm" onclick="viewVolunteer(${v.id})"><i class="fas fa-eye"></i></button></td>
    </tr>
  `).join('');
}

function filterVolunteers() { renderVolunteers(); }

function viewVolunteer(id) {
  // Could open a detail modal here
  showToast('Volunteer details feature coming soon!', 'info');
}

// ── MAP ────────────────────────────────────────────────────────────────────────
async function initMap() {
  if (adminMap) return;
  adminMap = L.map('mapContainer').setView([28.6139, 77.2090], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(adminMap);
  await refreshMapData();
}

async function refreshMapData() {
  if (!adminMap) return;
  try {
    const res = await apiFetch('/api/tasks/map-data');
    const { tasks, volunteers } = await res.json();
    
    // Clear existing
    adminMap.eachLayer(layer => {
      if (layer instanceof L.Marker || layer instanceof L.CircleMarker) adminMap.removeLayer(layer);
    });

    // Draw tasks
    tasks.forEach(t => {
      if (!t.latitude) return;
      const col = t.urgency === 'high' ? '#ef4444' : t.urgency === 'medium' ? '#f59e0b' : '#22c55e';
      L.circleMarker([t.latitude, t.longitude], {
        radius: 12, color: col, fillColor: col, fillOpacity: 0.6, weight: 2
      }).addTo(adminMap).bindPopup(`<strong>TASK: ${t.title}</strong><br>Status: ${t.status}<br>Vol: ${t.volunteer_name || 'None'}`);
    });

    // Draw volunteers
    volunteers.forEach(v => {
      if (!v.latitude) return;
      const col = v.is_online ? '#6c63ff' : '#94a3b8';
      L.marker([v.latitude, v.longitude], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:${col};width:16px;height:16px;border-radius:50%;border:2px solid white;box-shadow:0 0 5px rgba(0,0,0,0.3)"></div>`,
          iconSize: [16, 16]
        })
      }).addTo(adminMap).bindPopup(`<strong>VOLUNTEER: ${v.name}</strong><br>Status: ${v.availability}`);
    });
  } catch (e) {}
}

// ── EMERGENCY & BROADCAST ─────────────────────────────────────────────────────
async function checkEmergencyStatus() {
  try {
    const res = await apiFetch('/api/admin/emergency/status');
    const d = await res.json();
    document.getElementById('emergencyToggle').checked = d.active;
    document.getElementById('emergencyNavBadge').style.display = d.active ? 'flex' : 'none';
  } catch (e) {}
}

async function toggleEmergency(active) {
  try {
    const res = await apiFetch('/api/admin/emergency', {
      method: 'POST',
      body: JSON.stringify({ active, title: 'Emergency Response Activated', description: 'Immediate assistance required in multiple sectors.' })
    });
    if (res.ok) {
      document.getElementById('emergencyNavBadge').style.display = active ? 'flex' : 'none';
      showToast(active ? 'EMERGENCY MODE ACTIVE' : 'Emergency mode deactivated', active ? 'error' : 'info');
      socket?.emit('emergency_broadcast', { active, title: 'Emergency Alert' });
      loadStats();
    }
  } catch (e) {}
}

async function deactivateEmergency() {
  document.getElementById('emergencyToggle').checked = false;
  await toggleEmergency(false);
}

async function sendBroadcast() {
  const title = document.getElementById('bcTitle').value;
  const message = document.getElementById('bcMessage').value;
  const type = document.getElementById('bcType').value;
  
  if (!title || !message) return alert('Title and message required.');

  try {
    const res = await apiFetch('/api/admin/broadcast', {
      method: 'POST',
      body: JSON.stringify({ title, message, type })
    });
    if (res.ok) {
      showToast('Broadcast sent!', 'success');
      document.getElementById('bcTitle').value = '';
      document.getElementById('bcMessage').value = '';
    }
  } catch (e) {}
}

// ── NOTIFICATIONS ─────────────────────────────────────────────────────────────
let notifications = [];
async function loadNotifications() {
  try {
    const res = await apiFetch('/api/admin/notifications');
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
  if (!notifications.length) {
    list.innerHTML = '<div class="notif-empty"><i class="fas fa-bell-slash"></i><p>No notifications</p></div>';
    return;
  }
  
  list.innerHTML = notifications.map(n => `
    <div class="notif-item ${n.is_read ? '' : 'unread'} ${n.type === 'emergency' ? 'emergency' : ''}">
      <div class="notif-item-title">${n.title}</div>
      <div class="notif-item-msg">${n.message}</div>
      <div class="notif-item-time">${timeAgo(n.created_at)}</div>
    </div>
  `).join('');
}

async function markAllRead() {
  await apiFetch('/api/admin/notifications/read', { method: 'PUT' });
  notifications.forEach(n => n.is_read = 1);
  renderNotifications();
}

document.getElementById('notifBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('notifPanel').classList.toggle('hidden');
});
document.addEventListener('click', () => document.getElementById('notifPanel').classList.add('hidden'));

// ── SOCKET ─────────────────────────────────────────────────────────────────────
function initSocket() {
  socket = io();
  socket.emit('register', user.id);
  socket.on('notification', (n) => {
    notifications.unshift(n);
    renderNotifications();
    showToast(n.title, 'info');
  });
  socket.on('task_changed', () => {
    loadTasks();
    loadStats();
  });
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

function showFormAlert(id, msg) {
  const al = document.getElementById(id);
  al.textContent = msg;
  al.classList.remove('hidden');
  setTimeout(() => al.classList.add('hidden'), 4000);
}

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
  setTimeout(() => { toast.style.opacity = '0'; }, 4000);
}

function timeAgo(dt) {
  const diff = (Date.now() - new Date(dt)) / 1000;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`;
  return new Date(dt).toLocaleDateString();
}

function logout() {
  localStorage.clear();
  window.location.href = '/login';
}
