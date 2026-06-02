/* ============================================
   routes/auth.js – Đăng ký / Đăng nhập / Đăng xuất / OAuth
   ============================================ */
const express   = require('express');
const router    = express.Router();
const bcrypt    = require('bcryptjs');
const fs        = require('fs/promises');
const fsSync    = require('fs');
const path      = require('path');
const multer    = require('multer');
const db        = require('../config/db');
const passport  = require('../config/passport');
const localStore = require('../utils/localStore');

const localUsersFile = path.join(__dirname, '../data/local-users.json');
const CTV_ACCOUNT_URL = '/tai-khoan#ctv';
const ctvUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../public/uploads/acc');
      fsSync.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      const unique = Date.now() + '_' + Math.round(Math.random() * 1e9);
      cb(null, 'ctv_' + unique + path.extname(file.originalname));
    }
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Chỉ nhận file ảnh!'));
    cb(null, true);
  }
});

/* ---- Helper: đặt session sau OAuth ---- */
function setSessionFromUser(req, user) {
  req.session.user = {
    id:       user.id,
    username: user.username,
    email:    user.email,
    role:     user.role     || 'customer',
    balance:  Number(user.balance) || 0,
    ctv_balance: Number(user.ctv_balance) || 0,
    avatar:   user.avatar   || null
  };
}

function safeReturnUrl(returnUrl, fallback = '/') {
  const target = String(returnUrl || fallback);
  if (!target.startsWith('/') || target.startsWith('//')) return fallback;
  return target;
}

function redirectAfterSessionSave(req, res, target) {
  req.session.save(err => {
    if (err) console.error('Lỗi lưu session:', err);
    res.redirect(target);
  });
}

function requireUserLogin(req, res, next) {
  if (req.session.user) return next();
  req.flash('error', 'Vui lòng đăng nhập!');
  return res.redirect('/dang-nhap?returnUrl=' + encodeURIComponent(CTV_ACCOUNT_URL));
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

  const [imagesCol] = await db.query("SHOW COLUMNS FROM accounts LIKE 'images'");
  if (imagesCol.length && !/text/i.test(String(imagesCol[0].Type || ''))) {
    await db.query('ALTER TABLE accounts MODIFY COLUMN images TEXT DEFAULT NULL');
  }

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
      commission_percent DECIMAL(5,2) DEFAULT 100,
      status ENUM('credited') DEFAULT 'credited',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
  const [percentCol] = await db.query("SHOW COLUMNS FROM ctv_sales LIKE 'commission_percent'");
  if (!percentCol.length) {
    await db.query('ALTER TABLE ctv_sales ADD COLUMN commission_percent DECIMAL(5,2) DEFAULT 100');
  }
}

async function findCategoryBySlug(slug) {
  const [[category]] = await db.query(
    'SELECT * FROM game_categories WHERE slug=? AND is_active=1',
    [slug]
  );
  return category || null;
}

async function findAccTypeId(categoryId, slug) {
  const [[type]] = await db.query(
    'SELECT id FROM acc_types WHERE category_id=? AND slug=?',
    [categoryId, slug]
  );
  return type?.id || null;
}

async function ensureAccTypeId(categoryId, slug) {
  const names = {
    'tu-chon': 'Tự Chọn',
    random: 'Túi Mù Random',
    vip: 'VIP Cao Cấp',
    reg: 'Acc REG',
    reroll: 'Acc Reroll'
  };
  if (!names[slug]) return null;
  const existingId = await findAccTypeId(categoryId, slug);
  if (existingId) return existingId;
  const [result] = await db.query(
    'INSERT INTO acc_types (category_id, name, slug) VALUES (?, ?, ?)',
    [categoryId, names[slug], slug]
  );
  return result.insertId;
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
  const username = `${provider}_demo`;
  const email = `${provider}_demo@shopmebu.vn`;
  const { user, exists } = await createLocalUser({ username, email, password: '', provider });
  setSessionFromUser(req, user || exists);
  req.flash('success', 'Đã đăng nhập demo bằng Google. Khi deploy thật chỉ cần cấu hình OAuth key trong .env.');
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
  const { username, password, password2 } = req.body;
  const cleanUsername = String(username || '').trim();
  const email = req.body.email || `${cleanUsername.toLowerCase()}@shopmebu.local`;

  // Validate
  if (!cleanUsername || !password) {
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
      'SELECT id FROM users WHERE username=? OR email=?', [cleanUsername, email]
    );
    if (exist) {
      req.flash('error', 'Tên đăng nhập hoặc email đã được sử dụng!');
      return res.redirect('/dang-ky');
    }

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (username, email, password) VALUES (?, ?, ?)',
      [cleanUsername, email.trim().toLowerCase(), hash]
    );

    // Tự đăng nhập luôn
    req.session.user = { id: result.insertId, username: cleanUsername, role: 'customer', balance: 0 };
    req.flash('success', `Chào mừng ${cleanUsername}! Tài khoản đã được tạo thành công 🎉`);
    redirectAfterSessionSave(req, res, '/');
  } catch (err) {
    console.error('Lỗi đăng ký:', err);
    try {
      const { user, exists } = await createLocalUser({ username: cleanUsername, email, password });
      if (exists) {
        req.flash('error', 'Tên đăng nhập hoặc email đã được sử dụng!');
        return res.redirect('/dang-ky');
      }
      setSessionFromUser(req, user);
      req.flash('success', `Chào mừng ${cleanUsername}! Tài khoản local đã được tạo thành công.`);
      return redirectAfterSessionSave(req, res, '/');
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
  const returnUrl = safeReturnUrl(req.query.returnUrl, '/');
  res.render('dang-nhap', { title: 'Đăng Nhập', page: 'auth', returnUrl, query: req.query.error || '' });
});

