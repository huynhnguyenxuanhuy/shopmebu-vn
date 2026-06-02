const session = require('express-session');

class MySQLSessionStore extends session.Store {
  constructor(pool, options = {}) {
    super();
    this.pool = pool;
    const tableName = options.tableName || 'user_sessions';
    this.tableName = /^[A-Za-z0-9_]+$/.test(tableName) ? tableName : 'user_sessions';
    this.ready = null;
  }

  ensureTable() {
    if (!this.ready) {
      this.ready = this.pool.query(`
        CREATE TABLE IF NOT EXISTS \`${this.tableName}\` (
          sid VARCHAR(128) NOT NULL PRIMARY KEY,
          data LONGTEXT NOT NULL,
          expires_at DATETIME NOT NULL,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          INDEX idx_expires_at (expires_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);
    }
    return this.ready;
  }

  getExpiry(sess) {
    const cookie = sess && sess.cookie ? sess.cookie : {};
    if (cookie.expires) return new Date(cookie.expires);
    const maxAge = Number(cookie.originalMaxAge || cookie.maxAge || 7 * 24 * 60 * 60 * 1000);
    return new Date(Date.now() + maxAge);
  }

  async get(sid, cb) {
    try {
      await this.ensureTable();
      const [[row]] = await this.pool.query(
        `SELECT data FROM \`${this.tableName}\` WHERE sid=? AND expires_at > NOW() LIMIT 1`,
        [sid]
      );
      if (!row) return cb(null, null);
      try {
        return cb(null, JSON.parse(row.data));
      } catch (err) {
        await this.destroy(sid, () => {});
        return cb(err);
      }
    } catch (err) {
      return cb(err);
    }
  }

  async set(sid, sess, cb = () => {}) {
    try {
      await this.ensureTable();
      await this.pool.query(
        `INSERT INTO \`${this.tableName}\` (sid, data, expires_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE data=VALUES(data), expires_at=VALUES(expires_at)`,
        [sid, JSON.stringify(sess), this.getExpiry(sess)]
      );
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  async destroy(sid, cb = () => {}) {
    try {
      await this.ensureTable();
      await this.pool.query(`DELETE FROM \`${this.tableName}\` WHERE sid=?`, [sid]);
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }

  async touch(sid, sess, cb = () => {}) {
    try {
      await this.ensureTable();
      await this.pool.query(
        `UPDATE \`${this.tableName}\` SET expires_at=? WHERE sid=?`,
        [this.getExpiry(sess), sid]
      );
      return cb(null);
    } catch (err) {
      return cb(err);
    }
  }
}

module.exports = MySQLSessionStore;
