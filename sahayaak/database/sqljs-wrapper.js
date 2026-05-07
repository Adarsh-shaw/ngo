const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

class Statement {
  constructor(db, sql, dbInstance) {
    this.db = db;
    this.sql = sql;
    this.dbInstance = dbInstance;
  }

  run(...params) {
    this.db.run(this.sql, params);
    this.dbInstance.save();
    return { lastInsertRowid: this.dbInstance.lastId(), changes: this.dbInstance.changes() };
  }

  get(...params) {
    const stmt = this.db.prepare(this.sql);
    stmt.bind(params);
    const result = stmt.step() ? stmt.getAsObject() : undefined;
    stmt.free();
    return result;
  }

  all(...params) {
    const stmt = this.db.prepare(this.sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
      results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
  }
}

class SqlJsDatabase {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.initialized = false;
  }

  async init() {
    const SQL = await initSqlJs();
    if (fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }
    this.initialized = true;
    return this;
  }

  exec(sql) {
    this.db.run(sql);
    this.save();
  }

  prepare(sql) {
    return new Statement(this.db, sql, this);
  }

  pragma(sql) {
    // Basic pragma support (mostly ignored for sql.js)
    try { this.db.run(`PRAGMA ${sql}`); } catch(e) {}
  }

  save() {
    const data = this.db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(this.dbPath, buffer);
  }

  lastId() {
    const res = this.db.exec("SELECT last_insert_rowid() as id");
    return res[0].values[0][0];
  }

  changes() {
    const res = this.db.exec("SELECT changes() as count");
    return res[0].values[0][0];
  }
}

module.exports = SqlJsDatabase;
