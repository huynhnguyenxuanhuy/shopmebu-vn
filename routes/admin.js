/* ============================================
   routes/admin.js
   Admin Panel – quản lý toàn bộ shop
   GET  /admin              → Dashboard
   GET  /admin/acc          → Danh sách acc
   GET  /admin/acc/them     → Form thêm acc
   POST /admin/acc/them     → Lưu acc mới
   GET  /admin/acc/sua/:id  → Form sửa acc
   POST /admin/acc/sua/:id  → Lưu chỉnh sửa acc
   POST /admin/acc/xoa/:id  → Xóa acc
   GET  /admin/users        → Danh sách user
   POST /admin/users/set-role → Đổi role user
   GET  /admin/orders       → Lịch sử đơn hàng
   GET  /admin/notifications → Gửi thông báo
   POST /admin/notifications → Lưu thông báo
   GET  /admin/payments     → Payment logs
   POST /admin/payments/xu-ly → Xử lý thủ công
   GET  /admin/settings     → Cài đặt shop
   POST /admin/settings     → Lưu cài đặt
   ============================================ */
const express   = require('express');
const router    = express.Router();
const db        = require('../config/db');
const adminAuth = require('../middleware/adminAuth');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const bcrypt    = require('bcryptjs');
const localStore = require('../utils/localStore');

// Multer for acc images
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../public/uploads/acc');
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    cb(null, 'acc_' + Date.now() + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Chỉ nhận file ảnh!'));
    cb(null, true);
  }
});

async function findCategoryBySlug(slug) {
  const [[category]] = await db.query(
    'SELECT * FROM game_categories WHERE slug=? AND is_active=1',
    [slug]
  );
  return category || null;
}

async function findAccTypeId(categoryId, slug) {
  if (!slug) return null;
  const [[type]] = await db.query(
    'SELECT id FROM acc_types WHERE category_id=? AND slug=?',
    [categoryId, slug]
  );
  return type?.id || null;
}

const contentDefaults = {
  hero_badge: '⚡ Tự Động 24/7 • Giao Ngay Sau Khi Mua',
  hero_title: 'Mua Bán Acc VPlay',
  hero_highlight: 'Uy Tín – Nhanh – Rẻ',
  hero_subtitle: 'Kho acc khổng lồ · Thanh toán tự động · Nhận acc ngay lập tức\nHuyền Ảnh Võ Lâm · Giang Hồ Kỳ Ngộ · Nhiều game VPlay khác',
  hero_primary_label: '⚔️ Mua Acc Ngay',
  hero_primary_url: '/game/huyen-anh-vo-lam',
  hero_secondary_label: '💳 Nạp Tiền',
  hero_secondary_url: '/nap-tien',
  info_heading: 'SHOPMEBU.VN',
  info_icon: '🏪',
  info_paragraphs: [
    'SHOPMEBU.VN chuyên mua bán acc VPlay: Huyền Ảnh Võ Lâm, Giang Hồ Kỳ Ngộ và các game VPlay khác.',
    'Hệ thống hỗ trợ đăng nhập nhanh, nạp tiền tự động qua QR, mua acc và nhận thông tin ngay sau khi thanh toán.'
  ].join('\n'),
  sale_heading: 'Box Zalo Săn Sale',
  sale_icon: '💬',
  sale_paragraphs: [
    'Tham gia nhóm để nhận thông báo acc mới, khuyến mãi nạp tiền và mã giảm giá theo đợt.'
  ].join('\n'),
  sale_url: 'https://zalo.me/g/gssfxa652'
};

function mergeContent(settings = {}) {
  return { ...contentDefaults, ...settings };
}

function emptyMonthlyStats(year) {
  return Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    label: `Tháng ${i + 1}`,
    revenue: 0,
    deposits: 0,
    orders: 0,
    year
  }));
}

function buildLocalMonthlyStats(runtime, year) {
  const rows = emptyMonthlyStats(year);
  for (const tx of runtime.transactions || []) {
    const date = new Date(tx.created_at);
    if (Number.isNaN(date.getTime()) || date.getFullYear() !== Number(year)) continue;
    const row = rows[date.getMonth()];
    const amount = Number(tx.amount || 0);
    if (tx.type === 'purchase' && tx.status === 'success') row.revenue += amount;
    if (['deposit', 'admin_adjust'].includes(tx.type) && tx.status === 'success' && amount > 0) row.deposits += amount;
  }
  for (const order of runtime.orders || []) {
    const date = new Date(order.created_at);
    if (!Number.isNaN(date.getTime()) && date.getFullYear() === Number(year)) rows[date.getMonth()].orders += 1;
  }
  return rows;
}

function setAdminSession(req, user) {
  req.session.user = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
    balance: Number(user.balance || 0),
    avatar: user.avatar || null
  };
}

function safeAdminReturn(returnUrl) {
  return typeof returnUrl === 'string' && returnUrl.startsWith('/admin') && !returnUrl.startsWith('/admin/login')
    ? returnUrl
    : '/admin';
}

function addUserSearch(where, params, search) {
  const key = String(search || '').trim();
  if (!key) return where;
  const idKey = key.replace(/^#/, '');
  if (/^\d+$/.test(idKey)) {
    params.push(Number(idKey), `%${key}%`, `%${key}%`);
    return `${where} AND (u.id=? OR u.username LIKE ? OR u.email LIKE ?)`;
  }
  params.push(`%${key}%`, `%${key}%`);
  return `${where} AND (u.username LIKE ? OR u.email LIKE ?)`;
}

async function ensureCtvSchema() {
  try {
    const [balanceCol] = await db.query("SHOW COLUMNS FROM users LIKE 'ctv_balance'");
    if (!balanceCol.length) {
      await db.query('ALTER TABLE users ADD COLUMN ctv_balance DECIMAL(15,0) DEFAULT 0');
    }
  } catch (_) {}

  try {
    const [ctvCol] = await db.query("SHOW COLUMNS FROM accounts LIKE 'ctv_id'");
    if (!ctvCol.length) {
      await db.query('ALTER TABLE accounts ADD COLUMN ctv_id INT DEFAULT NULL');
    }
  } catch (_) {}

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ctv_withdrawals (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ctv_id INT NOT NULL,
        amount DECIMAL(15,0) NOT NULL,
        bank_info TEXT DEFAULT NULL,
        status ENUM('pending','approved','rejected') DEFAULT 'pending',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        approved_at DATETIME DEFAULT NULL,
        rejected_at DATETIME DEFAULT NULL,
        FOREIGN KEY (ctv_id) REFERENCES users(id)
      ) ENGINE=InnoDB
    `);
  } catch (_) {}

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS ctv_sales (
        id INT AUTO_INCREMENT PRIMARY KEY,
        ctv_id INT NOT NULL,
        account_id INT NOT NULL,
        order_id INT DEFAULT NULL,
        amount DECIMAL(15,0) NOT NULL,
        commission_percent DECIMAL(5,2) DEFAULT 100,
        status ENUM('credited') DEFAULT 'credited',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB
    `);
  } catch (_) {}

  try {
    const [percentCol] = await db.query("SHOW COLUMNS FROM ctv_sales LIKE 'commission_percent'");
    if (!percentCol.length) {
      await db.query('ALTER TABLE ctv_sales ADD COLUMN commission_percent DECIMAL(5,2) DEFAULT 100');
    }
  } catch (_) {}
}

