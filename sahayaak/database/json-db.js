const fs = require('fs');
const path = require('path');

class JsonDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath.replace('.db', '.json');
    this.data = {
      users: [],
      volunteer_profiles: [],
      tasks: [],
      notifications: [],
      task_history: [],
      emergency_events: []
    };
    this.load();
  }

  load() {
    if (fs.existsSync(this.dbPath)) {
      try {
        this.data = JSON.parse(fs.readFileSync(this.dbPath, 'utf8'));
      } catch (e) {
        console.error('Failed to load DB:', e);
      }
    }
  }

  save() {
    fs.writeFileSync(this.dbPath, JSON.stringify(this.data, null, 2));
  }

  exec(sql) {
    // Simple mock for schema creation - ignored since we use object structure
  }

  pragma(sql) {
    // Ignored
  }

  prepare(sql) {
    const self = this;
    return {
      run(...params) {
        return self._handleRun(sql, params);
      },
      get(...params) {
        return self._handleGet(sql, params);
      },
      all(...params) {
        return self._handleAll(sql, params);
      }
    };
  }

  _handleRun(sql, params) {
    const sqlLower = sql.toLowerCase();
    if (sqlLower.includes('insert into users')) {
      const id = this.data.users.length + 1;
      this.data.users.push({ id, name: params[0], email: params[1], password: params[2], role: params[3], phone: params[4], created_at: new Date().toISOString() });
      this.save();
      return { lastInsertRowid: id };
    }
    if (sqlLower.includes('insert into volunteer_profiles')) {
      const id = this.data.volunteer_profiles.length + 1;
      this.data.volunteer_profiles.push({ id, user_id: params[0], skills: params[1], availability: params[2], latitude: params[3], longitude: params[4], location_name: params[5], bio: params[6], tasks_completed: params[7], is_online: params[8], rating: 5.0, last_seen: new Date().toISOString() });
      this.save();
      return { lastInsertRowid: id };
    }
    if (sqlLower.includes('insert into tasks')) {
      const id = this.data.tasks.length + 1;
      this.data.tasks.push({ 
        id, title: params[0], description: params[1], urgency: params[2], required_skills: params[3], 
        latitude: params[4], longitude: params[5], location_name: params[6], created_by: params[7], 
        estimated_duration: params[8], status: 'open', created_at: new Date().toISOString() 
      });
      this.save();
      return { lastInsertRowid: id };
    }
    if (sqlLower.includes('insert into notifications')) {
      const id = this.data.notifications.length + 1;
      this.data.notifications.push({ id, user_id: params[0], title: params[1], message: params[2], type: params[3], task_id: params[4], is_read: 0, created_at: new Date().toISOString() });
      this.save();
      return { lastInsertRowid: id };
    }
    if (sqlLower.includes('update users set name')) {
        const user = this.data.users.find(u => u.id === params[2]);
        if (user) { user.name = params[0]; user.phone = params[1]; }
        this.save();
        return { changes: 1 };
    }
    if (sqlLower.includes('update tasks set status')) {
        const task = this.data.tasks.find(t => t.id === params[params.length-1]);
        if (task) { 
            if (sqlLower.includes('status = ?')) task.status = params[0];
            if (sqlLower.includes('assigned_volunteer_id=?')) {
                task.assigned_volunteer_id = params[0];
                task.status = params[1];
                task.assigned_at = params[2];
            }
        }
        this.save();
        return { changes: 1 };
    }
    // Fallback for other runs...
    return { lastInsertRowid: 0, changes: 0 };
  }

  _handleGet(sql, params) {
    const sqlLower = sql.toLowerCase();
    if (sqlLower.includes('select count(*) as count from users')) {
      return { count: this.data.users.length };
    }
    if (sqlLower.includes('select * from users where email = ?')) {
      return this.data.users.find(u => u.email === params[0]);
    }
    if (sqlLower.includes('select * from users where id = ?')) {
      return this.data.users.find(u => u.id === params[0]);
    }
    if (sqlLower.includes('select * from volunteer_profiles where user_id = ?')) {
        return this.data.volunteer_profiles.find(vp => vp.user_id === params[0]);
    }
    if (sqlLower.includes('select * from tasks where id = ?')) {
        return this.data.tasks.find(t => t.id === params[0]);
    }
    return undefined;
  }

  _handleAll(sql, params) {
    const sqlLower = sql.toLowerCase();
    if (sqlLower.includes('select * from notifications where user_id = ?')) {
      return this.data.notifications.filter(n => n.user_id === params[0]).sort((a,b) => b.id - a.id);
    }
    if (sqlLower.includes('select t.*, u.name as creator_name')) {
        return this.data.tasks.map(t => {
            const creator = this.data.users.find(u => u.id === t.created_by);
            return { ...t, creator_name: creator ? creator.name : 'Unknown' };
        }).filter(t => !params[0] || t.assigned_volunteer_id === params[0]);
    }
    return [];
  }
}

module.exports = JsonDatabase;
