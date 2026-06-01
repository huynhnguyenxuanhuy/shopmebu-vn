const fs = require('fs/promises');
const path = require('path');
const bcrypt = require('bcryptjs');

const dataDir = path.join(__dirname, '../data');
const runtimeFile = path.join(dataDir, 'local-runtime.json');
const usersFile = path.join(dataDir, 'local-users.json');

const categories = [
  { id: 1, name: 'Huyền Ảnh Võ Lâm', slug: 'huyen-anh-vo-lam', icon: '⚔️', is_active: 1, sort_order: 1 },
  { id: 2, name: 'Giang Hồ Kỳ Ngộ', slug: 'giang-ho-ky-ngo', icon: '🐉', is_active: 1, sort_order: 2 },
  { id: 3, name: 'Game VPlay Khác', slug: 'vplay-khac', icon: '🎲', is_active: 1, sort_order: 3 }
];

const accTypes = [
  { id: 1, category_id: 1, name: 'Tự Chọn', slug: 'tu-chon' },
  { id: 2, category_id: 1, name: 'Túi Mù Random', slug: 'random' },
  { id: 3, category_id: 1, name: 'VIP Cao Cấp', slug: 'vip' },
  { id: 4, category_id: 1, name: 'Acc REG', slug: 'reg' },
  { id: 5, category_id: 2, name: 'Tự Chọn', slug: 'tu-chon' },
  { id: 6, category_id: 2, name: 'Server Mới', slug: 'server-moi' },
  { id: 7, category_id: 2, name: 'VIP Cao', slug: 'vip' },
  { id: 8, category_id: 2, name: 'Túi Mù Random', slug: 'random' },
  { id: 9, category_id: 2, name: 'Acc REG', slug: 'reg' },
  { id: 10, category_id: 3, name: 'Acc Tự Chọn', slug: 'tu-chon' },
  { id: 11, category_id: 3, name: 'Acc Random Giá Rẻ', slug: 'random' },
  { id: 12, category_id: 3, name: 'Acc VIP', slug: 'vip' },
  { id: 13, category_id: 1, name: 'Acc Reroll', slug: 'reroll' },
  { id: 14, category_id: 2, name: 'Acc Reroll', slug: 'reroll' },
  { id: 15, category_id: 3, name: 'Acc Reroll', slug: 'reroll' }
];