async function getCtvCommissionSettings() {
  const [games] = await db.query('SELECT id, name, slug FROM game_categories WHERE is_active=1 ORDER BY sort_order, name ASC');
  const keys = games.map(g => `ctv_commission_game_${g.id}`);
  let settingsMap = {};
  if (keys.length) {
    const placeholders = keys.map(() => '?').join(',');
    const [settings] = await db.query(`SELECT \`key\`, value FROM settings WHERE \`key\` IN (${placeholders})`, keys);
    settings.forEach(s => { settingsMap[s.key] = s.value; });
  }
  return games.map(game => ({
    ...game,
    commission_percent: Number(settingsMap[`ctv_commission_game_${game.id}`] ?? 100)
  }));
}

/* ─── ADMIN LOGIN RIÊNG ─── */
router.get('/login', (req, res) => {
  if (req.session.user && ['admin', 'superadmin'].includes(req.session.user.role)) {
    return res.redirect('/admin');
  }
  res.render('admin/login', {
    layout: false,
    title: 'Đăng Nhập Admin',
    returnUrl: safeAdminReturn(req.query.returnUrl),
    success_msg: req.flash('success'),
    error_msg: req.flash('error')
  });
});

router.post('/login', async (req, res) => {
  const { username, password, returnUrl } = req.body;
  const redirectTo = safeAdminReturn(returnUrl);

  if (!username || !password) {
    req.flash('error', 'Vui lòng nhập tài khoản và mật khẩu admin!');
    return res.redirect(`/admin/login?returnUrl=${encodeURIComponent(redirectTo)}`);
  }

  try {
    const [[user]] = await db.query(
      'SELECT * FROM users WHERE (username=? OR email=?) AND is_active=1',
      [username, username]
    );
    const validPassword = user && user.password && await bcrypt.compare(password, user.password);
    if (!user || !validPassword || !['admin', 'superadmin'].includes(user.role)) {
      req.flash('error', 'Sai tài khoản admin hoặc tài khoản không có quyền!');
      return res.redirect(`/admin/login?returnUrl=${encodeURIComponent(redirectTo)}`);
    }

    await db.query('UPDATE users SET updated_at=NOW() WHERE id=?', [user.id]);
    setAdminSession(req, user);
    req.flash('success', `Chào mừng ${user.username} quay lại Admin Panel.`);
    return res.redirect(redirectTo);
  } catch (err) {
    const users = await localStore.readUsers();
    const key = username.trim().toLowerCase();
    const user = users.find(u => u.username.toLowerCase() === key || String(u.email || '').toLowerCase() === key);
    const validPassword = user && user.password && await bcrypt.compare(password, user.password);

    if (!user || !validPassword || !['admin', 'superadmin'].includes(user.role)) {
      req.flash('error', 'Sai tài khoản admin hoặc tài khoản không có quyền!');
      return res.redirect(`/admin/login?returnUrl=${encodeURIComponent(redirectTo)}`);
    }

    setAdminSession(req, user);
    req.flash('success', `Chào mừng ${user.username} quay lại Admin Panel.`);
    return res.redirect(redirectTo);
  }
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(process.env.SESSION_NAME || 'shopmebu.sid');
    res.clearCookie('connect.sid');
    res.redirect('/admin/login');
  });
});

// Áp adminAuth cho tất cả route
router.use(adminAuth);

/* ─── DASHBOARD ─── */
router.get('/', async (req, res) => {
  const selectedYear = Number(req.query.year) || new Date().getFullYear();
  try {
    const [[{ totalAcc }]]   = await db.query('SELECT COUNT(*) as totalAcc FROM accounts WHERE status="available"');
    const [[{ soldAcc }]]    = await db.query('SELECT COUNT(*) as soldAcc FROM accounts WHERE status="sold"');
    const [[{ totalUsers }]] = await db.query('SELECT COUNT(*) as totalUsers FROM users');
    const [[{ revenue }]]    = await db.query('SELECT COALESCE(SUM(amount),0) as revenue FROM transactions WHERE type="purchase" AND status="success"');
    const [[{ todayRev }]]   = await db.query(`SELECT COALESCE(SUM(amount),0) as todayRev FROM transactions WHERE type="purchase" AND status="success" AND DATE(created_at)=CURDATE()`);
    const [[{ pendingLogs }]]= await db.query('SELECT COUNT(*) as pendingLogs FROM payment_logs WHERE is_processed=0');

    // Doanh thu 7 ngày
    const [revenueChart] = await db.query(`
      SELECT DATE(created_at) as day, COALESCE(SUM(amount),0) as total
      FROM transactions WHERE type="purchase" AND status="success"
      AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY DATE(created_at) ORDER BY day ASC
    `);

    // Đơn hàng gần nhất
    const [recentOrders] = await db.query(`
      SELECT o.*, u.username, g.slug AS game_slug
      FROM orders o
      JOIN users u ON o.user_id=u.id
      JOIN accounts a ON o.account_id=a.id
      JOIN game_categories g ON g.id=a.category_id
      ORDER BY o.created_at DESC LIMIT 10
    `);

    const monthlyStats = emptyMonthlyStats(selectedYear);
    const [monthlyTx] = await db.query(`
      SELECT MONTH(created_at) AS month,
        COALESCE(SUM(CASE WHEN type='purchase' AND status='success' THEN amount ELSE 0 END),0) AS revenue,
        COALESCE(SUM(CASE WHEN type IN ('deposit','admin_adjust') AND status='success' AND amount > 0 THEN amount ELSE 0 END),0) AS deposits
      FROM transactions
      WHERE YEAR(created_at)=?
      GROUP BY MONTH(created_at)
    `, [selectedYear]);
    const [monthlyOrders] = await db.query(`
      SELECT MONTH(created_at) AS month, COUNT(*) AS orders
      FROM orders
      WHERE YEAR(created_at)=?
      GROUP BY MONTH(created_at)
    `, [selectedYear]);
    monthlyTx.forEach(row => {
      const item = monthlyStats[Number(row.month) - 1];
      if (item) {
        item.revenue = Number(row.revenue || 0);
        item.deposits = Number(row.deposits || 0);
      }
    });
    monthlyOrders.forEach(row => {
      const item = monthlyStats[Number(row.month) - 1];
      if (item) item.orders = Number(row.orders || 0);
    });

    res.render('admin/dashboard', {
      layout: false,
      title: 'Admin Dashboard',
      admin: req.session.user,
      stats: { totalAcc, soldAcc, totalUsers, revenue: Number(revenue), todayRev: Number(todayRev), pendingLogs },
      revenueChart,
      monthlyStats,
      selectedYear,
      recentOrders,
      page_name: 'dashboard'
    });
  } catch (err) {
    console.error(err);
    const runtime = await localStore.readRuntime();
    const users = await localStore.readUsers();
    const orders = await localStore.listOrders();
    const revenue = runtime.transactions
      .filter(t => t.type === 'purchase' && t.status === 'success')
      .reduce((sum, t) => sum + Number(t.amount || 0), 0);
    const monthlyStats = buildLocalMonthlyStats(runtime, selectedYear);
    res.render('admin/dashboard', {
      layout: false, title: 'Admin Dashboard', admin: req.session.user,
      stats: {
        totalAcc: runtime.accounts.filter(a => a.status === 'available').length,
        soldAcc: runtime.accounts.filter(a => a.status === 'sold').length,
        totalUsers: users.length,
        revenue,
        todayRev: revenue,
        pendingLogs: runtime.payment_logs.filter(l => !l.is_processed).length
      },
      revenueChart: [{ day: new Date().toISOString().slice(0, 10), total: revenue }],
      monthlyStats,
      selectedYear,
      recentOrders: orders.slice(0, 10),
      page_name: 'dashboard'
    });
  }
});

