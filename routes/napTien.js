/* ============================================
   routes/napTien.js – Trang nạp tiền
   ============================================ */
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const localStore = require('../utils/localStore');

// Middleware: yêu cầu đăng nhập
function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Vui lòng đăng nhập để nạp tiền!');
    return res.redirect('/dang-nhap?returnUrl=/nap-tien');
  }
  next();
}

// GET /nap-tien
router.get('/', requireLogin, async (req, res) => {
  const user = req.session.user;
  let history = [];

  // Lấy lịch sử nạp tiền của user. Nếu local chưa bật MySQL thì vẫn cho xem trang nạp.
  try {
    [history] = await db.query(`
      SELECT * FROM transactions
      WHERE user_id = ? AND type = 'deposit'
      ORDER BY created_at DESC LIMIT 20
    `, [user.id]);
  } catch (err) {
    console.warn('Không lấy được lịch sử nạp:', err.code || err.message);
    history = (await localStore.getUserTransactions(user.id, 'deposit')).slice(0, 20);
  }

  // Mã cố định theo user để webhook SePay tự nhận diện bằng mẫu SMB{id}.
  const napCode = `SMB${user.id}`;

  res.render('nap-tien', {
    title: 'Nạp Tiền',
    page: 'naptien',
    user, history, napCode,
    bonus: 0, // % khuyến mãi
    banks: {
      momo: {
        name:   'VÕ PHAN TRUNG HIẾU',
        stk:    '********942',
        qr_img: '/img/qr-momo.jpg'
      },
      tpbank: {
        name:   'Võ Phan Trung Hiếu',
        stk:    '01577578410',
        qr_img: '/img/qr-tpbank.jpg'
      }
    }
  });
});

router.post('/momo-bao-da-chuyen', requireLogin, async (req, res) => {
  const user = req.session.user;
  const amount = parseInt(req.body.amount, 10);
  const napCode = `SMB${user.id}`;

  if (!amount || amount < 10000) {
    req.flash('error', 'Số tiền báo nạp MoMo tối thiểu là 10.000đ.');
    return res.redirect('/nap-tien');
  }

  const ref = `momo-manual-${user.id}-${Date.now()}`;
  const raw = {
    type: 'momo_manual_request',
    user_id: user.id,
    username: user.username,
    amount,
    content: napCode
  };

  try {
    await db.query(`
      INSERT INTO payment_logs (source, raw_data, amount, content, ref_code, matched_user, is_processed)
      VALUES ('momo_manual', ?, ?, ?, ?, ?, 0)
    `, [JSON.stringify(raw), amount, napCode, ref, user.id]);
    req.flash('success', 'Đã gửi yêu cầu nạp MoMo cho admin duyệt.');
  } catch (err) {
    console.warn('Không tạo được log MoMo MySQL:', err.code || err.message);
    const runtime = await localStore.readRuntime();
    runtime.payment_logs = runtime.payment_logs || [];
    runtime.payment_logs.push({
      id: runtime.payment_logs.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1,
      source: 'momo_manual',
      raw_data: JSON.stringify(raw),
      amount,
      content: napCode,
      ref_code: ref,
      matched_user: user.id,
      is_processed: 0,
      created_at: new Date().toISOString()
    });
    await localStore.writeRuntime(runtime);
    req.flash('success', 'Đã gửi yêu cầu nạp MoMo cho admin duyệt.');
  }

  res.redirect('/nap-tien');
});

module.exports = router;
