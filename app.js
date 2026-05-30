/* ============================================
   SHOPMEBU.VN – App Entry Point
   Stack: Node.js + Express + EJS + MySQL
   ============================================ */

const express    = require('express');
const path       = require('path');
const ejsLayouts = require('express-ejs-layouts');
const session    = require('express-session');
const flash      = require('connect-flash');
const { boolEnv, validateProductionEnv } = require('./config/env');
const { securityHeaders, sameOriginGuard, rateLimit } = require('./middleware/security');
const passport   = require('./config/passport');

const app = express();
validateProductionEnv();
app.disable('x-powered-by');

if (boolEnv('TRUST_PROXY', process.env.NODE_ENV === 'production')) {
  app.set('trust proxy', 1);
}

// ===== VIEW ENGINE =====
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(ejsLayouts);
app.set('layout', 'layout');

// ===== STATIC FILES =====
app.use(securityHeaders);
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: process.env.NODE_ENV === 'production' ? '7d' : 0,
  etag: true
}));

// ===== BODY PARSER =====
app.use(express.json({ limit: process.env.JSON_BODY_LIMIT || '1mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.FORM_BODY_LIMIT || '1mb' }));

// ===== SESSION =====
app.use(session({
  name: process.env.SESSION_NAME || 'shopmebu.sid',
  secret: process.env.SESSION_SECRET || 'shopmebu_secret_key',
  resave: false,
  saveUninitialized: false,
  proxy: boolEnv('TRUST_PROXY', process.env.NODE_ENV === 'production'),
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    sameSite: 'lax',
    secure: boolEnv('COOKIE_SECURE', process.env.NODE_ENV === 'production')
  }
}));

// ===== FLASH MESSAGES =====
app.use(flash());

// ===== PASSPORT (OAuth) =====
app.use(passport.initialize());
app.use(passport.session());

// ===== BASIC FIREWALL =====
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_GLOBAL || 900),
  keyPrefix: 'global'
}));
app.use(['/dang-nhap', '/dang-ky'], rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Number(process.env.RATE_LIMIT_AUTH || 20),
  methods: ['POST'],
  keyPrefix: 'auth',
  message: 'Bạn thử đăng nhập/đăng ký quá nhanh, chờ một chút rồi thử lại nhé.'
}));
app.use('/api/buy', rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_BUY || 30),
  methods: ['POST'],
  keyPrefix: 'buy',
  message: 'Thao tác mua quá nhanh, vui lòng thử lại sau.'
}));
app.use('/api/webhook/sepay', rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_WEBHOOK || 180),
  methods: ['POST'],
  keyPrefix: 'webhook',
  message: 'Webhook quá giới hạn.'
}));
app.use('/admin', rateLimit({
  windowMs: 60 * 1000,
  max: Number(process.env.RATE_LIMIT_ADMIN || 240),
  keyPrefix: 'admin',
  message: 'Admin thao tác quá nhanh, thử lại sau một chút nhé.'
}));
app.use(sameOriginGuard);

// ===== GLOBAL TEMPLATE VARS =====
const db = require('./config/db');
const localStore = require('./utils/localStore');
app.use(async (req, res, next) => {
  res.locals.user        = req.session.user || null;
  res.locals.success_msg = req.flash('success');
  res.locals.error_msg   = req.flash('error');
  res.locals.notifCount  = 0;

  // Đếm thông báo chưa đọc nếu đã đăng nhập
  if (req.session.user) {
    try {
      const [[r]] = await db.query(
        'SELECT COUNT(*) AS cnt FROM notifications WHERE user_id=? AND is_read=0',
        [req.session.user.id]
      );
      res.locals.notifCount = r.cnt || 0;
    } catch (_) {
      const notifications = await localStore.getNotifications(req.session.user.id);
      res.locals.notifCount = notifications.filter(n => !n.is_read).length;
    }
  }
  next();
});

// ===== ROUTES =====
const indexRouter   = require('./routes/index');
const authRouter    = require('./routes/auth');
const gameRouter    = require('./routes/game');
const napTienRouter = require('./routes/napTien');
const apiRouter     = require('./routes/api');
const adminRouter   = require('./routes/admin');
const userRouter    = require('./routes/user');

app.use('/',            indexRouter);
app.use('/',            authRouter);    // /dang-nhap, /dang-ky, /dang-xuat, /tai-khoan, /auth/*
app.use('/',            userRouter);    // /thong-bao, /lich-su-mua, /lich-su-nap
app.use('/game',        gameRouter);
app.use('/nap-tien',    napTienRouter);
app.use('/api',         apiRouter);
app.use('/admin',       adminRouter);  // Admin Panel

// ===== HEALTHCHECK =====
app.get('/healthz', async (req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ ok: true, database: 'mysql' });
  } catch (_) {
    res.json({ ok: true, database: 'local-fallback' });
  }
});

// ===== 404 HANDLER =====
app.use((req, res) => {
  res.status(404).render('404', { title: 'Không tìm thấy trang' });
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('500', { title: 'Lỗi hệ thống' });
});

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ SHOPMEBU.VN đang chạy tại http://localhost:${PORT}`);
});

module.exports = app;
