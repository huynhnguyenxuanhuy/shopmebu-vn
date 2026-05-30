/* ============================================
   routes/user.js – Trang người dùng
   /thong-bao | /lich-su-mua | /lich-su-nap
   ============================================ */
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const localStore = require('../utils/localStore');

/* ---- Middleware: yêu cầu đăng nhập ---- */
function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Vui lòng đăng nhập!');
    return res.redirect('/dang-nhap?returnUrl=' + encodeURIComponent(req.originalUrl));
  }
  next();
}

/* ==================================================
   /thong-bao  – Thông báo
   ================================================== */
router.get('/thong-bao', requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const page   = parseInt(req.query.page) || 1;
    const limit  = 20;
    const offset = (page - 1) * limit;

    const [notifications] = await db.query(`
      SELECT * FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM notifications WHERE user_id=?', [userId]
    );

    // Đánh dấu tất cả là đã đọc
    await db.query(
      'UPDATE notifications SET is_read=1 WHERE user_id=? AND is_read=0', [userId]
    );

    res.render('thong-bao', {
      title: 'Thông Báo',
      page: 'notifications',
      notifications,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error(err);
    const userId = req.session.user.id;
    const page = parseInt(req.query.page) || 1;
    const notifications = await localStore.getNotifications(userId);
    await localStore.markNotificationsRead(userId);
    res.render('thong-bao', {
      title: 'Thông Báo',
      page: 'notifications',
      notifications,
      total: notifications.length,
      currentPage: page,
      totalPages: 1
    });
  }
});

/* ==================================================
   /lich-su-mua  – Lịch sử mua hàng
   ================================================== */
router.get('/lich-su-mua', requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const page   = parseInt(req.query.page) || 1;
    const limit  = 15;
    const offset = (page - 1) * limit;

    const [orders] = await db.query(`
      SELECT o.*,
             a.rank, a.so_tuong, a.trang_phuc, a.price AS acc_price,
             g.name  AS game_name,
             g.icon  AS game_icon,
             g.slug  AS game_slug
      FROM orders o
      JOIN accounts       a ON a.id = o.account_id
      JOIN game_categories g ON g.id = a.category_id
      WHERE o.user_id = ?
      ORDER BY o.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    const [[{ total }]] = await db.query(
      'SELECT COUNT(*) AS total FROM orders WHERE user_id=?', [userId]
    );

    // Tổng chi tiêu
    const [[stats]] = await db.query(`
      SELECT COUNT(*) AS total_orders,
             COALESCE(SUM(amount),0) AS total_spent
      FROM orders WHERE user_id=? AND status='completed'
    `, [userId]);

    res.render('lich-su-mua', {
      title: 'Lịch Sử Mua Hàng',
      page: 'orders',
      orders,
      stats,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error(err);
    const orders = await localStore.getUserOrders(req.session.user.id);
    const stats = {
      total_orders: orders.length,
      total_spent: orders.reduce((sum, o) => sum + Number(o.amount || 0), 0)
    };
    res.render('lich-su-mua', {
      title: 'Lịch Sử Mua Hàng',
      page: 'orders',
      orders,
      stats,
      total: orders.length,
      currentPage: 1,
      totalPages: 1
    });
  }
});

/* ==================================================
   /lich-su-nap  – Lịch sử nạp tiền
   ================================================== */
router.get('/lich-su-nap', requireLogin, async (req, res) => {
  try {
    const userId = req.session.user.id;
    const page   = parseInt(req.query.page) || 1;
    const limit  = 15;
    const offset = (page - 1) * limit;
    const filter = req.query.type || 'all'; // all | deposit | purchase

    let whereClause = 'WHERE user_id=?';
    const params    = [userId];
    if (filter === 'deposit')  { whereClause += " AND type='deposit'"; }
    if (filter === 'purchase') { whereClause += " AND type='purchase'"; }

    const [transactions] = await db.query(`
      SELECT * FROM transactions
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM transactions ${whereClause}`, params
    );

    // Tổng nạp + tổng chi
    const [[summary]] = await db.query(`
      SELECT
        COALESCE(SUM(CASE WHEN type='deposit'  AND status='success' THEN amount ELSE 0 END),0) AS total_deposit,
        COALESCE(SUM(CASE WHEN type='purchase' THEN amount ELSE 0 END),0) AS total_purchase
      FROM transactions WHERE user_id=?
    `, [userId]);

    // Lấy số dư mới nhất
    const [[userRow]] = await db.query('SELECT balance FROM users WHERE id=?', [userId]);

    res.render('lich-su-nap', {
      title: 'Lịch Sử Giao Dịch',
      page: 'transactions',
      transactions,
      summary,
      filter,
      total,
      currentPage: page,
      totalPages: Math.ceil(total / limit),
      userBalance: Number(userRow?.balance || 0)
    });
  } catch (err) {
    console.error(err);
    const filter = req.query.type || 'all';
    const allTransactions = await localStore.getUserTransactions(req.session.user.id);
    const transactions = filter === 'all' ? allTransactions : allTransactions.filter(t => t.type === filter);
    const summary = {
      total_deposit: allTransactions
        .filter(t => ['deposit', 'admin_adjust'].includes(t.type) && Number(t.amount) > 0)
        .reduce((sum, t) => sum + Number(t.amount || 0), 0),
      total_purchase: allTransactions
        .filter(t => t.type === 'purchase')
        .reduce((sum, t) => sum + Number(t.amount || 0), 0)
    };
    res.render('lich-su-nap', {
      title: 'Lịch Sử Giao Dịch',
      page: 'transactions',
      transactions,
      summary,
      filter,
      total: transactions.length,
      currentPage: 1,
      totalPages: 1,
      userBalance: Number(req.session.user.balance || 0)
    });
  }
});

module.exports = router;