/* ─── DANH SÁCH ACC ─── */
router.get('/acc', async (req, res) => {
  const page     = parseInt(req.query.page) || 1;
  const limit    = 20;
  const offset   = (page - 1) * limit;
  const search   = req.query.search || '';
  const game     = req.query.game   || '';
  const status   = req.query.status || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (search) { where += ' AND (a.acc_username LIKE ? OR a.title LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (game)   { where += ' AND g.slug=?'; params.push(game); }
  if (status) { where += ' AND a.status=?'; params.push(status); }

  try {
    const [[{ total }]] = await db.query(`
      SELECT COUNT(*) as total
      FROM accounts a
      JOIN game_categories g ON g.id=a.category_id
      ${where}
    `, params);
    const [accs] = await db.query(`
      SELECT a.*, g.name as game_name, g.slug as game_slug,
             a.rank as rank_name,
             COALESCE(NULLIF(SUBSTRING_INDEX(a.images, ',', 1), ''), NULL) as image_url,
             at.slug as acc_type
      FROM accounts a
      JOIN game_categories g ON g.id=a.category_id
      LEFT JOIN acc_types at ON at.id=a.acc_type_id
      ${where} ORDER BY a.id DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [games] = await db.query('SELECT * FROM game_categories WHERE is_active=1 ORDER BY sort_order, name ASC');
    const totalPages = Math.ceil(total / limit);

    res.render('admin/acc-list', {
      layout: false, title: 'Quản Lý Acc', admin: req.session.user,
      accs, games, total, page, totalPages, search, game, status,
      success_msg: req.flash('success'), error_msg: req.flash('error'),
      page_name: 'acc'
    });
  } catch (err) {
    console.error(err);
    const accs = await localStore.listAccounts({ search, game, status: status || '' });
    const games = localStore.categories;
    res.render('admin/acc-list', {
      layout: false, title: 'Quản Lý Acc', admin: req.session.user,
      accs, games, total: accs.length, page: 1, totalPages: 1,
      search, game, status,
      success_msg: req.flash('success'), error_msg: ['Đang dùng dữ liệu local vì MySQL chưa bật'],
      page_name: 'acc'
    });
  }
});

/* ─── FORM THÊM ACC ─── */
router.get('/acc/them', async (req, res) => {
  let games = localStore.categories;
  let ctvUsers = [];
  try {
    await ensureCtvSchema();
    [games] = await db.query('SELECT * FROM game_categories WHERE is_active=1 ORDER BY sort_order, name ASC');
    [ctvUsers] = await db.query('SELECT id, username, email FROM users WHERE role="staff" ORDER BY username ASC');
  } catch (_) {}
  res.render('admin/acc-add', {
    layout: false, title: 'Thêm Acc Mới', admin: req.session.user,
    games, ctvUsers,
    success_msg: req.flash('success'), error_msg: req.flash('error'),
    page_name: 'acc-add'
  });
});

/* ─── LƯU ACC MỚI ─── */
router.post('/acc/them', upload.single('image'), async (req, res) => {
  const {
    game_slug, acc_username, acc_password, acc_info,
    title, price, rank_name, server, acc_type, category, ctv_id
  } = req.body;

  if (!game_slug || !acc_username || !acc_password || !price) {
    req.flash('error', 'Vui lòng điền đầy đủ thông tin bắt buộc!');
    return res.redirect('/admin/acc/them');
  }

  const image_url = req.file ? '/uploads/acc/' + req.file.filename : null;
  const ctvId = ctv_id ? parseInt(ctv_id) : null;

  try {
    await ensureCtvSchema();
    const categoryRow = await findCategoryBySlug(game_slug);
    if (!categoryRow) {
      req.flash('error', 'Game không hợp lệ!');
      return res.redirect('/admin/acc/them');
    }

    const accTypeId = await findAccTypeId(categoryRow.id, acc_type);
    await db.query(`
      INSERT INTO accounts
        (category_id, acc_type_id, acc_username, acc_password, acc_info, title, price, rank, server, images, status, ctv_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
    `, [
      categoryRow.id,
      accTypeId,
      acc_username,
      acc_password,
      acc_info || category || null,
      title || null,
      price,
      rank_name || null,
      server || null,
      image_url,
      ctvId || null
    ]);

    req.flash('success', `✅ Đã thêm acc ${acc_username} thành công!`);
    res.redirect('/admin/acc');
  } catch (err) {
    console.error(err);
    await localStore.addAccount({ ...req.body, ctv_id: ctvId || null, image_url });
    req.flash('success', '✅ Đã thêm acc vào dữ liệu local!');
    res.redirect('/admin/acc');
  }
});

/* ─── THÊM NHIỀU ACC (BULK) ─── */
router.post('/acc/bulk', async (req, res) => {
  const { game_slug, bulk_data, price, rank_name, acc_type } = req.body;
  if (!game_slug || !bulk_data || !price) {
    return res.json({ success: false, message: 'Thiếu thông tin!' });
  }

  // Format: mỗi dòng là "username|password|info"
  const lines = bulk_data.trim().split('\n').filter(l => l.trim());
  if (lines.length === 0) return res.json({ success: false, message: 'Không có dữ liệu!' });
  if (lines.length > 500) return res.json({ success: false, message: 'Tối đa 500 acc mỗi lần!' });

  try {
    const categoryRow = await findCategoryBySlug(game_slug);
    if (!categoryRow) return res.json({ success: false, message: 'Game không hợp lệ!' });

    const accTypeId = await findAccTypeId(categoryRow.id, acc_type || 'tu-chon');
    const rows = lines.map(line => {
      const parts = line.split('|');
      return [
        categoryRow.id,
        accTypeId,
        parts[0]?.trim(),
        parts[1]?.trim(),
        parts[2]?.trim() || null,
        price,
        rank_name || null,
        'available'
      ];
    }).filter(r => r[2] && r[3]);

    if (rows.length === 0) return res.json({ success: false, message: 'Định dạng sai! Dùng: username|password|info' });

    await db.query(`
      INSERT INTO accounts (category_id, acc_type_id, acc_username, acc_password, acc_info, price, rank, status)
      VALUES ?
    `, [rows]);
    return res.json({ success: true, message: `✅ Đã thêm ${rows.length} acc!`, count: rows.length });
  } catch (err) {
    let count = 0;
    for (const line of lines) {
      const [acc_username, acc_password, acc_info] = line.split('|').map(s => s?.trim());
      if (acc_username && acc_password) {
        await localStore.addAccount({ game_slug, acc_username, acc_password, acc_info, price, rank_name, acc_type });
        count += 1;
      }
    }
    return res.json({ success: true, message: `✅ Đã thêm ${count} acc vào dữ liệu local!`, count });
  }
});

/* ─── FORM SỬA ACC ─── */
router.get('/acc/sua/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    await ensureCtvSchema();
    const [[acc]] = await db.query(`
      SELECT a.*, g.slug AS game_slug, at.slug AS acc_type
      FROM accounts a
      JOIN game_categories g ON g.id=a.category_id
      LEFT JOIN acc_types at ON at.id=a.acc_type_id
      WHERE a.id=?
    `, [id]);
    if (!acc) {
      req.flash('error', 'Acc không tồn tại!');
      return res.redirect('/admin/acc');
    }

    const [games] = await db.query('SELECT * FROM game_categories WHERE is_active=1 ORDER BY sort_order, name ASC');
    const [ctvUsers] = await db.query('SELECT id, username, email FROM users WHERE role="staff" ORDER BY username ASC');
    res.render('admin/acc-edit', {
      layout: false,
      title: 'Sửa Acc',
      admin: req.session.user,
      acc,
      games,
      ctvUsers,
      success_msg: req.flash('success'),
      error_msg: req.flash('error'),
      page_name: 'acc'
    });
  } catch (err) {
    const acc = await localStore.getAccount(id);
    if (!acc) {
      req.flash('error', 'Acc không tồn tại!');
      return res.redirect('/admin/acc');
    }
    res.render('admin/acc-edit', {
      layout: false,
      title: 'Sửa Acc',
      admin: req.session.user,
      acc,
      games: localStore.categories,
      ctvUsers: (await localStore.readUsers()).filter(u => u.role === 'staff'),
      success_msg: req.flash('success'),
      error_msg: req.flash('error'),
      page_name: 'acc'
    });
  }
});

/* ─── LƯU SỬA ACC ─── */
router.post('/acc/sua/:id', upload.single('image'), async (req, res) => {
  const id = parseInt(req.params.id);
  const {
    game_slug, acc_username, acc_password, acc_info,
    title, price, rank_name, server, acc_type, ctv_id
  } = req.body;

  if (!game_slug || !acc_username || !acc_password || !price) {
    req.flash('error', 'Vui lòng điền đầy đủ thông tin bắt buộc!');
    return res.redirect(`/admin/acc/sua/${id}`);
  }

  try {
    await ensureCtvSchema();
    const categoryRow = await findCategoryBySlug(game_slug);
    if (!categoryRow) {
      req.flash('error', 'Game không hợp lệ!');
      return res.redirect(`/admin/acc/sua/${id}`);
    }

    const [[oldAcc]] = await db.query('SELECT * FROM accounts WHERE id=?', [id]);
    if (!oldAcc) {
      req.flash('error', 'Acc không tồn tại!');
      return res.redirect('/admin/acc');
    }

    const accTypeId = await findAccTypeId(categoryRow.id, acc_type);
    const imageUrl = req.file ? '/uploads/acc/' + req.file.filename : oldAcc.images;
    const ctvId = ctv_id ? parseInt(ctv_id) : null;

    await db.query(`
      UPDATE accounts
      SET category_id=?, acc_type_id=?, acc_username=?, acc_password=?,
          acc_info=?, title=?, price=?, rank=?, server=?, images=?, ctv_id=?
      WHERE id=?
    `, [
      categoryRow.id,
      accTypeId,
      acc_username,
      acc_password,
      acc_info || null,
      title || null,
      price,
      rank_name || null,
      server || null,
      imageUrl || null,
      ctvId || null,
      id
    ]);

    req.flash('success', `✅ Đã cập nhật acc #${id}`);
    res.redirect('/admin/acc');
  } catch (err) {
    await localStore.updateAccount(id, { ...req.body, image_url: req.file ? '/uploads/acc/' + req.file.filename : null });
    req.flash('success', `✅ Đã cập nhật acc #${id} trong dữ liệu local`);
    res.redirect('/admin/acc');
  }
});

/* ─── XÓA ACC ─── */
router.post('/acc/xoa/:id', async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const [[acc]] = await db.query('SELECT * FROM accounts WHERE id=?', [id]);
    if (!acc) { req.flash('error', 'Acc không tồn tại!'); return res.redirect('/admin/acc'); }
    if (acc.status === 'sold') { req.flash('error', 'Không thể xóa acc đã bán!'); return res.redirect('/admin/acc'); }
    const imageUrl = acc.images ? acc.images.split(',')[0].trim() : '';
    if (imageUrl) {
      const imgPath = path.join(__dirname, '../public', imageUrl);
      if (fs.existsSync(imgPath)) fs.unlinkSync(imgPath);
    }
    await db.query('DELETE FROM accounts WHERE id=?', [id]);
    req.flash('success', `✅ Đã xóa acc #${id}`);
  } catch (err) {
    const ok = await localStore.deleteAccount(id);
    req.flash(ok ? 'success' : 'error', ok ? `✅ Đã xóa acc #${id} trong dữ liệu local` : 'Không thể xóa acc này!');
  }
  res.redirect('/admin/acc');
});

/* ─── DANH SÁCH USERS ─── */
router.get('/users', async (req, res) => {
  const search = req.query.search || '';
  const page   = parseInt(req.query.page) || 1;
  const limit  = 20;
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params = [];
  where = addUserSearch(where, params, search);

  try {
    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM users u ${where}`, params);
    const [users] = await db.query(`
      SELECT u.*,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) as order_count,
        (SELECT COALESCE(SUM(amount),0) FROM transactions t WHERE t.user_id=u.id AND t.type='deposit' AND t.status='success') as total_deposit
      FROM users u ${where}
      ORDER BY u.id DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.render('admin/users', {
      layout: false, title: 'Quản Lý Users', admin: req.session.user,
      users, total, page, totalPages: Math.ceil(total/limit), search,
      ctvSearchMode: false,
      success_msg: req.flash('success'), error_msg: req.flash('error'),
      page_name: 'users'
    });
  } catch (err) {
    console.error(err);
    let users = await localStore.readUsers();
    if (search) {
      const key = search.toLowerCase();
      users = users.filter(u => u.username.toLowerCase().includes(key) || u.email.toLowerCase().includes(key));
    }
    res.render('admin/users', {
      layout: false, title: 'Quản Lý Users', admin: req.session.user,
      users, total:users.length, page:1, totalPages:1, search,
      success_msg:req.flash('success'), error_msg:['Đang dùng dữ liệu local vì MySQL chưa bật'], page_name:'users'
    });
  }
});