const demoAccounts = [
  { id: 101, category_id: 1, acc_type_id: 3, acc_username: 'havl_vip_101', acc_password: 'VIP101@demo', acc_info: 'VIP · chiến lực cao · trắng thông tin', title: 'Acc Chiến Lực Cao VIP', price: 200000, rank: 'VIP', server: 'Server 1', images: 'https://play-lh.googleusercontent.com/556FIxsnMJWgLOOSTgAbL1ceIynb3xQv6vjL_7hBTOpaiZaX1yxk21YEefZo4q7K=w1052-h592', status: 'available', so_tuong: 86, trang_phuc: 45, ngoc: 18000 },
  { id: 102, category_id: 1, acc_type_id: 1, acc_username: 'havl_100k_102', acc_password: 'HAVL102@demo', acc_info: 'Acc trắng thông tin, đổi pass ngay sau khi nhận', title: 'Acc 100K Trắng Thông Tin', price: 100000, rank: '100K', server: 'Server 2', images: 'https://play-lh.googleusercontent.com/e1r-JdALc5NcU_YwYHAyLzfSk3OsX6JC9yYb_D7KVOnJs04ML0lhUuob0GE1ze_4IJM=w1052-h592', status: 'available', so_tuong: 38, trang_phuc: 16, ngoc: 5200 },
  { id: 103, category_id: 1, acc_type_id: 1, acc_username: 'havl_tuchon_103', acc_password: 'HAVL103@demo', acc_info: 'Tự chọn server, giao tự động 24/7', title: 'Acc Tự Chọn Server 1', price: 150000, rank: 'Tự Chọn', server: 'Server 1', images: 'https://play-lh.googleusercontent.com/EkeG-CnfqSe8Nq50orgfa1qFBpUDtI4ya8Z1lw1BjBeo6JdIqCpYDO7B5kaR3k41DI3R=w1052-h592', status: 'available', so_tuong: 54, trang_phuc: 24, ngoc: 8800 },
  { id: 104, category_id: 1, acc_type_id: 4, acc_username: 'havl_reg_104', acc_password: 'REG104@demo', acc_info: 'Acc REG mới, sạch thông tin', title: 'Acc REG Mới Toanh', price: 20000, rank: 'REG', server: 'Mới', images: 'https://play-lh.googleusercontent.com/s_Z35Ge2TQajGuVv_DvIzcgHUZ092QorX3Sc0YUGiEY6zb5JXnpycC4TZOwYiTTmJ5E=w1052-h592', status: 'available', so_tuong: 8, trang_phuc: 1, ngoc: 900 },
  { id: 201, category_id: 2, acc_type_id: 6, acc_username: 'ghkn_hot_201', acc_password: 'GHKN201@demo', acc_info: 'Server mới, nhận acc ngay', title: 'Acc Server Mới HOT', price: 80000, rank: 'Hot', server: 'Server Mới', images: 'https://gianghokyngo.vplay.vn/home/img/bg-page1.jpg', status: 'available', so_tuong: 26, trang_phuc: 8, ngoc: 4200 },
  { id: 202, category_id: 2, acc_type_id: 7, acc_username: 'ghkn_vip_202', acc_password: 'GHKN202@demo', acc_info: 'Chiến lực max, full tài nguyên', title: 'Acc Chiến Lực Max', price: 300000, rank: 'VIP', server: 'Server 3', images: 'https://gianghokyngo.vplay.vn/home/img/bg-page3.jpg', status: 'available', so_tuong: 92, trang_phuc: 48, ngoc: 22000 },
  { id: 203, category_id: 2, acc_type_id: 5, acc_username: 'ghkn_tuchon_203', acc_password: 'GHKN203@demo', acc_info: 'Tự chọn GHKN, giao tự động', title: 'Acc Tự Chọn GHKN', price: 120000, rank: 'Tự Chọn', server: 'Server 2', images: 'https://gianghokyngo.vplay.vn/home/img/img-slide.png', status: 'available', so_tuong: 42, trang_phuc: 19, ngoc: 7600 },
  { id: 204, category_id: 2, acc_type_id: 9, acc_username: 'ghkn_reg_204', acc_password: 'REG204@demo', acc_info: 'REG mới 100%', title: 'Acc REG Mới 100%', price: 30000, rank: 'REG', server: 'Mới', images: 'https://gianghokyngo.vplay.vn/home/img/bg-page4.jpg', status: 'available', so_tuong: 6, trang_phuc: 1, ngoc: 700 },
  { id: 301, category_id: 3, acc_type_id: 10, acc_username: 'vplay_301', acc_password: 'VPLAY301@demo', acc_info: 'Acc game VPlay khác, tự chọn', title: 'Acc VPlay Tự Chọn', price: 90000, rank: 'Tự Chọn', server: 'VPlay', images: 'https://play-lh.googleusercontent.com/i6WceP8bKoQcOUv_guR3DlwxkddsKzIiYl-fw7BTRRxmVsDOyBw_XjcY1OFHloSXtaU=w1052-h592', status: 'available', so_tuong: 20, trang_phuc: 7, ngoc: 3300 },
  { id: 302, category_id: 3, acc_type_id: 11, acc_username: 'random_302', acc_password: 'RANDOM302@demo', acc_info: 'Túi mù random, nhận acc ngay', title: 'Túi Mù Random VPlay', price: 50000, rank: 'Random', server: 'Random', images: 'https://gianghokyngo.vplay.vn/home/img/bg-page2.jpg', status: 'available', so_tuong: 0, trang_phuc: 0, ngoc: 0 }
];

