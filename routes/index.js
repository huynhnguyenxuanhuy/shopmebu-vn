/* ============================================
   routes/index.js – Trang chủ & tìm kiếm
   ============================================ */
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const localStore = require('../utils/localStore');

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

function splitParagraphs(value) {
  return String(value || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
}

async function getSiteContent() {
  try {
    const [rows] = await db.query('SELECT * FROM settings WHERE `key` LIKE "content_%"');
    const contentSettings = {};
    rows.forEach(row => {
      contentSettings[row.key.replace(/^content_/, '')] = row.value;
    });
    return mergeContent(contentSettings);
  } catch (_) {
    return getLocalContent();
  }
}

async function getLocalContent() {
  const runtime = await localStore.readRuntime();
  return mergeContent(runtime.settings?.content || {});
}

// ===== TRANG CHỦ =====
router.get('/', async (req, res) => {
  try {
    const [banners]    = await db.query('SELECT * FROM banners WHERE is_active=1 ORDER BY sort_order');
    const [categories] = await db.query('SELECT * FROM game_categories WHERE is_active=1 ORDER BY sort_order');
    const [contentRows] = await db.query('SELECT * FROM settings WHERE `key` LIKE "content_%"');
    const contentSettings = {};
    contentRows.forEach(row => {
      contentSettings[row.key.replace(/^content_/, '')] = row.value;
    });

    // Acc vừa mua (10 giao dịch gần nhất)
    const [recentOrders] = await db.query(`
      SELECT o.id, o.created_at, o.amount,
             u.username,
             a.rank, a.so_tuong, g.name AS game_name, g.icon AS game_icon
      FROM orders o
      JOIN users u    ON u.id = o.user_id
      JOIN accounts a ON a.id = o.account_id
      JOIN game_categories g ON g.id = a.category_id
      ORDER BY o.created_at DESC LIMIT 10
    `);

    // Top 5 nạp tiền tháng này
    let top5 = [];
    try {
      const period = new Date().toISOString().slice(0,7);
      const [rows] = await db.query(`
        SELECT t.*, u.username
        FROM top_depositors t
        JOIN users u ON u.id = t.user_id
        WHERE t.period = ?
        ORDER BY t.total DESC LIMIT 5
      `, [period]);
      top5 = rows;
    } catch (_) { /* bảng top_depositors chưa có */ }

    // Thống kê
    const [[{ sold }]]    = await db.query('SELECT COUNT(*) as sold FROM orders WHERE status="completed"');
    const [[{ members }]] = await db.query('SELECT COUNT(*) as members FROM users');
    const [[{ online }]]  = await db.query('SELECT COUNT(*) as online FROM users WHERE updated_at > DATE_SUB(NOW(), INTERVAL 10 MINUTE)');
    let views = 0, totalAcc = 0;
    try { [[{ views }]] = await db.query('SELECT COALESCE(value,0) as views FROM settings WHERE `key`="page_views"'); } catch(_){}
    try { [[{ totalAcc }]] = await db.query('SELECT COUNT(*) as totalAcc FROM accounts WHERE status="available"'); } catch(_){}
    const soldCount = sold;

    // Acc mới nhất theo từng NHÓM game (gom tất cả sub-categories)
    const accByGame = {};
    for (const cat of categories) {
      const [accs] = await db.query(`
        SELECT id, title, rank, rank AS rank_name, so_tuong, trang_phuc, ngoc, price,
               SUBSTRING_INDEX(images, ',', 1) AS thumb,
               SUBSTRING_INDEX(images, ',', 1) AS image_url
        FROM accounts
        WHERE category_id=? AND status='available'
        ORDER BY id DESC LIMIT 8
      `, [cat.id]);
      accByGame[cat.slug] = accs;
    }

    // Gom tất cả acc theo nhóm game chính (bao gồm sub-categories)
    const gameGroups = ['huyen-anh-vo-lam', 'giang-ho-ky-ngo', 'vplay-khac'];
    for (const group of gameGroups) {
      const groupCatIds = categories
        .filter(c => c.slug === group || c.slug.startsWith(group + '-') || c.slug.startsWith(group + '/'))
        .map(c => c.id);
      if (groupCatIds.length === 0) continue;
      const placeholders = groupCatIds.map(() => '?').join(',');
      const [merged] = await db.query(`
        SELECT id, title, rank, rank AS rank_name, so_tuong, trang_phuc, ngoc, price,
               SUBSTRING_INDEX(images, ',', 1) AS thumb,
               SUBSTRING_INDEX(images, ',', 1) AS image_url
        FROM accounts
        WHERE category_id IN (${placeholders}) AND status='available'
        ORDER BY id DESC LIMIT 8
      `, groupCatIds);
      accByGame[group] = merged;
    }

    res.render('index', {
      page: 'home',
      title: 'Trang Chủ',
      banners, categories, recentOrders, top5, accByGame,
      content: mergeContent(contentSettings),
      totalAcc, soldCount,
      stats: { sold, members, online: online||0, views: views||0 }
    });
  } catch (err) {
    console.error(err);
    const categories = localStore.categories;
    const localAccs = await localStore.listAccounts({ status: 'available' });
    const accByGame = {};
    categories.forEach(cat => {
      accByGame[cat.slug] = localAccs.filter(acc => acc.game_slug === cat.slug).slice(0, 8);
    });
    const users = await localStore.readUsers();
    const runtime = await localStore.readRuntime();
    const resetAt = runtime.settings?.top_deposit_reset_at ? new Date(runtime.settings.top_deposit_reset_at) : null;
    const top5 = users
      .map(u => ({
        username: u.username,
        total: runtime.transactions
          .filter(t => {
            const createdAt = new Date(t.created_at);
            return Number(t.user_id) === Number(u.id)
              && ['deposit', 'admin_adjust'].includes(t.type)
              && Number(t.amount) > 0
              && (!resetAt || (createdAt >= resetAt));
          })
          .reduce((sum, t) => sum + Number(t.amount || 0), 0)
      }))
      .filter(u => u.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);
    const soldCount = runtime.accounts.filter(acc => acc.status === 'sold').length;
    res.render('index', {
      page: 'home', title: 'Trang Chủ',
      banners: [], categories, recentOrders: [], top5, accByGame,
      content: await getSiteContent(),
      totalAcc: localAccs.length,
      soldCount,
      stats: { sold:soldCount, members:users.length, online:users.length ? 1 : 0, views:0 }
    });
  }
});

// ===== TÌM KIẾM =====
router.get('/search', async (req, res) => {
  const q     = (req.query.q || '').trim();
  const page  = parseInt(req.query.page) || 1;
  const limit = 12;
  const offset = (page - 1) * limit;

  try {
    const [results] = await db.query(`
      SELECT a.*, g.name AS game_name, g.slug AS game_slug, g.icon AS game_icon,
             SUBSTRING_INDEX(a.images, ',', 1) AS thumb
      FROM accounts a
      JOIN game_categories g ON g.id = a.category_id
      WHERE a.status='available'
        AND (a.title LIKE ? OR a.rank LIKE ? OR a.server LIKE ?)
      ORDER BY a.id DESC
      LIMIT ? OFFSET ?
    `, [`%${q}%`, `%${q}%`, `%${q}%`, limit, offset]);

    const [[{ total }]] = await db.query(`
      SELECT COUNT(*) as total FROM accounts
      WHERE status='available' AND (title LIKE ? OR rank LIKE ? OR server LIKE ?)
    `, [`%${q}%`, `%${q}%`, `%${q}%`]);

    res.render('search', {
      title: `Tìm kiếm: ${q}`,
      query: q, results, total,
      currentPage: page,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    console.error(err);
    const results = q ? await localStore.listAccounts({ search: q, status: 'available' }) : [];
    res.render('search', { title: 'Tìm kiếm', query: q, results, total: results.length, currentPage: 1, totalPages: 1 });
  }
});

router.get('/thong-tin-shop', async (req, res) => {
  const content = await getSiteContent();
  res.render('info-page', {
    layout: 'layout',
    title: 'Thông Tin Shop',
    page: 'info',
    heading: content.info_heading,
    icon: content.info_icon,
    paragraphs: splitParagraphs(content.info_paragraphs),
    actions: [
      { href: '/game/huyen-anh-vo-lam', label: '⚔️ Xem kho acc' },
      { href: '/nap-tien', label: '💳 Nạp tiền' }
    ]
  });
});

router.get('/box-sale', async (req, res) => {
  const content = await getSiteContent();
  res.render('info-page', {
    layout: 'layout',
    title: 'Box Zalo Săn Sale',
    page: 'info',
    heading: content.sale_heading,
    icon: content.sale_icon,
    paragraphs: splitParagraphs(content.sale_paragraphs),
    actions: [
      { href: content.sale_url, label: '📱 Vào Zalo Group', external: true },
      { href: '/', label: '🏠 Về trang chủ' }
    ]
  });
});

module.exports = router;
