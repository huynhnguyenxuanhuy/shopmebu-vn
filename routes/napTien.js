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
        name:   'VO PHAN TRUNG HIEU',
        stk:    '01577578410',
        qr_img: '/img/qr-tpbank.jpg'
      }
    }
  });
});

module.exports = router;