router.post('/dang-nhap', async (req, res) => {
  const { username, password, returnUrl } = req.body;
  const redirect = safeReturnUrl(returnUrl, '/');

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
      ctv_balance: Number(user.ctv_balance) || 0,
      avatar:   user.avatar
    };

    req.flash('success', `Chào mừng trở lại, ${user.username}!`);
    redirectAfterSessionSave(req, res, redirect);
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
      return redirectAfterSessionSave(req, res, redirect);
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
    if (!user) {
      return req.session.destroy(() => {
        res.clearCookie(process.env.SESSION_NAME || 'shopmebu.sid');
        res.clearCookie('connect.sid');
        res.redirect('/dang-nhap?returnUrl=/tai-khoan');
      });
    }

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
    let ctvGames = [];
    let ctvAccounts = [];
    if (user.role === 'staff') {
      try {
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
        [ctvGames] = await db.query('SELECT id, name, slug FROM game_categories WHERE is_active=1 ORDER BY sort_order, name ASC');
        [ctvAccounts] = await db.query(`
          SELECT a.id, a.title, a.price, a.status, a.created_at,
                 SUBSTRING_INDEX(a.images, ',', 1) AS thumb,
                 g.name AS game_name, at.name AS type_name
          FROM accounts a
          JOIN game_categories g ON g.id=a.category_id
          LEFT JOIN acc_types at ON at.id=a.acc_type_id
          WHERE a.ctv_id=? AND a.status='available'
          ORDER BY a.id DESC LIMIT 80
        `, [userId]);
      } catch (ctvErr) {
        console.error('Lỗi tải khu CTV:', ctvErr);
        ctvGames = localStore.categories;
        try {
          ctvSales = await localStore.getCtvSales(userId);
          ctvWithdrawals = await localStore.getCtvWithdrawals(userId);
          ctvAccounts = (await localStore.listAccounts({ status: 'available' }))
            .filter(acc => Number(acc.ctv_id) === Number(userId));
        } catch (_) {
          ctvSales = [];
          ctvWithdrawals = [];
          ctvAccounts = [];
        }
      }
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
      user, orders, transactions, ctvSales, ctvWithdrawals, ctvGames, ctvAccounts,
      siteUrl: `${req.protocol}://${req.get('host')}`
    });
  } catch (err) {
    console.error(err);
    let localUser = req.session.user;
    let orders = [];
    let transactions = [];
    let ctvSales = [];
    let ctvWithdrawals = [];
    let ctvGames = [];
    let ctvAccounts = [];
    try {
      const users = await localStore.readUsers();
      localUser = users.find(u => Number(u.id) === Number(req.session.user.id)) || req.session.user;
      orders = await localStore.getUserOrders(req.session.user.id);
      transactions = await localStore.getUserTransactions(req.session.user.id);
      if (localUser.role === 'staff') {
        ctvSales = await localStore.getCtvSales(req.session.user.id);
        ctvWithdrawals = await localStore.getCtvWithdrawals(req.session.user.id);
        ctvGames = localStore.categories;
        ctvAccounts = (await localStore.listAccounts({ status: 'available' }))
          .filter(acc => Number(acc.ctv_id) === Number(req.session.user.id));
      }
    } catch (fallbackErr) {
      console.error('Lỗi tải tài khoản local:', fallbackErr);
    }
    req.session.user.balance = Number(localUser.balance || req.session.user.balance || 0);
    res.render('tai-khoan', {
      title: 'Tài Khoản Của Tôi',
      page: 'account',
      user: { ...req.session.user, ...localUser },
      orders,
      transactions,
      ctvSales,
      ctvWithdrawals,
      ctvGames,
      ctvAccounts,
      siteUrl: `${req.protocol}://${req.get('host')}`
    });
  }
});

