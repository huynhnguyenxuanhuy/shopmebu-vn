/* ============================================
   routes/auth.js – Đăng ký / Đăng nhập / Đăng xuất / OAuth
   ============================================ */
const express   = require('express');
const router    = express.Router();
const bcrypt    = require('bcryptjs');
const fs        = require('fs/promises');
const path      = require('path');
const db        = require('../config/db');
const passport  = require('../config/passport');
const localStore = require('../utils/localStore');

const localUsersFile = path.join(__dirname, '../data/local-users.json');

/* ---- Helper: đặt session sau OAuth ---- */
function setSessionFromUser(req, user) {
  req.session.user = {
    id:       user.id,
    username: user.username,
    email:    user.email,
    role:     user.role     || 'customer',
    balance:  Number(user.balance) || 0,
    avatar:   user.avatar   || null
  };
}

async function readLocalUsers() {
  try {
    return JSON.parse(await fs.readFile(localUsersFile, 'utf8'));
  } catch (_) {
    return [];
  }
}

async function writeLocalUsers(users) {
  await fs.mkdir(path.dirname(localUsersFile), { recursive: true });
  await fs.writeFile(localUsersFile, JSON.stringify(users, null, 2), 'utf8');
}

async function createLocalUser({ username, email, password, provider = 'local' }) {
  const users = await readLocalUsers();
  const cleanUsername = username.trim();
  const cleanEmail = email.trim().toLowerCase();
  const exists = users.find(u =>
    u.username.toLowerCase() === cleanUsername.toLowerCase() ||
    u.email.toLowerCase() === cleanEmail
  );
  if (exists) return { exists };

  const user = {
    id: Date.now(),
    username: cleanUsername,
    email: cleanEmail,
    password: password ? await bcrypt.hash(password, 10) : '',
    role: 'customer',
    balance: 0,
    avatar: null,
    auth_provider: provider,
    created_at: new Date().toISOString()
  };
  users.push(user);
  await writeLocalUsers(users);
  return { user };
}

