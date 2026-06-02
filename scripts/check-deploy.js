#!/usr/bin/env node

const { isPlaceholder } = require('../config/env');

const required = [
  'NODE_ENV',
  'BASE_URL',
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'SESSION_SECRET'
];

const warnings = [];
const errors = [];

for (const key of required) {
  if (!process.env[key] || isPlaceholder(process.env[key])) {
    errors.push(`${key} chưa cấu hình đúng`);
  }
}

if (process.env.NODE_ENV !== 'production') {
  warnings.push('NODE_ENV nên là production khi chạy VPS thật');
}

if ((process.env.SESSION_SECRET || '').length < 32) {
  errors.push('SESSION_SECRET nên dài tối thiểu 32 ký tự');
}

if (process.env.BASE_URL && !/^https:\/\//.test(process.env.BASE_URL)) {
  warnings.push('BASE_URL nên dùng HTTPS khi deploy thật');
}

if (String(process.env.SESSION_STORE || '').toLowerCase() === 'memory') {
  errors.push('SESSION_STORE=memory dễ làm mất đăng nhập trên VPS/cPanel nhiều process; hãy bỏ biến này hoặc dùng MySQL session');
}

if (process.env.NODE_ENV === 'production' && process.env.TRUST_PROXY !== '1') {
  warnings.push('TRUST_PROXY nên là 1 khi chạy sau proxy/cPanel để cookie HTTPS ổn định');
}

if (process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== '1') {
  warnings.push('COOKIE_SECURE nên là 1 khi chạy HTTPS thật');
}

if (!process.env.SEPAY_WEBHOOK_TOKEN || isPlaceholder(process.env.SEPAY_WEBHOOK_TOKEN)) {
  warnings.push('SEPAY_WEBHOOK_TOKEN chưa có, webhook nạp tự động chỉ test được sau khi cấu hình SePay');
}

if (!process.env.GOOGLE_CLIENT_ID || isPlaceholder(process.env.GOOGLE_CLIENT_ID)) {
  warnings.push('Google OAuth chưa cấu hình, nút Google sẽ dùng demo/fallback nếu app chưa có key thật');
}

if (errors.length) {
  console.error('Deploy check chưa đạt:');
  for (const error of errors) console.error(`- ${error}`);
  if (warnings.length) {
    console.error('\nCảnh báo thêm:');
    for (const warning of warnings) console.error(`- ${warning}`);
  }
  process.exit(1);
}

console.log('Deploy check đạt các cấu hình bắt buộc.');
if (warnings.length) {
  console.log('\nCảnh báo:');
  for (const warning of warnings) console.log(`- ${warning}`);
}
