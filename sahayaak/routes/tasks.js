const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// ─── SMART MATCHING ENGINE ────────────────────────────────────────────────────
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function scoreVolunteer(volunteer, task, emergencyMode = false) {
  const requiredSkills = JSON.parse(task.required_skills || '[]');
  const volunteerSkills = JSON.parse(volunteer.skills || '[]');

  // Skill Match (0–1)
  let skillMatch = 0;
  if (requiredSkills.length > 0) {
    const matched = requiredSkills.filter(s => volunteerSkills.includes(s)).length;
    skillMatch = matched / requiredSkills.length;
  } else {
    skillMatch = 1; // No skill required = anyone qualifies
  }

  // Distance Score (0–1), max useful range 50km
  let distScore = 0;
  let dist = 0;
  if (volunteer.latitude && volunteer.longitude && task.latitude && task.longitude) {
    dist = haversineDistance(volunteer.latitude, volunteer.longitude, task.latitude, task.longitude);
    distScore = Math.max(0, 1 - dist / 50);
  } else {
    // If location is missing, assume maximum distance (0 score for distance)
    dist = 999;
    distScore = 0;
  }

  // Availability (0–1)
  const availScore = volunteer.availability === 'available' ? 1 : volunteer.availability === 'busy' ? 0.3 : 0;
  const onlineBonus = volunteer.is_online ? 1 : 0.5;

  // Score = (Skill×5) + (Distance×3) + (Availability×2)
  let score = (skillMatch * 5) + (distScore * 3) + (availScore * onlineBonus * 2);

  // Emergency boost: online & nearest get 2x weight
  if (emergencyMode) {
    score = (skillMatch * 4) + (distScore * 5) + (availScore * onlineBonus * 3);
  }

  return { score, skillMatch, distScore, availScore, distance: dist.toFixed(1) };
}

function findBestVolunteer(task, emergencyMode = false) {
  const volunteers = db.prepare(`
    SELECT vp.*, u.name, u.email, u.id as user_id
    FROM volunteer_profiles vp
    JOIN users u ON vp.user_id = u.id
    WHERE vp.availability != 'unavailable'
    AND u.id NOT IN (
      SELECT COALESCE(assigned_volunteer_id, 0) FROM tasks 
      WHERE status IN ('assigned','in-progress') AND assigned_volunteer_id IS NOT NULL
    )
  `).all();

  if (volunteers.length === 0) return null;

  let best = null;
  let bestScore = -1;
  for (const vol of volunteers) {
    const { score } = scoreVolunteer(vol, task, emergencyMode);
    if (score > bestScore) {
      bestScore = score;
      best = { ...vol, score: score.toFixed(2) };
    }
  }
  return best;
}

