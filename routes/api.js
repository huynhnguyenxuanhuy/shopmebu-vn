/* ============================================
   routes/api.js
   - Webhook nhận tiền tự động (SePay)
   - API stats realtime
   - API mua acc tự động
   ============================================ */
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const localStore = require('../utils/localStore');
const { stableRef } = require('../middleware/security');
const {
  ensureTopDepositorsSchema,
  upsertTopDepositor,
  refreshTopDepositorRanks
} = require('../utils/topDepositors');

/* ─────────────────────────────────────────────
   HELPER: Tìm user từ nội dung chuyển khoản
   Mã nạp tiền dạng: SMB{userId}{random}
   VD: "SMB12ABC nap tien" → userId = 12
   ───────────────────────────────────────────── */
async function findUserFromContent(content = '') {
  const upper = content.toUpperCase();
  const match = upper.match(/SMB(\d+)/);
  if (!match) return null;
  const userId = parseInt(match[1]);
  const [[user]] = await db.query('SELECT * FROM users WHERE id=? AND is_active=1', [userId]);
  return user || null;
}

function loginRedirectFromReferer(req) {
  try {
    const ref = req.get('referer');
    if (!ref) return '/dang-nhap';
    const url = new URL(ref);
    const currentHost = String(req.headers.host || '').replace(/^www\./, '');
    const refHost = String(url.host || '').replace(/^www\./, '');
    if (refHost !== currentHost) return '/dang-nhap';
    return '/dang-nhap?returnUrl=' + encodeURIComponent(url.pathname + url.search);
  } catch (_) {
    return '/dang-nhap';
  }
}

/* ─────────────────────────────────────────────
   HELPER: Cộng tiền & ghi log
   ───────────────────────────────────────────── */
