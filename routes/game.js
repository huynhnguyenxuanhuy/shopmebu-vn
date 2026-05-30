/* ============================================
   routes/game.js – Danh mục game & chi tiết acc
   ============================================ */
const express = require('express');
const router  = express.Router();
const db      = require('../config/db');
const localStore = require('../utils/localStore');

const fallbackCategories = {
  'huyen-anh-vo-lam': { id: 1, name: 'Huyền Ảnh Võ Lâm', slug: 'huyen-anh-vo-lam', icon: '⚔️' },
  'giang-ho-ky-ngo': { id: 2, name: 'Giang Hồ Kỳ Ngộ', slug: 'giang-ho-ky-ngo', icon: '🐉' },
  'vplay-khac': { id: 3, name: 'Game VPlay Khác', slug: 'vplay-khac', icon: '🎲' }
};

const fallbackAccTypes = [
  { name: 'Tự Chọn', slug: 'tu-chon' },
  { name: 'Túi Mù Random', slug: 'random' },
  { name: 'VIP Cao Cấp', slug: 'vip' },
  { name: 'Acc REG', slug: 'reg' }
];

const fallbackThumbs = [
  '/img/game-cards/wuxia-vip.svg',
  '/img/game-cards/sword-scroll.svg',
  '/img/game-cards/server-citadel.svg',
  '/img/game-cards/reg-starter.svg',
  '/img/game-cards/dragon-ghkn.svg',
  '/img/game-cards/fire-warrior.svg',
  '/img/game-cards/random-chest.svg',
  '/img/game-cards/vplay-arena.svg'
];

async function fallbackAccountsFor(slug, type = '') {
  const typeAliases = { 'tui-mu': 'random', 'server-moi': 'server-moi', 'chien-luc-cao': 'vip', '20k': '', '50k': '', '100k': '', '200k': '' };
  const normalized = typeAliases[type] !== undefined ? typeAliases[type] : type;
  return localStore.listAccounts({ slug, status: 'available', type: normalized });
}

async function renderFallbackGame(res, slug, query = {}) {
  const category = fallbackCategories[slug];
  if (!category) return res.redirect('/');
  const typeAliases = { 'tui-mu': 'random', 'server-moi': 'server-moi', 'chien-luc-cao': 'vip' };
  const type = typeAliases[query.type] || query.type || '';
  const accounts = await fallbackAccountsFor(slug, type);
  const localTypes = localStore.accTypes.filter(t => t.category_id === category.id);
  return res.render('game', {
    title: `${category.name} – Mua Acc Giá Rẻ`,
    page: 'game',
    category,
    accounts,
    accTypes: localTypes.length ? localTypes : fallbackAccTypes,
    ranks: ['REG', 'Tự Chọn', 'Random', 'VIP'],
    filters: {
      rank: query.rank || '',
      type,
      minPrice: parseInt(query.min_price) || 0,
      maxPrice: parseInt(query.max_price) || 9999999,
      sort: query.sort || 'newest'
    },
    currentPage: parseInt(query.page) || 1,
    totalPages: 1,
    total: accounts.length
  });
}

async function renderLocalDetail(res, slug, accId, req) {
  const category = fallbackCategories[slug];
  const acc = await localStore.getAccount(accId);
  if (!category || !acc || acc.game_slug !== slug || acc.status !== 'available') {
    req.flash('error', 'Acc không tồn tại hoặc đã được bán!');
    return res.redirect(`/game/${slug}`);
  }
  const related = (await localStore.listAccounts({ slug, status: 'available' }))
    .filter(item => Number(item.id) !== Number(accId))
    .slice(0, 6);
  return res.render('acc-detail', {
    title: `${acc.title || acc.rank} – ${category.name}`,
    page: 'game',
    category,
    acc,
    images: acc.images ? String(acc.images).split(',').filter(Boolean) : [],
    related
  });
}

/* ─────────────────────────────────────────────
   DANH MỤC GAME
   GET /game/:slug
   ───────────────────────────────────────────── */