/* ─── DANH SÁCH CTV ─── */
router.get('/ctv', async (req, res) => {
  const search = req.query.search || '';
  const page   = parseInt(req.query.page) || 1;
  const limit  = 20;
  const offset = (page - 1) * limit;

  let where = search ? 'WHERE 1=1' : "WHERE u.role='staff'";
  const params = [];
  where = addUserSearch(where, params, search);

  try {
    await ensureCtvSchema();
    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM users u ${where}`, params);
    const [ctvList] = await db.query(`
      SELECT u.*,
        (SELECT COUNT(*) FROM orders o WHERE o.user_id=u.id) as order_count,
        (SELECT COALESCE(SUM(amount),0) FROM transactions t WHERE t.user_id=u.id AND t.type='deposit' AND t.status='success') as total_deposit
      FROM users u ${where}
      ORDER BY u.id DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);
    const [withdrawals] = await db.query(`
      SELECT w.*, u.username
      FROM ctv_withdrawals w
      LEFT JOIN users u ON u.id=w.ctv_id
      ORDER BY w.created_at DESC LIMIT 50
    `);
    const [ctvSales] = await db.query(`
      SELECT cs.*, u.username, a.title, a.acc_username
      FROM ctv_sales cs
      LEFT JOIN users u ON u.id=cs.ctv_id
      LEFT JOIN accounts a ON a.id=cs.account_id
      ORDER BY cs.created_at DESC LIMIT 50
    `);
    const [assignableUsers] = await db.query(`
      SELECT id, username, email
      FROM users
      WHERE role <> 'staff' AND role <> 'superadmin'
      ORDER BY id DESC LIMIT 100
    `);
    const commissionGames = await getCtvCommissionSettings();

    res.render('admin/ctv', {
      layout: false, title: 'Quản Lý CTV',
      admin: req.session.user, ctvList, withdrawals, ctvSales, assignableUsers, commissionGames, total, page,
      totalPages: Math.ceil(total/limit), search,
      resetUrl: '/admin/ctv', ctvSearchMode: Boolean(search),
      success_msg: req.flash('success'), error_msg: req.flash('error'),
      page_name: 'ctv'
    });
  } catch (err) {
    console.error(err);
    let ctvList = await localStore.readUsers();
    if (!search) ctvList = ctvList.filter(u => u.role === 'staff');
    if (search) {
      const key = search.toLowerCase();
      const idKey = key.replace(/^#/, '');
      ctvList = ctvList.filter(u =>
        String(u.id) === idKey ||
        u.username.toLowerCase().includes(key) ||
        String(u.email || '').toLowerCase().includes(key)
      );
    }
    const withdrawals = await localStore.getCtvWithdrawals();
    const ctvSales = await localStore.getCtvSales();
    const assignableUsers = (await localStore.readUsers()).filter(u => u.role !== 'staff' && u.role !== 'superadmin');
    const runtime = await localStore.readRuntime();
    const ctvCommission = runtime.settings?.ctv_commission || {};
    const commissionGames = localStore.categories.map(game => ({
      ...game,
      commission_percent: Number(ctvCommission[game.id] ?? 100)
    }));
    res.render('admin/ctv', {
      layout: false, title: 'Quản Lý CTV',
      admin: req.session.user, ctvList, withdrawals, ctvSales, assignableUsers, commissionGames, total:ctvList.length,
      page:1, totalPages:1, search, resetUrl: '/admin/ctv',
      ctvSearchMode: Boolean(search),
      success_msg:req.flash('success'), error_msg:['Đang dùng dữ liệu local vì MySQL chưa bật'], page_name:'ctv'
    });
  }
});