function now() {
  return new Date().toISOString();
}

async function ensureDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (_) {
    return fallback;
  }
}

async function writeJson(file, data) {
  await ensureDir();
  await fs.writeFile(file, JSON.stringify(data, null, 2), 'utf8');
}

async function readRuntime() {
  const runtime = await readJson(runtimeFile, null);
  if (runtime) return runtime;
  const seed = {
    accounts: demoAccounts.map(a => ({ ...a, created_at: now(), sold_at: null })),
    orders: [],
    transactions: [],
    ctv_sales: [],
    notifications: [],
    payment_logs: [],
    settings: {}
  };
  await writeJson(runtimeFile, seed);
  return seed;
}

async function writeRuntime(runtime) {
  await writeJson(runtimeFile, runtime);
}

async function readUsers() {
  const users = await readJson(usersFile, []);
  if (!users.find(u => u.username === 'admin_demo')) {
    users.unshift({
      id: 1779923000000,
      username: 'admin_demo',
      email: 'admin_demo@shopmebu.vn',
      password: await bcrypt.hash('Admin123', 10),
      role: 'superadmin',
      balance: 0,
      avatar: null,
      auth_provider: 'local',
      created_at: now()
    });
    await writeUsers(users);
  }
  return users;
}

async function writeUsers(users) {
  await writeJson(usersFile, users);
}

function categoryById(id) {
  return categories.find(c => c.id === Number(id));
}

function categoryBySlug(slug) {
  return categories.find(c => c.slug === slug);
}

function typeById(id) {
  return accTypes.find(t => t.id === Number(id));
}

function typeBySlug(categoryId, slug) {
  return accTypes.find(t => t.category_id === Number(categoryId) && t.slug === slug);
}

function enrichAccount(acc) {
  const category = categoryById(acc.category_id) || categories[0];
  const type = typeById(acc.acc_type_id) || null;
  return {
    ...acc,
    game_name: category.name,
    game_slug: category.slug,
    game_icon: category.icon,
    category_slug: category.slug,
    thumb: acc.images ? acc.images.split(',')[0].trim() : '',
    image_url: acc.images ? acc.images.split(',')[0].trim() : '',
    rank_name: acc.rank,
    acc_type: type?.slug || ''
  };
}

function nextId(items, min = 1) {
  return Math.max(min, ...items.map(i => Number(i.id) || 0)) + 1;
}

async function listAccounts({ slug, status = 'available', type = '', search = '', game = '' } = {}) {
  const runtime = await readRuntime();
  let accounts = runtime.accounts.map(enrichAccount);
  if (status) accounts = accounts.filter(a => a.status === status);
  if (slug) accounts = accounts.filter(a => a.game_slug === slug);
  if (game) accounts = accounts.filter(a => a.game_slug === game);
  if (type) {
    const aliases = { 'tui-mu': 'random', 'server-moi': 'server-moi', 'chien-luc-cao': 'vip', '20k': '', '50k': '', '100k': '', '200k': '' };
    const normalized = aliases[type] !== undefined ? aliases[type] : type;
    if (normalized) accounts = accounts.filter(a => a.acc_type === normalized || String(a.rank || '').toLowerCase().includes(normalized));
  }
  if (search) {
    const key = search.toLowerCase();
    accounts = accounts.filter(a =>
      [a.acc_username, a.title, a.rank, a.game_name, a.server].some(v => String(v || '').toLowerCase().includes(key))
    );
  }
  return accounts.sort((a, b) => Number(b.id) - Number(a.id));
}

async function getAccount(id) {
  const runtime = await readRuntime();
  const acc = runtime.accounts.find(a => Number(a.id) === Number(id));
  return acc ? enrichAccount(acc) : null;
}

