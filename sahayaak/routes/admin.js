const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/admin/volunteers - list all volunteers with profiles
router.get('/volunteers', authenticateToken, requireAdmin, (req, res) => {
  try {
    const volunteers = db.prepare(`
      SELECT u.id, u.name, u.email, u.phone, u.created_at,
             vp.skills, vp.availability, vp.latitude, vp.longitude,
             vp.location_name, vp.bio, vp.rating, vp.tasks_completed, vp.is_online, vp.last_seen
      FROM users u
      LEFT JOIN volunteer_profiles vp ON u.id = vp.user_id
      WHERE u.role = 'volunteer'
      ORDER BY vp.is_online DESC, u.name ASC
    `).all();
    res.json(volunteers.map(v => ({ ...v, skills: JSON.parse(v.skills || '[]') })));
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch volunteers.' });
  }
});

// GET /api/admin/volunteers/:id - single volunteer detail
router.get('/volunteers/:id', authenticateToken, requireAdmin, (req, res) => {
  try {
    const vol = db.prepare(`
      SELECT u.id, u.name, u.email, u.phone, vp.*
      FROM users u LEFT JOIN volunteer_profiles vp ON u.id = vp.user_id
      WHERE u.id = ? AND u.role = 'volunteer'
    `).get(req.params.id);
    if (!vol) return res.status(404).json({ error: 'Volunteer not found.' });

    const taskHistory = db.prepare(`
      SELECT t.title, t.urgency, t.status, th.action, th.created_at
      FROM task_history th JOIN tasks t ON th.task_id = t.id
      WHERE th.volunteer_id = ? ORDER BY th.created_at DESC LIMIT 20
    `).all(req.params.id);

    res.json({ ...vol, skills: JSON.parse(vol.skills || '[]'), taskHistory });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch volunteer.' });
  }
});

// POST /api/admin/emergency - toggle emergency mode
router.post('/emergency', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { active, title, description } = req.body;
    if (active) {
      db.prepare("UPDATE emergency_events SET is_active = 0 WHERE is_active = 1").run();
      db.prepare("INSERT INTO emergency_events (title, description, created_by) VALUES (?, ?, ?)")
        .run(title || 'Emergency Activated', description || '', req.user.id);

      // Notify ALL volunteers
      const volunteers = db.prepare("SELECT id FROM users WHERE role = 'volunteer'").all();
      for (const v of volunteers) {
        db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)').run(
          v.id, '🚨 EMERGENCY ALERT', `Emergency mode activated: ${title || 'Please report for duty immediately!'}`, 'emergency'
        );
      }
      res.json({ message: 'Emergency mode ACTIVATED. All volunteers notified.' });
    } else {
      db.prepare("UPDATE emergency_events SET is_active = 0, ended_at = CURRENT_TIMESTAMP WHERE is_active = 1").run();
      res.json({ message: 'Emergency mode deactivated.' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to toggle emergency mode.' });
  }
});

// GET /api/admin/emergency/status
router.get('/emergency/status', authenticateToken, (req, res) => {
  try {
    const emergency = db.prepare("SELECT * FROM emergency_events WHERE is_active = 1 ORDER BY created_at DESC LIMIT 1").get();
    res.json({ active: !!emergency, event: emergency || null });
  } catch (err) {
    res.status(500).json({ error: 'Failed to get emergency status.' });
  }
});

// POST /api/admin/broadcast - send notification to all volunteers
router.post('/broadcast', authenticateToken, requireAdmin, (req, res) => {
  try {
    const { title, message, type } = req.body;
    const volunteers = db.prepare("SELECT id FROM users WHERE role = 'volunteer'").all();
    for (const v of volunteers) {
      db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)')
        .run(v.id, title, message, type || 'info');
    }
    res.json({ message: `Broadcast sent to ${volunteers.length} volunteers.` });
  } catch (err) {
    res.status(500).json({ error: 'Broadcast failed.' });
  }
});

// GET /api/admin/notifications - admin notifications
router.get('/notifications', authenticateToken, requireAdmin, (req, res) => {
  try {
    const notifs = db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
    res.json(notifs);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch notifications.' });
  }
});

// PUT /api/admin/notifications/read
router.put('/notifications/read', authenticateToken, requireAdmin, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.user.id);
  res.json({ message: 'All marked as read.' });
});

module.exports = router;
