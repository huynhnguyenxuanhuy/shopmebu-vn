require('dotenv').config();

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function isPlaceholder(value = '') {
  return /^(your_|change_|example_|shopmebu_super_secret_change_this)/i.test(String(value));
}

function validateProductionEnv() {
  if (process.env.NODE_ENV !== 'production') return;

  const required = ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME', 'SESSION_SECRET', 'BASE_URL'];
  const missing = required.filter((key) => !process.env[key] || isPlaceholder(process.env[key]));
  if (missing.length) {
    throw new Error(`Thiếu cấu hình production: ${missing.join(', ')}`);
  }

  if (String(process.env.SESSION_SECRET || '').length < 32) {
    throw new Error('SESSION_SECRET production nên dài tối thiểu 32 ký tự.');
  }
}

module.exports = {
  boolEnv,
  isPlaceholder,
  validateProductionEnv
};