async function creditUser(userId, amount, method, ref, content) {
  await ensureTopDepositorsSchema(db);
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Lấy số dư hiện tại
    const [[user]] = await conn.query('SELECT balance FROM users WHERE id=? FOR UPDATE', [userId]);
    const before = Number(user.balance);
    const total  = amount;
    const after  = before + total;

    // Cập nhật số dư
    await conn.query('UPDATE users SET balance=? WHERE id=?', [after, userId]);

    // Ghi transaction
    await conn.query(`
      INSERT INTO transactions
        (user_id, type, amount, balance_before, balance_after, payment_method, transfer_ref, transfer_content, status)
      VALUES (?, 'deposit', ?, ?, ?, ?, ?, ?, 'success')
    `, [userId, total, before, after, method, ref, content]);

    // Cập nhật top_depositors
    const period = new Date().toISOString().slice(0, 7);
    await upsertTopDepositor(conn, userId, period, total);
    await refreshTopDepositorRanks(conn, period);

    await conn.commit();
    console.log(`✅ Cộng ${total.toLocaleString('vi-VN')}đ cho user #${userId}`);
    return { success: true, amount: total, bonus: 0, after };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* ─────────────────────────────────────────────
   🔔 WEBHOOK SEPAY – Nhận tiền tự động
   POST /api/webhook/sepay
   Header: x-api-key  (cấu hình trong .env)
   ───────────────────────────────────────────── */
router.post('/webhook/sepay', express.json(), async (req, res) => {
  // Xác thực token
  const authHeader = String(req.headers['authorization'] || '').replace(/^(Bearer|Apikey)\s+/i, '');
  const token = req.headers['x-api-key'] || authHeader;
  if (!process.env.SEPAY_WEBHOOK_TOKEN || token !== process.env.SEPAY_WEBHOOK_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const data = req.body;
  const amount  = parseInt(data.transferAmount) || 0;
  const content = data.content || '';
  const ref     = String(data.referenceCode || data.id || stableRef([
    data.transactionDate,
    data.transferType,
    amount,
    content,
    data.bankName,
    data.accountNumber
  ]));

  console.log(`📩 SePay webhook ref=${ref} amount=${amount.toLocaleString('vi-VN')}đ`);

  // Log raw data
  await db.query(`
    INSERT INTO payment_logs (source, raw_data, amount, content, ref_code)
    VALUES ('sepay', ?, ?, ?, ?)
  `, [JSON.stringify(data), amount, content, ref]);

  // Chỉ xử lý giao dịch ĐẾN (IN)
  if (data.transferType !== 'in') {
    return res.json({ success: true, message: 'Ignored outgoing' });
  }

  const lockName = `sepay:${ref}`;
  const [[lockResult]] = await db.query('SELECT GET_LOCK(?, 10) AS locked', [lockName]);
  if (!lockResult?.locked) {
    return res.status(409).json({ success: false, message: 'Webhook is being processed' });
  }

  try {
    // Kiểm tra trùng ref
    const [[dup]] = await db.query(
      'SELECT id FROM transactions WHERE transfer_ref=? AND type="deposit"', [ref]
    );
    if (dup) {
      await db.query(
        'UPDATE payment_logs SET is_processed=1 WHERE ref_code=? ORDER BY id DESC LIMIT 1',
        [ref]
      );
      return res.json({ success: true, message: 'Already processed' });
    }

    // Tìm user từ nội dung CK
    const user = await findUserFromContent(content);
    if (!user) {
      // Không khớp user → ghi log, admin xử lý thủ công
      await db.query(
        'UPDATE payment_logs SET is_processed=0 WHERE ref_code=? ORDER BY id DESC LIMIT 1',
        [ref]
      );
      console.warn(`⚠️ Không tìm thấy user cho nội dung: "${content}"`);
      return res.json({ success: true, message: 'User not found, manual review needed' });
    }

    // Số tiền tối thiểu
    if (amount < 10000) {
      return res.json({ success: false, message: 'Amount too small' });
    }

    // Cộng tiền
    const method = data.bankName?.toLowerCase().includes('momo') ? 'momo' : 'tpbank';
    await creditUser(user.id, amount, method, ref, content);

    // Cập nhật log
    await db.query(
      'UPDATE payment_logs SET is_processed=1, matched_user=? WHERE ref_code=? ORDER BY id DESC LIMIT 1',
      [user.id, ref]
    );

    return res.json({ success: true, message: `Credited ${amount} to user ${user.id}` });
  } finally {
    await db.query('SELECT RELEASE_LOCK(?)', [lockName]);
  }
});

/* ─────────────────────────────────────────────
   🛒 MUA ACC TỰ ĐỘNG
   POST /api/buy/:accId
   Yêu cầu đăng nhập (session)
   ───────────────────────────────────────────── */
router.post('/buy/:accId', async (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({
      success: false,
      message: 'Vui lòng đăng nhập!',
      redirect: loginRedirectFromReferer(req)
    });
  }

  const accId  = parseInt(req.params.accId);
  const userId = req.session.user.id;
  let conn;

  try {
    await ensureCtvSchema();
    conn = await db.getConnection();
    await conn.beginTransaction();

    // Lấy acc (khóa hàng để tránh race condition)
    const [[acc]] = await conn.query(
      'SELECT * FROM accounts WHERE id=? AND status="available" FOR UPDATE', [accId]
    );
    if (!acc) {
      await conn.rollback();
      return res.json({ success: false, message: 'Acc đã được mua hoặc không tồn tại!' });
    }

    // Lấy user & kiểm tra số dư
    const [[user]] = await conn.query('SELECT * FROM users WHERE id=? FOR UPDATE', [userId]);
    if (Number(user.balance) < Number(acc.price)) {
      await conn.rollback();
      return res.json({
        success: false,
        message: `Số dư không đủ! Cần ${Number(acc.price).toLocaleString('vi-VN')}đ, bạn có ${Number(user.balance).toLocaleString('vi-VN')}đ`,
        redirect: '/nap-tien'
      });
    }

    const before = Number(user.balance);
    const after  = before - Number(acc.price);

    // Trừ tiền user
    await conn.query('UPDATE users SET balance=? WHERE id=?', [after, userId]);

    // Đánh dấu acc đã bán
    await conn.query('UPDATE accounts SET status="sold", sold_at=NOW() WHERE id=?', [accId]);

    // Tạo đơn hàng – giao acc ngay
    const [orderResult] = await conn.query(`
      INSERT INTO orders (user_id, account_id, amount, status, acc_username, acc_password, acc_info)
      VALUES (?, ?, ?, 'completed', ?, ?, ?)
    `, [userId, accId, acc.price, acc.acc_username, acc.acc_password, acc.acc_info]);

    // Ghi transaction
    await conn.query(`
      INSERT INTO transactions (user_id, type, amount, balance_before, balance_after, status, note)
      VALUES (?, 'purchase', ?, ?, ?, 'success', ?)
    `, [userId, acc.price, before, after, `Mua acc #${accId}`]);

    const referralCtvId = Number(req.session.ctv_ref || 0);
    const ctvId = Number(acc.ctv_id || referralCtvId || 0);
    if (ctvId && ctvId !== Number(userId)) {
      const [[commissionRow]] = await conn.query(
        'SELECT value FROM settings WHERE `key`=?',
        [`ctv_commission_game_${acc.category_id}`]
      );
      const commissionPercent = Math.max(0, Math.min(100, Number(commissionRow?.value ?? 100)));
      const amount = Math.floor(Number(acc.price) * commissionPercent / 100);
      const [ctvCredit] = await conn.query(
        'UPDATE users SET ctv_balance=COALESCE(ctv_balance,0)+? WHERE id=? AND role="staff"',
        [amount, ctvId]
      );
      if (ctvCredit.affectedRows > 0) {
        await conn.query(`
          INSERT INTO ctv_sales (ctv_id, account_id, order_id, amount, commission_percent, status)
          VALUES (?, ?, ?, ?, ?, 'credited')
        `, [ctvId, accId, orderResult.insertId, amount, commissionPercent]);
      }
    }

    await conn.commit();

    // Cập nhật session balance
    req.session.user.balance = after;

    console.log(`✅ User #${userId} mua acc #${accId} giá ${acc.price.toLocaleString('vi-VN')}đ`);

    return res.json({
      success: true,
      message: '🎉 Mua thành công! Thông tin acc đã được giao.',
      order: {
        id:           orderResult.insertId,
        acc_username: acc.acc_username,
        acc_password: acc.acc_password,
        acc_info:     acc.acc_info
      },
      new_balance: after
    });

  } catch (err) {
    console.error('Lỗi mua acc:', err);
    if (conn) await conn.rollback();
    try {
      const result = await localStore.buyAccount(userId, accId, req.session.ctv_ref);
      if (!result.success) return res.json(result);
      req.session.user.balance = result.new_balance;
      return res.json({
        success: true,
        message: '🎉 Mua thành công! Thông tin acc đã được giao.',
        order: {
          id: result.order.id,
          acc_username: result.order.acc_username,
          acc_password: result.order.acc_password,
          acc_info: result.order.acc_info
        },
        new_balance: result.new_balance
      });
    } catch (fallbackErr) {
      console.error('Lỗi mua acc local:', fallbackErr);
      return res.json({ success: false, message: 'Lỗi hệ thống, thử lại sau!' });
    }
  } finally {
    if (conn) conn.release();
  }
});

/* ─────────────────────────────────────────────
   📊 STATS REALTIME (cho footer)
   GET /api/stats/online
   ───────────────────────────────────────────── */
router.get('/stats/online', async (req, res) => {
  try {
    const [[{ online }]] = await db.query(
      'SELECT COUNT(*) as online FROM users WHERE updated_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)'
    );
    res.json({ online: online || 0 });
  } catch (err) {
    console.warn('Không lấy được online stats:', err.code || err.message);
    res.json({ online: 0 });
  }
});

/* ─────────────────────────────────────────────
   💰 CHECK SỐ DƯ REALTIME
   GET /api/me/balance  (yêu cầu đăng nhập)
   ───────────────────────────────────────────── */
router.get('/me/balance', async (req, res) => {
  if (!req.session.user) return res.json({ balance: null });
  try {
    const [[user]] = await db.query('SELECT balance FROM users WHERE id=?', [req.session.user.id]);
    if (!user) return res.json({ balance: null });
    const balance = Number(user.balance);
    // Sync session
    req.session.user.balance = balance;
    res.json({ balance });
  } catch (err) {
    console.warn('Không lấy được số dư:', err.code || err.message);
    res.json({ balance: req.session.user.balance ?? null });
  }
});


// ===== CTV RUT TIEN =====
async function ensureCtvSchema() {
  const [balanceCol] = await db.query("SHOW COLUMNS FROM users LIKE 'ctv_balance'");
  if (!balanceCol.length) {
    await db.query('ALTER TABLE users ADD COLUMN ctv_balance DECIMAL(15,0) DEFAULT 0');
  }
  const [ctvCol] = await db.query("SHOW COLUMNS FROM accounts LIKE 'ctv_id'");
  if (!ctvCol.length) {
    await db.query('ALTER TABLE accounts ADD COLUMN ctv_id INT DEFAULT NULL');
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

router.post('/ctv/withdraw', async (req, res) => {
  if (!req.session.user) return res.json({ success: false, message: 'Vui lòng đăng nhập.' });
  const { amount, bank_name, bank_number, bank_holder } = req.body;
  const amt = Number(amount);
  if (!amt || amt < 10000) return res.json({ success: false, message: 'Số tiền rút tối thiểu là 10.000đ.' });
  if (!bank_name || !bank_number || !bank_holder) {
    return res.json({ success: false, message: 'Vui lòng nhập đầy đủ thông tin ngân hàng.' });
  }
  const bankInfo = { bank_name, bank_number, bank_holder };

  try {
    await ensureCtvSchema();
    const [[user]] = await db.query('SELECT role, COALESCE(ctv_balance,0) AS ctv_balance FROM users WHERE id=?', [req.session.user.id]);
    if (!user || user.role !== 'staff') {
      return res.json({ success: false, message: 'Tài khoản này không có quyền CTV.' });
    }
    if (Number(user.ctv_balance || 0) < amt) {
      return res.json({ success: false, message: 'Số dư CTV không đủ.' });
    }
    const [result] = await db.query(
      'INSERT INTO ctv_withdrawals (ctv_id, amount, bank_info, status) VALUES (?, ?, ?, "pending")',
      [req.session.user.id, amt, JSON.stringify(bankInfo)]
    );
    return res.json({
      success: true,
      message: 'Yêu cầu rút tiền đã gửi, chờ admin duyệt.',
      withdrawal: { id: result.insertId, ctv_id: req.session.user.id, amount: amt, bank_info: bankInfo, status: 'pending' }
    });
  } catch (err) {
    try {
      const users = await localStore.readUsers();
      const user = users.find(u => Number(u.id) === Number(req.session.user.id));
      if (!user || user.role !== 'staff' || (Number(user.ctv_balance) || 0) < amt) {
        return res.json({ success: false, message: 'Số dư CTV không đủ.' });
      }
      const w = await localStore.createCtvWithdrawal(req.session.user.id, amt, bankInfo);
      return res.json({ success: true, message: 'Yêu cầu rút tiền đã gửi, chờ admin duyệt.', withdrawal: w });
    } catch (fallbackErr) {
      console.error('Lỗi rút tiền CTV local:', fallbackErr);
      return res.json({ success: false, message: 'Lỗi hệ thống khi gửi yêu cầu rút tiền.' });
    }
  }
});

module.exports = router;
