const LokiDatabase = require('./loki-db');
const path = require('path');

const dbPath = path.join(__dirname, 'sahaayak.db');
const db = new LokiDatabase(dbPath);

// Initialize tables (handled by Loki internally, but keep for compatibility)
db.exec(`INIT SCHEMA`);

// Seed demo data if empty
const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
if (userCount && userCount.count === 0) {
  const bcrypt = require('bcryptjs');
  const adminPass = bcrypt.hashSync('admin123', 10);
  const volPass = bcrypt.hashSync('vol123', 10);

  // Insert admin
  const adminInsert = db.prepare(`INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)`);
  adminInsert.run('Admin NGO', 'admin@sahaayak.org', adminPass, 'admin', '+91-9000000000');

  // Insert volunteers
  const volInsert = db.prepare(`INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)`);
  const profileInsert = db.prepare(`INSERT INTO volunteer_profiles (user_id, skills, availability, latitude, longitude, location_name, bio, tasks_completed, is_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  const volunteers = [
    { name: 'Priya Sharma', email: 'priya@demo.com', phone: '+91-9111111111', skills: ['first-aid', 'medical', 'counseling'], lat: 28.6139, lng: 77.2090, loc: 'Connaught Place, Delhi', bio: 'Certified first-aid provider with 3 years experience.', completed: 12, online: 1 },
    { name: 'Rahul Verma', email: 'rahul@demo.com', phone: '+91-9222222222', skills: ['logistics', 'driving', 'heavy-lifting'], lat: 28.6200, lng: 77.2100, loc: 'Karol Bagh, Delhi', bio: 'Logistics expert and licensed driver.', completed: 8, online: 1 },
    { name: 'Anjali Singh', email: 'anjali@demo.com', phone: '+91-9333333333', skills: ['teaching', 'counseling', 'coordination'], lat: 28.6080, lng: 77.2180, loc: 'Lajpat Nagar, Delhi', bio: 'Teacher and mental health counselor.', completed: 15, online: 0 },
  ];

  for (const v of volunteers) {
    const { lastInsertRowid } = volInsert.run(v.name, v.email, volPass, 'volunteer', v.phone);
    profileInsert.run(lastInsertRowid, JSON.stringify(v.skills), 'available', v.lat, v.lng, v.loc, v.bio, v.completed, v.online);
  }

  // Insert sample tasks
  const taskInsert = db.prepare(`INSERT INTO tasks (title, description, urgency, required_skills, latitude, longitude, location_name, created_by, estimated_duration) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  taskInsert.run('Medical Camp Setup', 'Set up a medical camp for flood victims in Yamuna bank area.', 'high', JSON.stringify(['medical', 'first-aid']), 28.6400, 77.2100, 'Yamuna Bank, Delhi', 1, 120);
  taskInsert.run('Food Distribution', 'Distribute food packets to 500 families in the relief camp.', 'medium', JSON.stringify(['logistics', 'coordination']), 28.6250, 77.2150, 'Relief Camp A, Delhi', 1, 90);
}

module.exports = db;
