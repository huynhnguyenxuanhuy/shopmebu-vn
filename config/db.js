/* ============================================
   config/db.js – MySQL Connection Pool
   ============================================ */
require('dotenv').config();
const mysql = require('mysql2/promise');

const sslEnabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.DB_SSL || '').toLowerCase());

const pool = mysql.createPool({
  host:            process.env.DB_HOST     || 'localhost',
  port:            process.env.DB_PORT     || 3306,
  user:            process.env.DB_USER     || 'root',
  password:        process.env.DB_PASSWORD || '',
  database:        process.env.DB_NAME     || 'shopmebu',
  waitForConnections: true,
  connectionLimit:    10,
  charset:         'utf8mb4',
  timezone:        '+07:00',
  ssl:             sslEnabled ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' } : undefined
});

module.exports = pool;
