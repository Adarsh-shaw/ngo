require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST', 'PUT', 'DELETE'] }
});

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Routes
const authRoutes = require('./routes/auth');
const volunteerRoutes = require('./routes/volunteers');
const taskRoutes = require('./routes/tasks');
const adminRoutes = require('./routes/admin');
const analyticsRoutes = require('./routes/analytics');

app.use('/api/auth', authRoutes);
app.use('/api/volunteers', volunteerRoutes);
app.use('/api/tasks', taskRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/analytics', analyticsRoutes);

// Socket.io real-time
const connectedUsers = {}; // userId -> socketId

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);

  socket.on('register', (userId) => {
    connectedUsers[userId] = socket.id;
    socket.userId = userId;
    console.log(`User ${userId} registered with socket ${socket.id}`);
    io.emit('online_users', Object.keys(connectedUsers));
  });

  socket.on('send_notification', ({ targetUserId, notification }) => {
    const targetSocket = connectedUsers[targetUserId];
    if (targetSocket) {
      io.to(targetSocket).emit('notification', notification);
    }
  });

  socket.on('emergency_broadcast', (data) => {
    io.emit('emergency_alert', data);
  });

  socket.on('task_update', (data) => {
    io.emit('task_changed', data);
  });

  socket.on('disconnect', () => {
    if (socket.userId) {
      delete connectedUsers[socket.userId];
      io.emit('online_users', Object.keys(connectedUsers));
    }
    console.log('Client disconnected:', socket.id);
  });
});

// Make io accessible from routes
app.set('io', io);
app.set('connectedUsers', connectedUsers);

// Serve frontend pages
const pages = ['index', 'login', 'signup', 'volunteer-dashboard', 'admin-dashboard'];
pages.forEach(page => {
  app.get(`/${page === 'index' ? '' : page}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
  });
});

// Fallback
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Sahaayak Server running at http://localhost:${PORT}`);
  console.log(`📊 Admin Login:    admin@sahaayak.org / admin123`);
  console.log(`👤 Volunteer Login: priya@demo.com / vol123\n`);
});