router.post('/ctv/create', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) {
    return res.json({ success: false, message: 'Vui lòng nhập đầy đủ username, email và mật khẩu.' });
  }
  if (String(password).length < 6) {
    return res.json({ success: false, message: 'Mật khẩu CTV tối thiểu 6 ký tự.' });
  }

  try {
    await ensureCtvSchema();
    const [[exist]] = await db.query(
      'SELECT id FROM users WHERE username=? OR email=?',
      [username.trim(), email.trim().toLowerCase()]
    );
    if (exist) return res.json({ success: false, message: 'Username hoặc email đã tồn tại.' });

    const hash = await bcrypt.hash(password, 10);
    await db.query(
      'INSERT INTO users (username, email, password, role, ctv_balance) VALUES (?, ?, ?, "staff", 0)',
      [username.trim(), email.trim().toLowerCase(), hash]
    );
    return res.json({ success: true, message: 'Đã tạo tài khoản CTV.' });
  } catch (err) {
    const users = await localStore.readUsers();
    const cleanUsername = username.trim();
    const cleanEmail = email.trim().toLowerCase();
    const exists = users.find(u =>
      u.username.toLowerCase() === cleanUsername.toLowerCase() ||
      String(u.email || '').toLowerCase() === cleanEmail
    );
    if (exists) return res.json({ success: false, message: 'Username hoặc email đã tồn tại.' });
    users.push({
      id: Date.now(),
      username: cleanUsername,
      email: cleanEmail,
      password: await bcrypt.hash(password, 10),
      role: 'staff',
      balance: 0,
      ctv_balance: 0,
      is_active: 1,
      created_at: new Date().toISOString()
    });
    await localStore.writeUsers(users);
    return res.json({ success: true, message: 'Đã tạo tài khoản CTV local.' });
  }
});