async function addAccount(payload) {
  const runtime = await readRuntime();
  const category = categoryBySlug(payload.game_slug) || categories[0];
  const type = typeBySlug(category.id, payload.acc_type || 'tu-chon');
  const account = {
    id: nextId(runtime.accounts, 400),
    category_id: category.id,
    acc_type_id: type?.id || null,
    acc_username: payload.acc_username,
    acc_password: payload.acc_password,
    acc_info: payload.acc_info || payload.category || null,
    title: payload.title || `Acc ${payload.rank_name || category.name}`,
    price: Number(payload.price) || 0,
    rank: payload.rank_name || null,
    server: payload.server || null,
    images: payload.image_url || 'https://play-lh.googleusercontent.com/i6WceP8bKoQcOUv_guR3DlwxkddsKzIiYl-fw7BTRRxmVsDOyBw_XjcY1OFHloSXtaU=w1052-h592',
    status: 'available',
    ctv_id: payload.ctv_id ? Number(payload.ctv_id) : null,
    so_tuong: 0,
    trang_phuc: 0,
    ngoc: 0,
    created_at: now(),
    sold_at: null
  };
  runtime.accounts.push(account);
  await writeRuntime(runtime);
  return enrichAccount(account);
}

async function updateAccount(id, payload) {
  const runtime = await readRuntime();
  const idx = runtime.accounts.findIndex(a => Number(a.id) === Number(id));
  if (idx < 0) return null;
  const category = categoryBySlug(payload.game_slug) || categoryById(runtime.accounts[idx].category_id);
  const type = typeBySlug(category.id, payload.acc_type || '');
  runtime.accounts[idx] = {
    ...runtime.accounts[idx],
    category_id: category.id,
    acc_type_id: type?.id || runtime.accounts[idx].acc_type_id,
    acc_username: payload.acc_username,
    acc_password: payload.acc_password,
    acc_info: payload.acc_info || null,
    title: payload.title || null,
    price: Number(payload.price) || 0,
    rank: payload.rank_name || null,
    server: payload.server || null,
    images: payload.image_url || runtime.accounts[idx].images,
    ctv_id: payload.ctv_id ? Number(payload.ctv_id) : null
  };
  await writeRuntime(runtime);
  return enrichAccount(runtime.accounts[idx]);
}

async function deleteAccount(id) {
  const runtime = await readRuntime();
  const acc = runtime.accounts.find(a => Number(a.id) === Number(id));
  if (!acc || acc.status === 'sold') return false;
  runtime.accounts = runtime.accounts.filter(a => Number(a.id) !== Number(id));
  await writeRuntime(runtime);
  return true;
}