// ─── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/tasks - all tasks (admin) or assigned tasks filtered
router.get('/', authenticateToken, (req, res) => {
  try {
    let tasks;
    if (req.user.role === 'admin') {
      tasks = db.prepare(`
        SELECT t.*, u.name as volunteer_name, c.name as creator_name
        FROM tasks t
        LEFT JOIN users u ON t.assigned_volunteer_id = u.id
        LEFT JOIN users c ON t.created_by = c.id
        ORDER BY CASE t.urgency WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END, t.created_at DESC
      `).all();
    } else {
      tasks = db.prepare(`
        SELECT t.*, u.name as creator_name FROM tasks t
        LEFT JOIN users u ON t.created_by = u.id
        WHERE t.assigned_volunteer_id = ?
        ORDER BY t.created_at DESC
      `).all(req.user.id);
    }
    res.json(tasks.map(t => ({ ...t, required_skills: JSON.parse(t.required_skills || '[]') })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks.' });
  }
});

// POST /api/tasks - create task (admin only)
router.post('/', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { title, description, urgency, required_skills, latitude, longitude, location_name, estimated_duration } = req.body;
    if (!title || !description) return res.status(400).json({ error: 'Title and description required.' });

    const result = db.prepare(`
      INSERT INTO tasks (title, description, urgency, required_skills, latitude, longitude, location_name, created_by, estimated_duration)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(title, description, urgency || 'medium', JSON.stringify(required_skills || []),
      latitude || 0, longitude || 0, location_name || '', req.user.id, estimated_duration || 60);

    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json({ ...task, required_skills: JSON.parse(task.required_skills || '[]') });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create task.' });
  }
});

// PUT /api/tasks/:id - update task
router.put('/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { title, description, urgency, required_skills, latitude, longitude, location_name, estimated_duration } = req.body;
    db.prepare(`
      UPDATE tasks SET title=?, description=?, urgency=?, required_skills=?, latitude=?, longitude=?, location_name=?, estimated_duration=?
      WHERE id=?
    `).run(title, description, urgency, JSON.stringify(required_skills || []), latitude, longitude, location_name, estimated_duration, req.params.id);
    res.json({ message: 'Task updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update task.' });
  }
});

// DELETE /api/tasks/:id
router.delete('/:id', authenticateToken, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM tasks WHERE id = ?').run(req.params.id);
  res.json({ message: 'Task deleted.' });
});

// POST /api/tasks/:id/auto-assign - smart auto assignment
router.post('/:id/auto-assign', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { emergencyMode } = req.body;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    if (task.status !== 'open') return res.status(400).json({ error: 'Task is not open for assignment.' });

    const best = findBestVolunteer(task, emergencyMode);
    if (!best) return res.status(404).json({ error: 'No available volunteers found.' });

    const now = new Date().toISOString();
    db.prepare("UPDATE tasks SET assigned_volunteer_id=?, status='assigned', assigned_at=? WHERE id=?")
      .run(best.user_id, now, task.id);
    db.prepare("INSERT INTO task_history (task_id, volunteer_id, action, notes) VALUES (?, ?, 'auto_assigned', ?)")
      .run(task.id, best.user_id, `Score: ${best.score}${emergencyMode ? ' [EMERGENCY]' : ''}`);

    // Notify the volunteer
    db.prepare('INSERT INTO notifications (user_id, title, message, type, task_id) VALUES (?, ?, ?, ?, ?)')
      .run(best.user_id,
        emergencyMode ? '🚨 EMERGENCY Task Assigned' : 'New Task Assigned',
        `You have been assigned: "${task.title}" (${task.urgency} priority)${emergencyMode ? ' — EMERGENCY MODE' : ''}`,
        emergencyMode ? 'emergency' : 'task',
        task.id);

    res.json({ message: 'Volunteer auto-assigned successfully.', volunteer: { id: best.user_id, name: best.name, score: best.score } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Auto-assign failed.' });
  }
});

// POST /api/tasks/:id/manual-assign - manual assignment
router.post('/:id/manual-assign', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { volunteer_id } = req.body;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });

    const volunteer = db.prepare('SELECT * FROM users WHERE id = ? AND role = ?').get(volunteer_id, 'volunteer');
    if (!volunteer) return res.status(404).json({ error: 'Volunteer not found.' });

    const now = new Date().toISOString();
    db.prepare("UPDATE tasks SET assigned_volunteer_id=?, status='assigned', assigned_at=? WHERE id=?")
      .run(volunteer_id, now, task.id);
    db.prepare("INSERT INTO task_history (task_id, volunteer_id, action) VALUES (?, ?, 'manual_assigned')")
      .run(task.id, volunteer_id);
    db.prepare('INSERT INTO notifications (user_id, title, message, type, task_id) VALUES (?, ?, ?, ?, ?)')
      .run(volunteer_id, 'Task Assigned to You', `Admin assigned you: "${task.title}"`, 'task', task.id);

    res.json({ message: 'Volunteer manually assigned.' });
  } catch (err) {
    res.status(500).json({ error: 'Manual assign failed.' });
  }
});

// GET /api/tasks/:id/score-volunteers - get scored list
router.get('/:id/score-volunteers', authenticateToken, requireAdmin, (req, res) => {
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });

    const volunteers = db.prepare(`
      SELECT vp.*, u.name, u.email, u.id as user_id
      FROM volunteer_profiles vp JOIN users u ON vp.user_id = u.id
      WHERE vp.availability != 'unavailable'
    `).all();

    const scored = volunteers.map(v => {
      const metrics = scoreVolunteer(v, task);
      return {
        id: v.user_id, name: v.name, email: v.email,
        availability: v.availability, is_online: v.is_online,
        latitude: v.latitude, longitude: v.longitude,
        location_name: v.location_name,
        skills: JSON.parse(v.skills || '[]'),
        ...metrics
      };
    }).sort((a, b) => b.score - a.score);

    res.json(scored);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to score volunteers.' });
  }
});

// GET /api/tasks/map-data - all locations for map
router.get('/map/data', authenticateToken, (req, res) => {
  try {
    const tasks = db.prepare(`
      SELECT t.id, t.title, t.status, t.urgency, t.latitude, t.longitude, t.location_name,
             u.name as volunteer_name
      FROM tasks t LEFT JOIN users u ON t.assigned_volunteer_id = u.id
      WHERE t.status != 'completed'
    `).all();
    const volunteers = db.prepare(`
      SELECT vp.user_id as id, u.name, vp.latitude, vp.longitude, vp.location_name,
             vp.availability, vp.is_online
      FROM volunteer_profiles vp JOIN users u ON vp.user_id = u.id
    `).all();
    res.json({ tasks, volunteers });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch map data.' });
  }
});

// POST /api/tasks/:id/verify - admin verify completion
router.post('/:id/verify', authenticateToken, requireAdmin, (req, res) => {
  try {
    const taskId = req.params.id;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    if (task.status !== 'pending-verification') return res.status(400).json({ error: 'Task is not pending verification.' });

    const now = new Date().toISOString();
    const assignedAt = task.assigned_at ? new Date(task.assigned_at).getTime() : Date.now();
    const responseTime = Math.round((Date.now() - assignedAt) / 60000); // minutes

    // 1. Mark as completed
    db.prepare("UPDATE tasks SET status = 'completed', response_time = ? WHERE id = ?").run(responseTime, taskId);
    
    // 2. Increase points and tasks_completed
    const pointsToAdd = task.urgency === 'high' ? 50 : task.urgency === 'medium' ? 30 : 10;
    db.prepare("UPDATE volunteer_profiles SET tasks_completed = tasks_completed + 1, points = points + ? WHERE user_id = ?")
      .run(pointsToAdd, task.assigned_volunteer_id);
    
    db.prepare("INSERT INTO task_history (task_id, volunteer_id, action, notes) VALUES (?, ?, 'verified', ?)")
      .run(taskId, task.assigned_volunteer_id, `Awarded ${pointsToAdd} points.`);

    // 3. Notify volunteer
    db.prepare('INSERT INTO notifications (user_id, title, message, type, task_id) VALUES (?, ?, ?, ?, ?)')
      .run(task.assigned_volunteer_id, 'Task Verified! 🏆', `Your completion of "${task.title}" has been verified. You earned ${pointsToAdd} points!`, 'success', taskId);

    res.json({ message: 'Task completion verified and points awarded.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Verification failed.' });
  }
});

module.exports = router;