router.post('/ctv/dang-acc', requireUserLogin, ctvUpload.fields([
  { name: 'images', maxCount: 8 },
  { name: 'image', maxCount: 8 }
]), async (req, res) => {
  const { game_slug, acc_username, acc_password, acc_info, title, price, server, acc_type } = req.body;
  const cleanPrice = Number(price || 0);
  const uploadedFiles = [
    ...((req.files && req.files.images) || []),
    ...((req.files && req.files.image) || [])
  ];
  const imageUrl = uploadedFiles.map(file => '/uploads/acc/' + file.filename).join(',') || null;
  if (!game_slug || !acc_username || !acc_password || cleanPrice <= 0) {
    req.flash('error', 'Vui lòng nhập đầy đủ game, tài khoản, mật khẩu và giá acc.');
    return res.redirect('/tai-khoan#ctv');
  }

  try {
    await ensureCtvSchema();
    const [[user]] = await db.query('SELECT id, role FROM users WHERE id=?', [req.session.user.id]);
    if (!user || user.role !== 'staff') {
      req.flash('error', 'Chỉ tài khoản CTV mới được tự đăng acc.');
      return res.redirect('/tai-khoan');
    }

    const categoryRow = await findCategoryBySlug(game_slug);
    if (!categoryRow) {
      req.flash('error', 'Game không hợp lệ.');
      return res.redirect('/tai-khoan#ctv');
    }

    const accTypeId = await ensureAccTypeId(categoryRow.id, acc_type || 'tu-chon');
    await db.query(`
      INSERT INTO accounts
        (category_id, acc_type_id, acc_username, acc_password, acc_info, title, price, rank, server, images, status, ctv_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', ?)
    `, [
      categoryRow.id,
      accTypeId,
      String(acc_username).trim(),
      String(acc_password).trim(),
      acc_info || null,
      title || null,
      cleanPrice,
      null,
      server || null,
      imageUrl,
      req.session.user.id
    ]);
    req.flash('success', 'Đã đăng acc CTV, acc đã lên kho bán.');
  } catch (err) {
    console.error(err);
    try {
      const users = await localStore.readUsers();
      const localUser = users.find(u => Number(u.id) === Number(req.session.user.id));
      if (!localUser || localUser.role !== 'staff') {
        req.flash('error', 'Chỉ tài khoản CTV mới được tự đăng acc.');
        return res.redirect('/tai-khoan');
      }
      await localStore.addAccount({
        game_slug,
        acc_type: acc_type || 'tu-chon',
        acc_username,
        acc_password,
        acc_info,
        title,
        price: cleanPrice,
        rank_name: null,
        server,
        image_url: imageUrl,
        ctv_id: req.session.user.id
      });
      req.flash('success', 'Đã đăng acc CTV vào dữ liệu local.');
    } catch (fallbackErr) {
      console.error('Lỗi đăng acc CTV local:', fallbackErr);
      req.flash('error', 'Lỗi hệ thống khi đăng acc CTV, vui lòng thử lại.');
    }
  }

  res.redirect('/tai-khoan#ctv');
});

router.post('/ctv/acc/xoa/:id', requireUserLogin, async (req, res) => {
  const accId = Number(req.params.id);
  if (!Number.isInteger(accId) || accId <= 0) {
    req.flash('error', 'Acc không hợp lệ.');
    return res.redirect('/tai-khoan#ctv');
  }

  try {
    await ensureCtvSchema();
    const [[user]] = await db.query('SELECT id, role FROM users WHERE id=?', [req.session.user.id]);
    if (!user || user.role !== 'staff') {
      req.flash('error', 'Chỉ tài khoản CTV mới được xoá acc CTV.');
      return res.redirect('/tai-khoan');
    }
    const [result] = await db.query(
      'UPDATE accounts SET status="hidden" WHERE id=? AND ctv_id=? AND status="available"',
      [accId, req.session.user.id]
    );
    req.flash(result.affectedRows ? 'success' : 'error', result.affectedRows ? 'Đã gỡ acc khỏi danh sách đang bán.' : 'Không tìm thấy acc đang bán thuộc CTV này.');
  } catch (err) {
    console.error(err);
    const acc = await localStore.getAccount(accId);
    if (!acc || Number(acc.ctv_id) !== Number(req.session.user.id) || acc.status !== 'available') {
      req.flash('error', 'Không tìm thấy acc đang bán thuộc CTV này.');
    } else {
      await localStore.deleteAccount(accId);
      req.flash('success', 'Đã gỡ acc khỏi danh sách đang bán.');
    }
  }

  res.redirect('/tai-khoan#ctv');
});

/* ==================================================
   GOOGLE OAUTH
   ================================================== */
router.get('/auth/google', async (req, res, next) => {
  if (!hasPassportStrategy('google')) {
    await setDevOAuthSession(req, 'google');
    return redirectAfterSessionSave(req, res, '/');
  }
  return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
});

router.get('/auth/google/callback',
  passport.authenticate('google', { failureRedirect: '/dang-nhap?error=google' }),
  (req, res) => {
    setSessionFromUser(req, req.user);
    req.flash('success', `Chào mừng ${req.user.username}! Đã đăng nhập qua Google 🎉`);
    redirectAfterSessionSave(req, res, '/');
  }
);

module.exports = router;