async function buyAccount(userId, accId, referralCtvId = null) {
  const runtime = await readRuntime();
  const users = await readUsers();
  const user = users.find(u => Number(u.id) === Number(userId));
  const acc = runtime.accounts.find(a => Number(a.id) === Number(accId) && a.status === 'available');
  if (!user) return { success: false, message: 'User không tồn tại!' };
  if (!acc) return { success: false, message: 'Acc đã được mua hoặc không tồn tại!' };
  const before = Number(user.balance || 0);
  if (before < Number(acc.price)) {
    return {
      success: false,
      message: `Số dư không đủ! Cần ${Number(acc.price).toLocaleString('vi-VN')}đ, bạn có ${before.toLocaleString('vi-VN')}đ`,
      redirect: '/nap-tien'
    };
  }
  const after = before - Number(acc.price);
  user.balance = after;
  acc.status = 'sold';
  acc.sold_at = now();
  // Credit CTV balance when their acc is sold
  const ctvId = Number(acc.ctv_id || referralCtvId || 0);
  if (ctvId && ctvId !== Number(userId)) {
    const ctvUser = users.find(u => Number(u.id) === ctvId);
    if (ctvUser && ctvUser.role === 'staff') {
      const pct = Math.max(0, Math.min(100, Number(runtime.settings?.ctv_commission?.[acc.category_id] ?? 100)));
      const commissionAmount = Math.floor(Number(acc.price) * pct / 100);
      ctvUser.ctv_balance = (Number(ctvUser.ctv_balance) || 0) + commissionAmount;
      if (!runtime.ctv_sales) runtime.ctv_sales = [];
      runtime.ctv_sales.push({
        id: nextId(runtime.ctv_sales, 1),
        ctv_id: ctvId,
        account_id: Number(accId),
        order_id: null,
        amount: commissionAmount,
        commission_percent: pct,
        status: 'credited',
        created_at: now()
      });
    }
  }
  const order = {
    id: nextId(runtime.orders, 1),
    user_id: Number(userId),
    account_id: Number(accId),
    amount: Number(acc.price),
    status: 'completed',
    acc_username: acc.acc_username,
    acc_password: acc.acc_password,
    acc_info: acc.acc_info,
    created_at: now()
  };
  const tx = {
    id: nextId(runtime.transactions, 1),
    user_id: Number(userId),
    type: 'purchase',
    amount: Number(acc.price),
    balance_before: before,
    balance_after: after,
    status: 'success',
    note: `Mua acc #${accId}`,
    created_at: now()
  };
  const notif = {
    id: nextId(runtime.notifications, 1),
    user_id: Number(userId),
    type: 'order',
    title: 'Mua acc thành công',
    message: `Acc #${accId} đã được giao tự động. Kiểm tra lịch sử mua để lấy thông tin.`,
    link: '/lich-su-mua',
    is_read: 0,
    created_at: now()
  };
  runtime.orders.push(order);
  runtime.transactions.push(tx);
  runtime.notifications.push(notif);
  await writeUsers(users);
  await writeRuntime(runtime);
  return { success: true, order, new_balance: after };
}

async function adjustBalance(userId, amount, note = 'Admin điều chỉnh') {
  const runtime = await readRuntime();
  const users = await readUsers();
  const user = users.find(u => Number(u.id) === Number(userId));
  if (!user) return null;
  const before = Number(user.balance || 0);
  const after = Math.max(0, before + Number(amount || 0));
  user.balance = after;
  runtime.transactions.push({
    id: nextId(runtime.transactions, 1),
    user_id: Number(userId),
    type: 'admin_adjust',
    amount: Number(amount || 0),
    balance_before: before,
    balance_after: after,
    payment_method: 'admin',
    status: 'success',
    note,
    created_at: now()
  });
  await writeUsers(users);
  await writeRuntime(runtime);
  return { before, after, user };
}

async function getUserOrders(userId) {
  const runtime = await readRuntime();
  return runtime.orders
    .filter(o => Number(o.user_id) === Number(userId))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(o => {
      const acc = runtime.accounts.find(a => Number(a.id) === Number(o.account_id));
      const category = categoryById(acc?.category_id) || categories[0];
      return { ...o, ...(acc ? enrichAccount(acc) : {}), game_name: category.name, game_icon: category.icon, game_slug: category.slug };
    });
}