router.get('/:slug', async (req, res) => {
  const { slug } = req.params;

  try {
    // Tìm category
    const [[category]] = await db.query(
      'SELECT * FROM game_categories WHERE slug=? AND is_active=1', [slug]
    );
    if (!category) return renderFallbackGame(res, slug, req.query);

    // Tham số lọc / phân trang
    const page    = parseInt(req.query.page) || 1;
    const limit   = 12;
    const offset  = (page - 1) * limit;
    const rank    = req.query.rank   || '';
    const type    = req.query.type   || '';
    const minPrice= parseInt(req.query.min_price) || 0;
    const maxPrice= parseInt(req.query.max_price) || 9999999;
    const sort    = req.query.sort   || 'newest';  // newest|price_asc|price_desc

    // Build WHERE
    let where    = 'WHERE a.category_id=? AND a.status="available"';
    const params = [category.id];

    if (rank) {
      where += ' AND a.rank LIKE ?';
      params.push(`%${rank}%`);
    }
    if (type) {
      const [[accType]] = await db.query(
        'SELECT id FROM acc_types WHERE category_id=? AND slug=?',
        [category.id, type]
      );
      if (accType) {
        where += ' AND a.acc_type_id=?';
        params.push(accType.id);
      }
    }
    if (minPrice > 0 || maxPrice < 9999999) {
      where += ' AND a.price BETWEEN ? AND ?';
      params.push(minPrice, maxPrice);
    }

    // Sort
    const orderMap = {
      newest:     'a.id DESC',
      price_asc:  'a.price ASC',
      price_desc: 'a.price DESC'
    };
    const orderBy = orderMap[sort] || 'a.id DESC';

    const [accounts] = await db.query(`
      SELECT a.id, a.title, a.rank, a.so_tuong, a.trang_phuc, a.ngoc, a.price,
             SUBSTRING_INDEX(a.images, ',', 1) AS thumb
      FROM accounts a
      ${where}
      ORDER BY ${orderBy}
      LIMIT ? OFFSET ?
    `, [...params, limit, offset]);

    const [[{ total }]] = await db.query(`
      SELECT COUNT(*) as total FROM accounts a ${where}
    `, params);

    // Danh sách rank có sẵn để filter
    const [ranks] = await db.query(
      'SELECT DISTINCT rank FROM accounts WHERE category_id=? AND status="available" AND rank IS NOT NULL ORDER BY rank',
      [category.id]
    );

    // Acc types (loại acc: Tự Chọn, Đặc Biệt, VIP...)
    const [accTypes] = await db.query(
      'SELECT * FROM acc_types WHERE category_id=?', [category.id]
    );

    res.render('game', {
      title:       `${category.name} – Mua Acc Giá Rẻ`,
      page:        'game',
      category, accounts, accTypes,
      ranks:       ranks.map(r => r.rank),
      filters:     { rank, type, minPrice, maxPrice, sort },
      currentPage: page,
      totalPages:  Math.ceil(total / limit),
      total
    });
  } catch (err) {
    console.error('Lỗi danh mục game:', err);
    return renderFallbackGame(res, slug, req.query);
  }
});

/* ─────────────────────────────────────────────
   CHI TIẾT ACC
   GET /game/:slug/:accId
   ───────────────────────────────────────────── */
router.get('/:slug/:accId', async (req, res) => {
  const { slug, accId } = req.params;

  try {
    if (!/^\d+$/.test(accId)) {
      const typeAliases = {
        'tui-mu': 'random',
        'server-moi': 'server-moi',
        'chien-luc-cao': 'vip'
      };
      const type = typeAliases[accId] || accId;
      return res.redirect(`/game/${slug}?type=${encodeURIComponent(type)}`);
    }

    const [[category]] = await db.query(
      'SELECT * FROM game_categories WHERE slug=?', [slug]
    );
    if (!category) return res.redirect('/');

    let [[acc]] = await db.query(`
      SELECT a.*, g.name AS game_name, g.slug AS game_slug, g.icon AS game_icon
      FROM accounts a
      JOIN game_categories g ON g.id = a.category_id
      WHERE a.id=? AND a.category_id=?
    `, [accId, category.id]);

    if (!acc) {
      req.flash('error', 'Acc không tồn tại!');
      return res.redirect(`/game/${slug}`);
    }

    // Nếu acc đã bán, chỉ cho xem nếu user đã mua
    let userOrder = null;
    if (acc.status === 'sold') {
      if (req.session.user) {
        const [[order]] = await db.query(
          `SELECT * FROM orders WHERE account_id=? AND user_id=? AND status='completed' LIMIT 1`,
          [accId, req.session.user.id]
        );
        if (order) userOrder = order;
      }
      if (!userOrder) {
        req.flash('error', 'Acc này đã được bán!');
        return res.redirect(`/game/${slug}`);
      }
    }

    // Parse images (comma-separated)
    const images = acc.images
      ? acc.images.split(',').map(s => s.trim()).filter(Boolean)
      : [];

    // Acc liên quan (cùng rank, cùng game, còn hàng)
    const [related] = await db.query(`
      SELECT id, title, rank, so_tuong, trang_phuc, price,
             SUBSTRING_INDEX(images, ',', 1) AS thumb
      FROM accounts
      WHERE category_id=? AND status='available' AND id != ?
      ORDER BY RAND() LIMIT 6
    `, [category.id, acc.id]);

    res.render('acc-detail', {
      title: `${acc.title || acc.rank} – ${category.name}`,
      page:  'game',
      category, acc, images, related, userOrder
    });
  } catch (err) {
    console.error('Lỗi chi tiết acc:', err);
    if (/^\d+$/.test(accId)) return renderLocalDetail(res, slug, accId, req);
    return renderFallbackGame(res, slug, req.query);
  }
});

module.exports = router;
