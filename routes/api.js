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

/* ─────────────────────────────────────────────
   HELPER: Cộng tiền & ghi log
   ───────────────────────────────────────────── */
async function creditUser(userId, amount, method, ref, content) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // Lấy số dư hiện tại
    const [[user]] = await conn.query('SELECT balance FROM users WHERE id=? FOR UPDATE', [userId]);
    const before = Number(user.balance);
    const bonus  = Math.floor(amount * 0.10); // +10%
    const total  = amount + bonus;
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
    await conn.query(`
      INSERT INTO top_depositors (user_id, period, total, count)
      VALUES (?, ?, ?, 1)
      ON DUPLICATE KEY UPDATE total=total+?, count=count+1
    `, [userId, period, total, total]);

    // Cập nhật rank top 5 bằng từng query để không phụ thuộc multipleStatements.
    await conn.query('SET @rank = 0');
    await conn.query(
      'UPDATE top_depositors SET rank = (@rank := @rank + 1) WHERE period=? ORDER BY total DESC',
      [period]
    );

    await conn.commit();
    console.log(`✅ Cộng ${total.toLocaleString('vi-VN')}đ (+${bonus.toLocaleString()}đ KM) cho user #${userId}`);
    return { success: true, amount: total, bonus, after };
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
    return res.json({ success: false, message: 'Vui lòng đăng nhập!' });
  }

  const accId  = parseInt(req.params.accId);
  const userId = req.session.user.id;
  let conn;

  try {
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
      const result = await localStore.buyAccount(userId, accId);
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

module.exports = router;