router.post('/ctv/commission', async (req, res) => {
  const body = req.body || {};
  const readRawPercent = gameId =>
    body[`commission_game_${gameId}`] ??
    body[`commission[${gameId}]`] ??
    body.commission?.[String(gameId)];
  const parsePercent = raw => {
    const normalized = String(raw ?? '').replace(',', '.').trim();
    const value = Number(normalized);
    return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0;
  };
  try {
    await ensureCtvSchema();
    const [games] = await db.query('SELECT id FROM game_categories WHERE is_active=1');
    for (const game of games) {
      const raw = readRawPercent(game.id);
      if (raw === undefined) continue;
      const pct = parsePercent(raw);
      const key = `ctv_commission_game_${game.id}`;
      await db.query('DELETE FROM settings WHERE `key`=?', [key]);
      await db.query('INSERT INTO settings (`key`, value) VALUES (?, ?)', [key, String(pct)]);
    }
    req.flash('success', 'Đã lưu % hoa hồng CTV theo game.');
  } catch (_) {
    const runtime = await localStore.readRuntime();
    runtime.settings = runtime.settings || {};
    runtime.settings.ctv_commission = runtime.settings.ctv_commission || {};
    for (const game of localStore.categories) {
      const raw = readRawPercent(game.id);
      if (raw !== undefined) runtime.settings.ctv_commission[game.id] = parsePercent(raw);
    }
    await localStore.writeRuntime(runtime);
    req.flash('success', 'Đã lưu % hoa hồng CTV local.');
  }
  res.redirect('/admin/ctv');
});

router.post('/ctv/assign', async (req, res) => {
  const userId = Number(req.body.user_id);
  if (!userId) return res.json({ success: false, message: 'User không hợp lệ.' });

  try {
    await ensureCtvSchema();
    const [[user]] = await db.query('SELECT id FROM users WHERE id=?', [userId]);
    if (!user) return res.json({ success: false, message: 'User không tồn tại.' });
    await db.query('UPDATE users SET role="staff", ctv_balance=COALESCE(ctv_balance,0) WHERE id=?', [userId]);
    return res.json({ success: true, message: 'Đã gán user thành CTV.' });
  } catch (_) {
    const users = await localStore.readUsers();
    const user = users.find(u => Number(u.id) === userId);
    if (!user) return res.json({ success: false, message: 'User không tồn tại.' });
    user.role = 'staff';
    user.ctv_balance = Number(user.ctv_balance || 0);
    await localStore.writeUsers(users);
    return res.json({ success: true, message: 'Đã gán user thành CTV local.' });
  }
});

router.post('/ctv/approve-withdrawal', async (req, res) => {
  const id = Number(req.body.id);
  if (!id) return res.json({ success: false, message: 'Yêu cầu không hợp lệ.' });

  try {
    await ensureCtvSchema();
    const [[w]] = await db.query('SELECT * FROM ctv_withdrawals WHERE id=? AND status="pending"', [id]);
    if (!w) return res.json({ success: false, message: 'Yêu cầu không tồn tại hoặc đã xử lý.' });
    await db.query('UPDATE users SET ctv_balance=GREATEST(0, COALESCE(ctv_balance,0)-?) WHERE id=?', [w.amount, w.ctv_id]);
    await db.query('UPDATE ctv_withdrawals SET status="approved", approved_at=NOW() WHERE id=?', [id]);
    return res.json({ success: true, message: 'Đã duyệt yêu cầu rút tiền.' });
  } catch (_) {
    const ok = await localStore.approveCtvWithdrawal(id);
    return res.json({ success: Boolean(ok), message: ok ? 'Đã duyệt yêu cầu rút tiền local.' : 'Không xử lý được yêu cầu.' });
  }
});

router.post('/ctv/reject-withdrawal', async (req, res) => {
  const id = Number(req.body.id);
  if (!id) return res.json({ success: false, message: 'Yêu cầu không hợp lệ.' });

  try {
    await ensureCtvSchema();
    const [result] = await db.query(
      'UPDATE ctv_withdrawals SET status="rejected", rejected_at=NOW() WHERE id=? AND status="pending"',
      [id]
    );
    return res.json({
      success: result.affectedRows > 0,
      message: result.affectedRows > 0 ? 'Đã từ chối yêu cầu rút tiền.' : 'Yêu cầu không tồn tại hoặc đã xử lý.'
    });
  } catch (_) {
    const ok = await localStore.rejectCtvWithdrawal(id);
    return res.json({ success: Boolean(ok), message: ok ? 'Đã từ chối yêu cầu local.' : 'Không xử lý được yêu cầu.' });
  }
});

/* ─── ĐỔI ROLE USER ─── */
router.post('/users/set-role', async (req, res) => {
  const body = req.body || {};
  const user_id = body.user_id;
  const requestedRole = String(body.role || '').trim().toLowerCase();
  const role = requestedRole === 'ctv' ? 'staff' : requestedRole;
  const validRoles = ['customer', 'staff', 'admin', 'superadmin'];
  if (!validRoles.includes(role)) return res.json({ success: false, message: 'Role không hợp lệ!' });
  // Không cho đổi role superadmin của chính mình
  if (parseInt(user_id) === req.session.user.id) return res.json({ success: false, message: 'Không thể đổi role của chính mình!' });
  try {
    await ensureCtvSchema();
    await db.query('UPDATE users SET role=?, ctv_balance=COALESCE(ctv_balance,0) WHERE id=?', [role, user_id]);
    return res.json({ success: true, message: 'Đã cập nhật role!' });
  } catch (_) {
    const users = await localStore.readUsers();
    const user = users.find(u => Number(u.id) === Number(user_id));
    if (!user) return res.json({ success: false, message: 'User không tồn tại!' });
    user.role = role;
    if (role === 'staff') user.ctv_balance = Number(user.ctv_balance || 0);
    await localStore.writeUsers(users);
    return res.json({ success: true, message: 'Đã cập nhật role local!' });
  }
});