async function ensureCtvSchema() {
  const [balanceCol] = await db.query("SHOW COLUMNS FROM users LIKE 'ctv_balance'");
  if (!balanceCol.length) await db.query('ALTER TABLE users ADD COLUMN ctv_balance DECIMAL(15,0) DEFAULT 0');

  const [ctvCol] = await db.query("SHOW COLUMNS FROM accounts LIKE 'ctv_id'");
  if (!ctvCol.length) await db.query('ALTER TABLE accounts ADD COLUMN ctv_id INT DEFAULT NULL');

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
  await db.query(`
    CREATE TABLE IF NOT EXISTS ctv_sales (
      id INT AUTO_INCREMENT PRIMARY KEY,
      ctv_id INT NOT NULL,
      account_id INT NOT NULL,
      order_id INT DEFAULT NULL,
      amount DECIMAL(15,0) NOT NULL,
      status ENUM('credited') DEFAULT 'credited',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
}

async function findLocalUser(login, password) {
  const key = login.trim().toLowerCase();
  const users = await readLocalUsers();
  const user = users.find(u =>
    u.username.toLowerCase() === key ||
    u.email.toLowerCase() === key
  );
  if (!user || !user.password || !(await bcrypt.compare(password, user.password))) return null;
  return user;
}

async function setDevOAuthSession(req, provider) {
  const providerName = provider === 'facebook' ? 'Facebook' : 'Google';
  const username = `${provider}_demo`;
  const email = `${provider}_demo@shopmebu.vn`;
  const { user, exists } = await createLocalUser({ username, email, password: '', provider });
  setSessionFromUser(req, user || exists);
  req.flash('success', `Đã đăng nhập demo bằng ${providerName}. Khi deploy thật chỉ cần cấu hình OAuth key trong .env.`);
}

function hasPassportStrategy(name) {
  return Boolean(passport._strategy(name));
}

// ===== ĐĂNG KÝ =====
router.get('/dang-ky', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.render('dang-ky', { title: 'Đăng Ký', page: 'auth' });
});

router.post('/dang-ky', async (req, res) => {
  const { username, email, password, password2 } = req.body;

  // Validate
  if (!username || !email || !password) {
    req.flash('error', 'Vui lòng điền đầy đủ thông tin!');
    return res.redirect('/dang-ky');
  }
  if (password !== password2) {
    req.flash('error', 'Mật khẩu xác nhận không khớp!');
    return res.redirect('/dang-ky');
  }
  if (password.length < 6) {
    req.flash('error', 'Mật khẩu phải có ít nhất 6 ký tự!');
    return res.redirect('/dang-ky');
  }

  try {
    // Kiểm tra trùng
    const [[exist]] = await db.query(
      'SELECT id FROM users WHERE username=? OR email=?', [username, email]
    );
    if (exist) {
      req.flash('error', 'Tên đăng nhập hoặc email đã được sử dụng!');
      return res.redirect('/dang-ky');
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [username.trim(), email.trim().toLowerCase(), hash]
    );

    // Tự đăng nhập luôn
    req.session.user = { id: result.insertId, username: username.trim(), role: 'customer', balance: 0 };
    req.flash('success', `Chào mừng ${username}! Tài khoản đã được tạo thành công 🎉`);
    res.redirect('/');
  } catch (err) {
    console.error('Lỗi đăng ký:', err);
    try {
      const { user, exists } = await createLocalUser({ username, email, password });
      if (exists) {
        req.flash('error', 'Tên đăng nhập hoặc email đã được sử dụng!');
        return res.redirect('/dang-ky');
      }
      setSessionFromUser(req, user);
      req.flash('success', `Chào mừng ${username}! Tài khoản local đã được tạo thành công.`);
      return res.redirect('/');
    } catch (fallbackErr) {
      console.error('Lỗi đăng ký local:', fallbackErr);
      req.flash('error', 'Lỗi hệ thống, vui lòng thử lại!');
      res.redirect('/dang-ky');
    }
  }
});

// ===== ĐĂNG NHẬP =====
router.get('/dang-nhap', (req, res) => {
  if (req.session.user) return res.redirect('/');
  const returnUrl = req.query.returnUrl || '/';
  res.render('dang-nhap', { title: 'Đăng Nhập', page: 'auth', returnUrl, query: req.query.error || '' });
});

router.post('/dang-nhap', async (req, res) => {
  const { username, password, returnUrl } = req.body;
  const redirect = returnUrl || '/';

  if (!username || !password) {
    req.flash('error', 'Vui lòng điền đầy đủ thông tin!');
    return res.redirect('/dang-nhap');
  }

  try {
    const [[user]] = await db.query(
      'SELECT * FROM users WHERE (username=? OR email=?) AND is_active=1',
      [username, username]
    );

    if (!user || !(await bcrypt.compare(password, user.password))) {
      req.flash('error', 'Tên đăng nhập hoặc mật khẩu không đúng!');
      return res.redirect('/dang-nhap');
    }

    // Cập nhật updated_at (dùng để tính online)
    await db.query('UPDATE users SET updated_at=NOW() WHERE id=?', [user.id]);

    req.session.user = {
      id:       user.id,
      username: user.username,
      email:    user.email,
      role:     user.role,
      balance:  Number(user.balance),
      avatar:   user.avatar
    };

    req.flash('success', `Chào mừng trở lại, ${user.username}!`);
    res.redirect(redirect.startsWith('/') ? redirect : '/');
  } catch (err) {
    console.error('Lỗi đăng nhập:', err);
    try {
      const localUser = await findLocalUser(username, password);
      if (!localUser) {
        req.flash('error', 'Tên đăng nhập/email hoặc mật khẩu không đúng!');
        return res.redirect('/dang-nhap');
      }
      setSessionFromUser(req, localUser);
      req.flash('success', `Chào mừng trở lại, ${localUser.username}!`);
      return res.redirect(redirect.startsWith('/') ? redirect : '/');
    } catch (fallbackErr) {
      console.error('Lỗi đăng nhập local:', fallbackErr);
      req.flash('error', 'Lỗi hệ thống, vui lòng thử lại!');
      res.redirect('/dang-nhap');
    }
  }
});

// ===== ĐĂNG XUẤT =====
router.get('/dang-xuat', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie(process.env.SESSION_NAME || 'shopmebu.sid');
    res.clearCookie('connect.sid');
    res.redirect('/dang-nhap');
  });
});

// ===== TRANG CÁ NHÂN =====
router.get('/tai-khoan', async (req, res) => {
  if (!req.session.user) {
    req.flash('error', 'Vui lòng đăng nhập!');
    return res.redirect('/dang-nhap?returnUrl=/tai-khoan');
  }

  try {
    const userId = req.session.user.id;

    // Lấy thông tin user mới nhất
    const [[user]] = await db.query('SELECT * FROM users WHERE id=?', [userId]);

    // Lịch sử mua hàng
    const [orders] = await db.query(`
      SELECT o.*, a.rank, a.so_tuong, a.trang_phuc,
             g.name AS game_name, g.icon AS game_icon
      FROM orders o
      JOIN accounts a ON a.id = o.account_id
      JOIN game_categories g ON g.id = a.category_id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC LIMIT 20
    `, [userId]);

    // Lịch sử giao dịch
    const [transactions] = await db.query(`
      SELECT * FROM transactions WHERE user_id=?
      ORDER BY created_at DESC LIMIT 30
    `, [userId]);

    let ctvSales = [];
    let ctvWithdrawals = [];
    if (user.role === 'staff') {
      await ensureCtvSchema();
      [ctvSales] = await db.query(`
        SELECT cs.*, a.acc_username, a.title, a.rank, g.name AS game_name
        FROM ctv_sales cs
        LEFT JOIN accounts a ON a.id=cs.account_id
        LEFT JOIN game_categories g ON g.id=a.category_id
        WHERE cs.ctv_id=?
        ORDER BY cs.created_at DESC LIMIT 30
      `, [userId]);
      [ctvWithdrawals] = await db.query(`
        SELECT * FROM ctv_withdrawals
        WHERE ctv_id=?
        ORDER BY created_at DESC LIMIT 30
      `, [userId]);
    }

    // Sync session user data after admin changes role/balance.
    req.session.user.balance = Number(user.balance);
    req.session.user.role = user.role || 'customer';
    req.session.user.ctv_balance = Number(user.ctv_balance || 0);
    req.session.user.email = user.email;
    req.session.user.avatar = user.avatar;

    res.render('tai-khoan', {
      title: 'Tài Khoản Của Tôi',
      page: 'account',
      user, orders, transactions, ctvSales, ctvWithdrawals,
      siteUrl: `${req.protocol}://${req.get('host')}`
    });
  } catch (err) {
    console.error(err);
    const users = await localStore.readUsers();
    const localUser = users.find(u => Number(u.id) === Number(req.session.user.id)) || req.session.user;
    const orders = await localStore.getUserOrders(req.session.user.id);
    const transactions = await localStore.getUserTransactions(req.session.user.id);
    const ctvSales = localUser.role === 'staff' ? await localStore.getCtvSales(req.session.user.id) : [];
    const ctvWithdrawals = localUser.role === 'staff' ? await localStore.getCtvWithdrawals(req.session.user.id) : [];
    req.session.user.balance = Number(localUser.balance || 0);
    res.render('tai-khoan', {
      title: 'Tài Khoản Của Tôi',
      page: 'account',
      user: { ...req.session.user, ...localUser },
      orders,
      transactions,
      ctvSales,
      ctvWithdrawals,
      siteUrl: `${req.protocol}://${req.get('host')}`
    });
  }
});

/* ==================================================
   GOOGLE OAUTH
   ================================================== */
router.get('/auth/google', async (req, res, next) => {
  if (!hasPassportStrategy('google')) {
    await setDevOAuthSession(req, 'google');
    return res.redirect('/');
  }
  return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/dang-nhap?error=google' }),
  (req, res) => {
    setSessionFromUser(req, req.user);
    req.flash('success', `Chào mừng ${req.user.username}! Đã đăng nhập qua Google 🎉`);
    res.redirect('/');
  }
);

module.exports = router;