async function getUserTransactions(userId, type = '') {
  const runtime = await readRuntime();
  return runtime.transactions
    .filter(t => Number(t.user_id) === Number(userId) && (!type || t.type === type))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function getNotifications(userId) {
  const runtime = await readRuntime();
  return runtime.notifications
    .filter(n => Number(n.user_id) === Number(userId))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

async function addNotification({ userId, type = 'system', title, message, link = null }) {
  const runtime = await readRuntime();
  const item = { id: nextId(runtime.notifications, 1), user_id: Number(userId), type, title, message, link, is_read: 0, created_at: now() };
  runtime.notifications.push(item);
  await writeRuntime(runtime);
  return item;
}

async function markNotificationsRead(userId) {
  const runtime = await readRuntime();
  runtime.notifications.forEach(n => {
    if (Number(n.user_id) === Number(userId)) n.is_read = 1;
  });
  await writeRuntime(runtime);
}

async function listOrders() {
  const runtime = await readRuntime();
  const users = await readUsers();
  return runtime.orders
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(o => {
      const user = users.find(u => Number(u.id) === Number(o.user_id));
      const acc = runtime.accounts.find(a => Number(a.id) === Number(o.account_id));
      const category = categoryById(acc?.category_id) || categories[0];
      return { ...o, username: user?.username || `user#${o.user_id}`, acc_username: acc?.acc_username || o.acc_username, game_slug: category.slug };
    });
}

async function listPaymentLogs() {
  const runtime = await readRuntime();
  const users = await readUsers();
  return runtime.payment_logs.map(log => ({
    ...log,
    matched_username: users.find(u => Number(u.id) === Number(log.matched_user))?.username || null
  }));
}


// ===== CTV WITHDRAWAL FUNCTIONS =====
async function createCtvWithdrawal(ctvId, amount, bankInfo) {
  const runtime = await readRuntime();
  if (!runtime.ctv_withdrawals) runtime.ctv_withdrawals = [];
  const id = nextId(runtime.ctv_withdrawals, 1);
  const w = { id, ctv_id: Number(ctvId), amount: Number(amount), bank_info: bankInfo, status: 'pending', created_at: now() };
  runtime.ctv_withdrawals.push(w);
  await writeRuntime(runtime);
  return w;
}
async function getCtvWithdrawals(ctvId) {
  const runtime = await readRuntime();
  const list = runtime.ctv_withdrawals || [];
  if (ctvId) return list.filter(w => Number(w.ctv_id) === Number(ctvId));
  return list;
}

async function getCtvSales(ctvId) {
  const runtime = await readRuntime();
  const list = runtime.ctv_sales || [];
  return list
    .filter(s => !ctvId || Number(s.ctv_id) === Number(ctvId))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .map(s => {
      const acc = runtime.accounts.find(a => Number(a.id) === Number(s.account_id));
      const category = categoryById(acc?.category_id) || categories[0];
      return { ...s, acc_username: acc?.acc_username, title: acc?.title, rank: acc?.rank, game_name: category.name };
    });
}
async function approveCtvWithdrawal(withdrawalId) {
  const runtime = await readRuntime();
  const users = await readUsers();
  if (!runtime.ctv_withdrawals) runtime.ctv_withdrawals = [];
  const w = runtime.ctv_withdrawals.find(x => Number(x.id) === Number(withdrawalId));
  if (!w || w.status !== 'pending') return false;
  const ctvUser = users.find(u => Number(u.id) === Number(w.ctv_id));
  if (!ctvUser) return false;
  ctvUser.ctv_balance = Math.max(0, (Number(ctvUser.ctv_balance) || 0) - Number(w.amount));
  w.status = 'approved'; w.approved_at = now();
  await writeRuntime(runtime); await writeUsers(users);
  return true;
}
async function rejectCtvWithdrawal(withdrawalId) {
  const runtime = await readRuntime();
  if (!runtime.ctv_withdrawals) runtime.ctv_withdrawals = [];
  const w = runtime.ctv_withdrawals.find(x => Number(x.id) === Number(withdrawalId));
  if (!w || w.status !== 'pending') return false;
  w.status = 'rejected'; w.rejected_at = now();
  await writeRuntime(runtime);
  return true;
}

module.exports = {
  categories,
  accTypes,
  readRuntime,
  writeRuntime,
  readUsers,
  writeUsers,
  categoryBySlug,
  categoryById,
  typeBySlug,
  enrichAccount,
  listAccounts,
  getAccount,
  addAccount,
  updateAccount,
  deleteAccount,
  buyAccount,
  adjustBalance,
  getUserOrders,
  getUserTransactions,
  getNotifications,
  addNotification,
  markNotificationsRead,
  listOrders,
  listPaymentLogs,
  nextId,
  createCtvWithdrawal,
  getCtvWithdrawals,
  getCtvSales,
  approveCtvWithdrawal,
  rejectCtvWithdrawal,
  readUsers
};
