const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// GET /api/volunteers/profile
router.get('/profile', authenticateToken, (req, res) => {
  try {
    const user = db.prepare('SELECT id, name, email, phone, role, created_at FROM users WHERE id = ?').get(req.user.id);
    const profile = db.prepare('SELECT * FROM volunteer_profiles WHERE user_id = ?').get(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    const result = { ...user, profile: profile ? { ...profile, skills: JSON.parse(profile.skills || '[]') } : null };
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch profile.' });
  }
});

// PUT /api/volunteers/profile
router.put('/profile', authenticateToken, (req, res) => {
  try {
    const { name, phone, skills, availability, latitude, longitude, location_name, bio } = req.body;
    db.prepare('UPDATE users SET name = ?, phone = ? WHERE id = ?').run(name, phone, req.user.id);
    db.prepare(`UPDATE volunteer_profiles SET skills = ?, availability = ?, latitude = ?, longitude = ?, location_name = ?, bio = ? WHERE user_id = ?`)
      .run(JSON.stringify(skills || []), availability || 'available', latitude || 0, longitude || 0, location_name || '', bio || '', req.user.id);
    res.json({ message: 'Profile updated successfully.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// GET /api/volunteers/tasks - get assigned tasks for the volunteer
router.get('/tasks', authenticateToken, (req, res) => {
  try {
    const tasks = db.prepare(`
      SELECT t.*, u.name as creator_name 
      FROM tasks t 
      LEFT JOIN users u ON t.created_by = u.id 
      WHERE t.assigned_volunteer_id = ? 
      ORDER BY 
        CASE t.urgency WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
        t.created_at DESC
    `).all(req.user.id);
    const parsed = tasks.map(t => ({ ...t, required_skills: JSON.parse(t.required_skills || '[]') }));
    res.json(parsed);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch tasks.' });
  }
});

// PUT /api/volunteers/tasks/:id/respond - accept or reject
router.put('/tasks/:id/respond', authenticateToken, (req, res) => {
  try {
    const { action } = req.body; // 'accept' or 'reject'
    const taskId = req.params.id;
    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND assigned_volunteer_id = ?').get(taskId, req.user.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    if (task.status !== 'assigned') return res.status(400).json({ error: 'Task is not in assigned state.' });

    if (action === 'accept') {
      db.prepare("UPDATE tasks SET status = 'in-progress' WHERE id = ?").run(taskId);
      db.prepare("INSERT INTO task_history (task_id, volunteer_id, action) VALUES (?, ?, 'accepted')").run(taskId, req.user.id);
      // Notify admin
      const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
      for (const admin of admins) {
        db.prepare('INSERT INTO notifications (user_id, title, message, type, task_id) VALUES (?, ?, ?, ?, ?)').run(admin.id, 'Task Accepted', `${req.user.name} accepted task: ${task.title}`, 'success', taskId);
      }
      res.json({ message: 'Task accepted. Status updated to in-progress.' });
    } else if (action === 'reject') {
      db.prepare("UPDATE tasks SET status = 'open', assigned_volunteer_id = NULL, assigned_at = NULL WHERE id = ?").run(taskId);
      db.prepare("INSERT INTO task_history (task_id, volunteer_id, action) VALUES (?, ?, 'rejected')").run(taskId, req.user.id);
      res.json({ message: 'Task rejected. It will be reassigned.' });
    } else {
      res.status(400).json({ error: 'Invalid action.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update task.' });
  }
});

// PUT /api/volunteers/tasks/:id/status - update task status
router.put('/tasks/:id/status', authenticateToken, (req, res) => {
  try {
    const { status } = req.body;
    const taskId = req.params.id;
    const validStatuses = ['in-progress', 'pending-verification'];
    if (!validStatuses.includes(status)) return res.status(400).json({ error: 'Invalid status.' });

    const task = db.prepare('SELECT * FROM tasks WHERE id = ? AND assigned_volunteer_id = ?').get(taskId, req.user.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });

    if (status === 'pending-verification') {
      const now = new Date().toISOString();
      db.prepare("UPDATE tasks SET status = 'pending-verification', completed_at = ? WHERE id = ?").run(now, taskId);
      db.prepare("INSERT INTO task_history (task_id, volunteer_id, action) VALUES (?, ?, 'pending_verification')").run(taskId, req.user.id);

      const admins = db.prepare("SELECT id FROM users WHERE role = 'admin'").all();
      for (const admin of admins) {
        db.prepare('INSERT INTO notifications (user_id, title, message, type, task_id) VALUES (?, ?, ?, ?, ?)').run(admin.id, 'Task Verification Required', `${req.user.name} marked task "${task.title}" as complete. Verification needed.`, 'warning', taskId);
      }
      res.json({ message: 'Task submitted for NGO verification.' });
    } else {
      db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);
      db.prepare("INSERT INTO task_history (task_id, volunteer_id, action, notes) VALUES (?, ?, 'status_update', ?)").run(taskId, req.user.id, status);
      res.json({ message: `Task status updated to ${status}.` });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update status.' });
  }
});

// GET /api/volunteers/notifications
router.get('/notifications', authenticateToken, (req, res) => {
  try {
    const notifs = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// PUT /api/volunteers/notifications/read
router.put('/notifications/read', authenticateToken, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'Marked all as read.' });
});

// PUT /api/volunteers/location
router.put('/location', authenticateToken, (req, res) => {
  try {
    const { latitude, longitude, location_name } = req.body;
    db.prepare('UPDATE volunteer_profiles SET latitude = ?, longitude = ?, location_name = ?, last_seen = CURRENT_TIMESTAMP WHERE user_id = ?')
      .run(latitude, longitude, location_name || '', req.user.id);
    res.json({ message: 'Location updated.' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update location.' });
  }
});

module.exports = router;
