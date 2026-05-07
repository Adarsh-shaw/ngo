const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const { JWT_SECRET } = require('../middleware/auth');
const admin = require('firebase-admin');

// Initialize Firebase Admin (requires service account key)
try {
  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
    });
    console.log("Firebase Admin initialized successfully.");
  } else {
    console.warn("FIREBASE_SERVICE_ACCOUNT env variable not found. Google login will not work.");
  }
} catch (error) {
  console.error("Failed to initialize Firebase Admin:", error);
}

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, phone, role } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ error: 'Name, email and password are required.' });
    }

    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) return res.status(409).json({ error: 'Email already registered.' });

    const hashed = bcrypt.hashSync(password, 10);
    const userRole = role === 'admin' ? 'volunteer' : (role || 'volunteer'); // prevent self-admin
    const stmt = db.prepare('INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)');
    const result = stmt.run(name, email, hashed, userRole, phone || '');
    const userId = result.lastInsertRowid;

    // Create volunteer profile
    db.prepare('INSERT INTO volunteer_profiles (user_id) VALUES (?)').run(userId);

    const token = jwt.sign({ id: userId, name, email, role: userRole }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: userId, name, email, role: userRole, phone } });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ error: 'Server error during signup.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required.' });

    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    if (!user) return res.status(401).json({ error: 'Invalid credentials.' });

    const valid = bcrypt.compareSync(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials.' });

    // Mark online
    db.prepare('UPDATE volunteer_profiles SET is_online = 1, last_seen = CURRENT_TIMESTAMP WHERE user_id = ?').run(user.id);

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone } });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Server error during login.' });
  }
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { idToken } = req.body;
    if (!idToken) return res.status(400).json({ error: 'idToken is required.' });

    if (!admin.apps.length) {
      return res.status(500).json({ error: 'Firebase Admin is not configured on the server.' });
    }

    // Verify token with Firebase
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const { email, name, picture, uid } = decodedToken;

    // Check if user exists
    let user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);

    if (!user) {
      // Create new volunteer user
      const hashed = bcrypt.hashSync(uid, 10); // Use uid as dummy password
      const stmt = db.prepare('INSERT INTO users (name, email, password, role, phone) VALUES (?, ?, ?, ?, ?)');
      const result = stmt.run(name || 'Google User', email, hashed, 'volunteer', '');
      const userId = result.lastInsertRowid;

      // Create volunteer profile
      db.prepare('INSERT INTO volunteer_profiles (user_id) VALUES (?)').run(userId);
      user = { id: userId, name: name || 'Google User', email, role: 'volunteer', phone: '' };
    }

    if (user.role === 'admin') {
      return res.status(403).json({ error: 'Admins cannot log in via Google.' });
    }

    // Mark online
    db.prepare('UPDATE volunteer_profiles SET is_online = 1, last_seen = CURRENT_TIMESTAMP WHERE user_id = ?').run(user.id);

    const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone } });
  } catch (err) {
    console.error('Google login error:', err);
    res.status(401).json({ error: 'Invalid Google token.' });
  }
});

// POST /api/auth/logout
router.post('/logout', (req, res) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      db.prepare('UPDATE volunteer_profiles SET is_online = 0, last_seen = CURRENT_TIMESTAMP WHERE user_id = ?').run(decoded.id);
    } catch (_) {}
  }
  res.json({ message: 'Logged out.' });
});

module.exports = router;
