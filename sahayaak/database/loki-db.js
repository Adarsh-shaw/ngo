const loki = require('lokijs');
const fs = require('fs');

class LokiDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath.replace('.db', '.loki');
    this.db = new loki(this.dbPath);
    if (fs.existsSync(this.dbPath)) {
      this.db.loadJSON(fs.readFileSync(this.dbPath, 'utf8'));
    }
    this.databaseInitialize();
  }

  databaseInitialize() {
    this.users = this.db.getCollection('users') || this.db.addCollection('users', { unique: ['email'] });
    this.profiles = this.db.getCollection('profiles') || this.db.addCollection('profiles', { unique: ['user_id'] });
    this.tasks = this.db.getCollection('tasks') || this.db.addCollection('tasks');
    this.notifications = this.db.getCollection('notifications') || this.db.addCollection('notifications');
    this.history = this.db.getCollection('history') || this.db.addCollection('history');
    this.emergencies = this.db.getCollection('emergencies') || this.db.addCollection('emergencies');
  }

  save() {
    fs.writeFileSync(this.dbPath, this.db.serialize());
  }

  exec() {}
  pragma() {}

  prepare(sql) {
    const self = this;
    return {
      run(...params) { const res = self._run(sql, params); self.save(); return res; },
      get(...params) { return self._get(sql, params); },
      all(...params) { return self._all(sql, params); }
    };
  }

  _run(sql, params) {
    const s = sql.toLowerCase();
    if (s.includes('insert into users')) {
      const doc = this.users.insert({ name: params[0], email: params[1], password: params[2], role: params[3], phone: params[4], created_at: new Date().toISOString() });
      return { lastInsertRowid: doc.$loki };
    }
    if (s.includes('insert into volunteer_profiles')) {
      const doc = this.profiles.insert({ user_id: parseInt(params[0]), skills: params[1], availability: params[2], latitude: params[3], longitude: params[4], location_name: params[5], bio: params[6], tasks_completed: params[7], is_online: params[8], rating: 5.0, points: 0, last_seen: new Date().toISOString() });
      return { lastInsertRowid: doc.$loki };
    }
    if (s.includes('insert into tasks')) {
      const doc = this.tasks.insert({ 
        title: params[0], description: params[1], urgency: params[2], status: 'open', 
        required_skills: params[3], latitude: params[4], longitude: params[5], 
        location_name: params[6], created_by: parseInt(params[7]), 
        estimated_duration: params[8], created_at: new Date().toISOString() 
      });
      return { lastInsertRowid: doc.$loki };
    }
    if (s.includes('insert into notifications')) {
      const doc = this.notifications.insert({ user_id: parseInt(params[0]), title: params[1], message: params[2], type: params[3], task_id: params[4] ? parseInt(params[4]) : null, is_read: 0, created_at: new Date().toISOString() });
      return { lastInsertRowid: doc.$loki };
    }
    if (s.includes('update tasks set')) {
      const id = parseInt(params[params.length - 1]);
      const task = this.tasks.findOne({ '$loki': id });
      if (task) {
        if (s.includes('status = ?')) {
          task.status = params[0];
        } else if (s.includes("status = 'completed'")) {
          task.status = 'completed';
          if (s.includes('completed_at = ?')) {
             task.completed_at = params[0];
             task.response_time = params[1];
          }
        }
        if (s.includes('assigned_volunteer_id=?') || s.includes('assigned_volunteer_id = ?')) {
          // Manual/Auto Assign Query: assigned_volunteer_id=?, status='assigned', assigned_at=? where id=?
          task.assigned_volunteer_id = params[0] ? parseInt(params[0]) : null;
          if (s.includes("status='assigned'")) {
            task.status = 'assigned';
            task.assigned_at = params[1];
          } else {
            task.status = params[1] || task.status;
            task.assigned_at = params[2] || task.assigned_at;
          }
        }
        if (s.includes('assigned_volunteer_id = null')) {
          // Rejection Query: status = 'open', assigned_volunteer_id = NULL, assigned_at = NULL WHERE id = ?
          task.status = 'open';
          task.assigned_volunteer_id = null;
          task.assigned_at = null;
        }
        if (s.includes('points = points + ?')) {
          task.points = (task.points || 0) + parseInt(params[0]);
        }
        this.tasks.update(task);
      }
      return { changes: 1 };
    }
    if (s.includes('update volunteer_profiles set')) {
      const id = parseInt(params[params.length - 1]);
      const profile = this.profiles.findOne({ user_id: id });
      if (profile) {
        if (s.includes('tasks_completed = tasks_completed + 1')) profile.tasks_completed = (profile.tasks_completed || 0) + 1;
        if (s.includes('points = points + ?')) profile.points = (profile.points || 0) + parseInt(params[0]);
        this.profiles.update(profile);
      }
      return { changes: 1 };
    }
    if (s.includes('update users set name')) {
      const user = this.users.findOne({ '$loki': parseInt(params[2]) });
      if (user) { user.name = params[0]; user.phone = params[1]; this.users.update(user); }
      return { changes: 1 };
    }
    if (s.includes('update volunteer_profiles set')) {
      // Handle various profile updates
      const uid = parseInt(params[params.length - 1]);
      const p = this.profiles.findOne({ user_id: uid });
      if (p) {
        if (s.includes('skills = ?')) {
           p.skills = params[0]; p.availability = params[1]; p.latitude = params[2]; p.longitude = params[3];
           p.location_name = params[4]; p.bio = params[5];
        } else if (s.includes('tasks_completed = tasks_completed + 1')) {
           p.tasks_completed = (p.tasks_completed || 0) + 1;
        } else if (s.includes('latitude = ?')) {
           p.latitude = params[0]; p.longitude = params[1]; p.location_name = params[2];
        }
        this.profiles.update(p);
      }
      return { changes: 1 };
    }
    if (s.includes('delete from tasks')) {
      this.tasks.findAndRemove({ '$loki': parseInt(params[0]) });
      return { changes: 1 };
    }
    if (s.includes('update emergency_events set is_active = 0')) {
      this.emergencies.findAndUpdate({ is_active: 1 }, e => { e.is_active = 0; if (s.includes('ended_at')) e.ended_at = new Date().toISOString(); });
      return { changes: 1 };
    }
    if (s.includes('insert into emergency_events')) {
      this.emergencies.insert({ title: params[0], description: params[1], created_by: parseInt(params[2]), is_active: 1, created_at: new Date().toISOString() });
      return { lastInsertRowid: 1 };
    }
    return { lastInsertRowid: 0, changes: 0 };
  }

  _get(sql, params) {
    const s = sql.toLowerCase();
    // Analytics
    if (s.includes('count(*) as count from users')) {
      if (s.includes("role='volunteer'")) return { count: this.users.find({ role: 'volunteer' }).length };
      return { count: this.users.count() };
    }
    if (s.includes('count(*) as count from volunteer_profiles')) {
      if (s.includes('is_online=1')) return { count: this.profiles.find({ is_online: 1 }).length };
      if (s.includes("availability='available'")) return { count: this.profiles.find({ availability: 'available' }).length };
      return { count: this.profiles.count() };
    }
    if (s.includes('count(*) as count from tasks')) {
      if (s.includes("status='open'")) return { count: this.tasks.find({ status: 'open' }).length };
      if (s.includes("status='assigned'")) return { count: this.tasks.find({ '$or': [{ status: 'assigned' }, { status: 'in-progress' }] }).length };
      if (s.includes("status='completed'")) return { count: this.tasks.find({ status: 'completed' }).length };
      if (s.includes("urgency='high'")) return { count: this.tasks.find({ urgency: 'high', status: { '$ne': 'completed' } }).length };
      return { count: this.tasks.count() };
    }
    // Auth & Detail
    if (s.includes('select * from users where email = ?')) {
      const u = this.users.findOne({ email: params[0] });
      return u ? { ...u, id: u.$loki } : undefined;
    }
    if (s.includes('select * from users where id = ?')) {
      const u = this.users.findOne({ '$loki': parseInt(params[0]) });
      return u ? { ...u, id: u.$loki } : undefined;
    }
    if (s.includes('select * from volunteer_profiles where user_id = ?')) {
      const p = this.profiles.findOne({ user_id: parseInt(params[0]) });
      return p ? { ...p, id: p.$loki } : undefined;
    }
    if (s.includes('select * from tasks where id = ?')) {
      const t = this.tasks.findOne({ '$loki': parseInt(params[0]) });
      return t ? { ...t, id: t.$loki } : undefined;
    }
    if (s.includes('select * from emergency_events where is_active = 1')) {
      const e = this.emergencies.findOne({ is_active: 1 });
      return e ? { ...e, id: e.$loki } : undefined;
    }
    return undefined;
  }

  _all(sql, params) {
    const s = sql.toLowerCase();
    // Volunteers List (Admin)
    if (s.includes('from users u left join volunteer_profiles vp on u.id = vp.user_id where u.role = \'volunteer\'')) {
      return this.users.find({ role: 'volunteer' }).map(u => {
        const p = this.profiles.findOne({ user_id: u.$loki });
        return { ...u, id: u.$loki, ...(p || {}), profile_id: p ? p.$loki : null };
      });
    }
    if (s === 'select * from users') {
      return this.users.find().map(u => ({ ...u, id: u.$loki }));
    }
    // Volunteer Matching (Assign/Score)
    if (s.includes('from volunteer_profiles vp join users u on vp.user_id = u.id')) {
      const vols = this.profiles.find({ availability: { '$ne': 'unavailable' } }).map(p => {
        const u = this.users.findOne({ '$loki': p.user_id });
        return { ...p, id: p.user_id, user_id: p.user_id, name: u ? u.name : 'Unknown', email: u ? u.email : '' };
      });
      if (s.includes('and u.id not in')) {
        const assignedTaskUsers = new Set(
          this.tasks.find({ '$or': [{ status: 'assigned' }, { status: 'in-progress' }] })
          .map(t => t.assigned_volunteer_id)
        );
        return vols.filter(v => !assignedTaskUsers.has(v.user_id));
      }
      return vols;
    }
    // Tasks List
    if (s.includes('from tasks t')) {
      let filter = {};
      if (s.includes('assigned_volunteer_id = ?') || s.includes('assigned_volunteer_id=?')) {
        filter.assigned_volunteer_id = parseInt(params[0]);
      }
      let tasks = this.tasks.find(filter);
      return tasks.map(t => {
        const creator = this.users.findOne({ '$loki': t.created_by });
        const volunteer = t.assigned_volunteer_id ? this.users.findOne({ '$loki': t.assigned_volunteer_id }) : null;
        return { ...t, id: t.$loki, creator_name: creator ? creator.name : 'System', volunteer_name: volunteer ? volunteer.name : null };
      });
    }
    // Notifications
    if (s.includes('select * from notifications where user_id = ?')) {
      return this.notifications.find({ user_id: parseInt(params[0]) }).map(n => ({ ...n, id: n.$loki })).sort((a, b) => b.id - a.id);
    }
    // Map data
    if (s.includes('select t.id, t.title, t.status, t.urgency, t.latitude, t.longitude')) {
        return this.tasks.find({ status: { '$ne': 'completed' } }).map(t => {
            const v = t.assigned_volunteer_id ? this.users.findOne({ '$loki': t.assigned_volunteer_id }) : null;
            return { ...t, id: t.$loki, volunteer_name: v ? v.name : null };
        });
    }
    if (s.includes('select vp.user_id as id, u.name, vp.latitude, vp.longitude')) {
        return this.profiles.find().map(p => {
            const u = this.users.findOne({ '$loki': p.user_id });
            return { ...p, id: p.user_id, name: u ? u.name : 'Unknown' };
        });
    }
    return [];
  }
}

module.exports = LokiDatabase;