/* ─── ĐIỀU CHỈNH SỐ DƯ USER ─── */
router.post('/users/adjust-balance', async (req, res) => {
  const { user_id, amount, note } = req.body;
  const amt = parseInt(amount);
  if (!user_id || isNaN(amt)) return res.json({ success: false, message: 'Dữ liệu không hợp lệ!' });

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();
    const [[user]] = await conn.query('SELECT * FROM users WHERE id=? FOR UPDATE', [user_id]);
    if (!user) { await conn.rollback(); return res.json({ success: false, message: 'User không tồn tại!' }); }
    const before = Number(user.balance);
    const after  = Math.max(0, before + amt);
    await conn.query('UPDATE users SET balance=? WHERE id=?', [after, user_id]);
    await conn.query(`
      INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, payment_method, status, note)
      VALUES (?, 'admin_adjust', ?, ?, ?, 'admin', 'success', ?)
    `, [user_id, amt, before, after, note || 'Admin điều chỉnh']);
    await conn.commit();
    return res.json({ success: true, message: `Đã điều chỉnh ${amt>0?'+':''}${amt}đ cho user #${user_id}`, new_balance: after });
  } catch (err) {
    if (conn) await conn.rollback();
    const result = await localStore.adjustBalance(user_id, amt, note || 'Admin điều chỉnh');
    if (!result) return res.json({ success: false, message: 'User không tồn tại!' });
    return res.json({ success: true, message: `Đã điều chỉnh ${amt>0?'+':''}${amt}đ cho user #${user_id} (local)`, new_balance: result.after });
  } finally {
    if (conn) conn.release();
  }
});

/* ─── ORDERS ─── */
router.get('/orders', async (req, res) => {
  const page   = parseInt(req.query.page) || 1;
  const limit  = 20;
  const offset = (page - 1) * limit;
  const search = req.query.search || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (search) { where += ' AND (u.username LIKE ? OR a.acc_username LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }

  try {
    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM orders o JOIN users u ON o.user_id=u.id JOIN accounts a ON o.account_id=a.id ${where}`, params);
    const [orders] = await db.query(`
      SELECT o.*, u.username, a.acc_username, g.slug AS game_slug
      FROM orders o
      JOIN users u ON o.user_id=u.id
      JOIN accounts a ON o.account_id=a.id
      JOIN game_categories g ON g.id=a.category_id
      ${where} ORDER BY o.created_at DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.render('admin/orders', {
      layout: false, title: 'Đơn Hàng', admin: req.session.user,
      orders, total, page, totalPages: Math.ceil(total/limit), search,
      page_name: 'orders'
    });
  } catch (err) {
    const orders = await localStore.listOrders();
    res.render('admin/orders', {
      layout: false, title: 'Đơn Hàng', admin: req.session.user,
      orders, total:orders.length, page:1, totalPages:1, search, page_name:'orders'
    });
  }
});

/* ─── PAYMENT LOGS ─── */
router.get('/payments', async (req, res) => {
  const page   = parseInt(req.query.page) || 1;
  const limit  = 20;
  const offset = (page - 1) * limit;
  const filter = req.query.filter || '';

  let where = 'WHERE 1=1';
  const params = [];
  if (filter === 'unprocessed') { where += ' AND is_processed=0'; }
  if (filter === 'processed')   { where += ' AND is_processed=1'; }

  try {
    const [[{ total }]] = await db.query(`SELECT COUNT(*) as total FROM payment_logs ${where}`, params);
    const [logs] = await db.query(`
      SELECT pl.*, u.username as matched_username
      FROM payment_logs pl
      LEFT JOIN users u ON pl.matched_user=u.id
      ${where} ORDER BY pl.id DESC LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    res.render('admin/payments', {
      layout: false, title: 'Payment Logs', admin: req.session.user,
      logs, total, page, totalPages: Math.ceil(total/limit), filter,
      success_msg: req.flash('success'), error_msg: req.flash('error'),
      page_name: 'payments'
    });
  } catch (err) {
    const logs = await localStore.listPaymentLogs();
    res.render('admin/payments', {
      layout: false, title: 'Payment Logs', admin: req.session.user,
      logs, total:logs.length, page:1, totalPages:1, filter,
      success_msg:[], error_msg:['Đang dùng dữ liệu local vì MySQL chưa bật'], page_name:'payments'
    });
  }
});

/* ─── XỬ LÝ THỦ CÔNG ─── */
router.post('/payments/xu-ly', async (req, res) => {
  const { log_id, user_id, amount } = req.body;
  const amt = parseInt(amount);
  if (!log_id || !user_id || isNaN(amt) || amt <= 0) {
    return res.json({ success: false, message: 'Dữ liệu không hợp lệ!' });
  }

  let conn;
  try {
    conn = await db.getConnection();
    await conn.beginTransaction();
    const [[log]] = await conn.query('SELECT * FROM payment_logs WHERE id=?', [log_id]);
    if (!log) { await conn.rollback(); return res.json({ success: false, message: 'Log không tồn tại!' }); }
    if (log.is_processed) { await conn.rollback(); return res.json({ success: false, message: 'Đã xử lý rồi!' }); }

    const [[user]] = await conn.query('SELECT * FROM users WHERE id=? FOR UPDATE', [user_id]);
    if (!user) { await conn.rollback(); return res.json({ success: false, message: 'User không tồn tại!' }); }

    const before = Number(user.balance);
    const bonus  = Math.floor(amt * 0.10);
    const total  = amt + bonus;
    const after  = before + total;

    await conn.query('UPDATE users SET balance=? WHERE id=?', [after, user_id]);
    await conn.query(`
      INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, payment_method, transfer_ref, transfer_content, status)
      VALUES (?, 'deposit', ?, ?, ?, 'manual', ?, ?, 'success')
    `, [user_id, total, before, after, 'manual', log.ref_code || '', log.content || '']);
    await conn.query('UPDATE payment_logs SET is_processed=1, matched_user=? WHERE id=?', [user_id, log_id]);

    await conn.commit();
    return res.json({ success: true, message: `✅ Đã cộng ${total.toLocaleString('vi-VN')}đ (+${bonus.toLocaleString()}đ bonus) cho user #${user_id}` });
  } catch (err) {
    if (conn) await conn.rollback();
    const bonus = Math.floor(amt * 0.10);
    const total = amt + bonus;
    const result = await localStore.adjustBalance(user_id, total, 'Admin xử lý nạp thủ công');
    if (!result) return res.json({ success: false, message: 'User không tồn tại!' });
    return res.json({ success: true, message: `✅ Đã cộng ${total.toLocaleString('vi-VN')}đ (+${bonus.toLocaleString()}đ bonus) cho user #${user_id} (local)` });
  } finally {
    if (conn) conn.release();
  }
});

/* ─── XÓA PAYMENT LOG ─── */
router.post('/payments/xoa/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM payment_logs WHERE id=?', [req.params.id]);
    req.flash('success', '🗑️ Đã xóa log #' + req.params.id);
  } catch (err) {
    req.flash('error', 'Lỗi xóa: ' + err.message);
  }
  const back = req.get('Referer') || '/admin/payments';
  res.redirect(back);
});

