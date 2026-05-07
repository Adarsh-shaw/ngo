const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

// GET /api/analytics/overview
router.get('/overview', authenticateToken, requireAdmin, (req, res) => {
  try {
    const totalVolunteers = db.prepare("SELECT COUNT(*) as count FROM users WHERE role='volunteer'").get().count;
    const activeVolunteers = db.prepare("SELECT COUNT(*) as count FROM volunteer_profiles WHERE is_online=1").get().count;
    const availableVolunteers = db.prepare("SELECT COUNT(*) as count FROM volunteer_profiles WHERE availability='available'").get().count;
    const totalTasks = db.prepare("SELECT COUNT(*) as count FROM tasks").get().count;
    const openTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status='open'").get().count;
    const assignedTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status='assigned' OR status='in-progress'").get().count;
    const completedTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE status='completed'").get().count;
    const avgRow = db.prepare("SELECT AVG(response_time) as avg FROM tasks WHERE response_time IS NOT NULL AND status='completed'").get();
    const avgResponse = avgRow ? avgRow.avg : 0;
    const highUrgency = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE urgency='high' AND status!='completed'").get().count;

    // Tasks by urgency
    const tasksByUrgency = db.prepare("SELECT urgency, COUNT(*) as count FROM tasks GROUP BY urgency").all();

    // Tasks by status
    const tasksByStatus = db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status").all();

    // Top volunteers
    const topVolunteers = db.prepare(`
      SELECT u.name, vp.tasks_completed, vp.rating
      FROM volunteer_profiles vp JOIN users u ON vp.user_id = u.id
      ORDER BY vp.tasks_completed DESC LIMIT 5
    `).all();

    // Tasks created over last 7 days
    const tasksOverTime = db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM tasks
      WHERE created_at >= date('now', '-7 days')
      GROUP BY day ORDER BY day ASC
    `).all();

    // Skills demand
    const allTasks = db.prepare("SELECT required_skills FROM tasks").all();
    const skillCount = {};
    for (const t of allTasks) {
      const skills = JSON.parse(t.required_skills || '[]');
      for (const s of skills) {
        skillCount[s] = (skillCount[s] || 0) + 1;
      }
    }
    const skillDemand = Object.entries(skillCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([skill, count]) => ({ skill, count }));

    // Response time trend (last 10 completed tasks)
    const responseTrend = db.prepare(`
      SELECT t.title, t.response_time, t.completed_at
      FROM tasks t WHERE t.response_time IS NOT NULL
      ORDER BY t.completed_at DESC LIMIT 10
    `).all();

    res.json({
      totalVolunteers, activeVolunteers, availableVolunteers,
      totalTasks, openTasks, assignedTasks, completedTasks,
      avgResponseTime: avgResponse ? Math.round(avgResponse) : 0,
      highUrgency, tasksByUrgency, tasksByStatus,
      topVolunteers, tasksOverTime, skillDemand, responseTrend
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch analytics.' });
  }
});

// GET /api/analytics/volunteer/:id
router.get('/volunteer/:id', authenticateToken, (req, res) => {
  try {
    const profile = db.prepare("SELECT * FROM volunteer_profiles WHERE user_id = ?").get(req.params.id);
    const assignedTasks = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_volunteer_id = ?").get(req.params.id).count;
    const inProgress = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_volunteer_id = ? AND status = 'in-progress'").get(req.params.id).count;
    const completed = db.prepare("SELECT COUNT(*) as count FROM tasks WHERE assigned_volunteer_id = ? AND status = 'completed'").get(req.params.id).count;
    const avgRespRow = db.prepare("SELECT AVG(response_time) as avg FROM tasks WHERE assigned_volunteer_id = ? AND response_time IS NOT NULL").get(req.params.id);
    const avgResp = avgRespRow ? avgRespRow.avg : 0;
    res.json({ assignedTasks, inProgress, completed, avgResponseTime: avgResp ? Math.round(avgResp) : 0, profile });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch volunteer analytics.' });
  }
});

module.exports = router;