/* ─── GỬI THÔNG BÁO ─── */
router.get('/notifications', async (req, res) => {
  try {
    const [recent] = await db.query(`
      SELECT n.*, u.username
      FROM notifications n
      JOIN users u ON u.id=n.user_id
      ORDER BY n.created_at DESC LIMIT 30
    `);

    res.render('admin/notifications', {
      layout: false,
      title: 'Gửi Thông Báo',
      admin: req.session.user,
      recent,
      success_msg: req.flash('success'),
      error_msg: req.flash('error'),
      page_name: 'notifications'
    });
  } catch (err) {
    const runtime = await localStore.readRuntime();
    const users = await localStore.readUsers();
    const recent = runtime.notifications
      .slice()
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 30)
      .map(n => ({ ...n, username: users.find(u => Number(u.id) === Number(n.user_id))?.username || `user#${n.user_id}` }));
    res.render('admin/notifications', {
      layout: false,
      title: 'Gửi Thông Báo',
      admin: req.session.user,
      recent,
      success_msg: [],
      error_msg: ['Đang dùng dữ liệu local vì MySQL chưa bật'],
      page_name: 'notifications'
    });
  }
});

router.post('/notifications', async (req, res) => {
  const { target, username, title, message, link, type } = req.body;
  if (!title || !message) {
    req.flash('error', 'Vui lòng nhập tiêu đề và nội dung!');
    return res.redirect('/admin/notifications');
  }

  try {
    let users = [];
    if (target === 'one') {
      if (!username) {
        req.flash('error', 'Vui lòng nhập username cần gửi!');
        return res.redirect('/admin/notifications');
      }
      const [rows] = await db.query('SELECT id FROM users WHERE username=? OR email=?', [username, username]);
      users = rows;
    } else {
      const [rows] = await db.query('SELECT id FROM users WHERE is_active=1');
      users = rows;
    }

    if (users.length === 0) {
      req.flash('error', 'Không tìm thấy user phù hợp!');
      return res.redirect('/admin/notifications');
    }

    const rows = users.map(u => [
      u.id,
      type || 'system',
      title.trim(),
      message.trim(),
      link?.trim() || null
    ]);
    await db.query(
      'INSERT INTO notifications (user_id, type, title, message, link) VALUES ?',
      [rows]
    );

    req.flash('success', `✅ Đã gửi thông báo cho ${users.length} user`);
    res.redirect('/admin/notifications');
  } catch (err) {
    const users = await localStore.readUsers();
    const targets = target === 'one'
      ? users.filter(u => u.username === username || u.email === username)
      : users.filter(u => u.role !== 'guest');
    for (const u of targets) {
      await localStore.addNotification({
        userId: u.id,
        type: type || 'system',
        title: title.trim(),
        message: message.trim(),
        link: link?.trim() || null
      });
    }
    if (!targets.length) req.flash('error', 'Không tìm thấy user phù hợp!');
    else req.flash('success', `✅ Đã gửi thông báo local cho ${targets.length} user`);
    res.redirect('/admin/notifications');
  }
});

/* ─── NỘI DUNG WEBSITE ─── */
router.get('/content', async (req, res) => {
  try {
    const [settings] = await db.query('SELECT * FROM settings WHERE `key` LIKE "content_%" ORDER BY `key` ASC');
    const content = {};
    settings.forEach(s => {
      content[s.key.replace(/^content_/, '')] = s.value;
    });
    res.render('admin/content', {
      layout: false,
      title: 'Nội Dung Website',
      admin: req.session.user,
      content: mergeContent(content),
      success_msg: req.flash('success'),
      error_msg: req.flash('error'),
      page_name: 'content'
    });
  } catch (err) {
    const runtime = await localStore.readRuntime();
    res.render('admin/content', {
      layout: false,
      title: 'Nội Dung Website',
      admin: req.session.user,
      content: mergeContent(runtime.settings?.content || {}),
      success_msg: req.flash('success'),
      error_msg: ['Đang dùng nội dung local vì MySQL chưa bật'],
      page_name: 'content'
    });
  }
});

router.post('/content', async (req, res) => {
  const allowed = Object.keys(contentDefaults);
  const content = {};
  allowed.forEach(key => {
    if (req.body[key] !== undefined) content[key] = String(req.body[key]).trim();
  });

  try {
    for (const [key, value] of Object.entries(content)) {
      await db.query(
        'INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?',
        [`content_${key}`, value, value]
      );
    }
    req.flash('success', '✅ Đã lưu nội dung website!');
  } catch (err) {
    const runtime = await localStore.readRuntime();
    runtime.settings = runtime.settings || {};
    runtime.settings.content = { ...(runtime.settings.content || {}), ...content };
    await localStore.writeRuntime(runtime);
    req.flash('success', '✅ Đã lưu nội dung website local!');
  }
  res.redirect('/admin/content');
});

/* ─── SETTINGS ─── */
router.get('/settings', async (req, res) => {
  try {
    const [settings] = await db.query('SELECT * FROM settings ORDER BY `key` ASC');
    const settingsMap = {};
    settings.forEach(s => settingsMap[s.key] = s.value);
    res.render('admin/settings', {
      layout: false, title: 'Cài Đặt Shop', admin: req.session.user,
      settings: settingsMap,
      success_msg: req.flash('success'), error_msg: req.flash('error'),
      page_name: 'settings'
    });
  } catch (err) {
    const runtime = await localStore.readRuntime();
    res.render('admin/settings', {
      layout: false, title: 'Cài Đặt Shop', admin: req.session.user,
      settings: runtime.settings || {},
      success_msg: req.flash('success'), error_msg: ['Đang dùng cài đặt local vì MySQL chưa bật'],
      page_name: 'settings'
    });
  }
});

router.post('/settings', async (req, res) => {
  const { shop_name, shop_desc, momo_number, momo_name, bank_number, bank_name, bank_branch, bonus_percent, min_deposit } = req.body;
  const pairs = [
    ['site_name', shop_name], ['shop_desc', shop_desc],
    ['momo_stk', momo_number], ['momo_name', momo_name],
    ['tpbank_stk', bank_number], ['tpbank_name', bank_name], ['bank_branch', bank_branch],
    ['deposit_bonus_pct', bonus_percent], ['min_deposit', min_deposit]
  ];
  try {
    for (const [key, val] of pairs) {
      if (val !== undefined) {
        await db.query('INSERT INTO settings (`key`, value) VALUES (?,?) ON DUPLICATE KEY UPDATE value=?', [key, val, val]);
      }
    }
    req.flash('success', '✅ Đã lưu cài đặt!');
  } catch (err) {
    const runtime = await localStore.readRuntime();
    runtime.settings = runtime.settings || {};
    for (const [key, value] of pairs) {
      if (value !== undefined) runtime.settings[key] = value;
    }
    await localStore.writeRuntime(runtime);
    req.flash('success', '✅ Đã lưu cài đặt local!');
    return res.redirect('/admin/settings');
  }
  res.redirect('/admin/settings');
});

module.exports = router;
