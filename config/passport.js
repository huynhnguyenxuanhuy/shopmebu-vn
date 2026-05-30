/* ============================================
   config/passport.js – Google OAuth
   ============================================ */
const passport       = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const db             = require('./db');

/* ---- Tạo username duy nhất từ display name ---- */
async function generateUsername(displayName) {
  const base = (displayName || 'user')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')  // bỏ dấu
    .replace(/[^a-z0-9]/g, '')
    .substring(0, 18) || 'user';
  let username = base;
  let i = 1;
  while (true) {
    const [[exist]] = await db.query('SELECT id FROM users WHERE username=?', [username]);
    if (!exist) return username;
    username = base + (i++);
  }
}

/* ---- Serialize / Deserialize ---- */
passport.serializeUser((user, done) => done(null, user.id));

passport.deserializeUser(async (id, done) => {
  try {
    const [[user]] = await db.query('SELECT * FROM users WHERE id=?', [id]);
    done(null, user || false);
  } catch (e) { done(e); }
});

/* ==================================================
   GOOGLE STRATEGY
   ================================================== */
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
    clientID:     process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL:  process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback',
    scope: ['profile', 'email']
  }, async (accessToken, refreshToken, profile, done) => {
    try {
      const email  = profile.emails?.[0]?.value || null;
      const avatar = profile.photos?.[0]?.value || null;
      const googleId = profile.id;

      // 1. Tìm theo google_id
      let [[user]] = await db.query(
        'SELECT * FROM users WHERE google_id=? AND is_active=1', [googleId]
      );
      if (user) {
        await db.query('UPDATE users SET updated_at=NOW() WHERE id=?', [user.id]);
        return done(null, user);
      }

      // 2. Tìm theo email – link OAuth vào tài khoản cũ
      if (email) {
        [[user]] = await db.query(
          'SELECT * FROM users WHERE email=? AND is_active=1', [email]
        );
        if (user) {
          await db.query(
            'UPDATE users SET google_id=?, avatar=COALESCE(NULLIF(avatar,""),?), updated_at=NOW() WHERE id=?',
            [googleId, avatar, user.id]
          );
          return done(null, { ...user, google_id: googleId });
        }
      }

      // 3. Tạo tài khoản mới
      const username = await generateUsername(profile.displayName);
      const [result] = await db.query(
        `INSERT INTO users (username, email, google_id, avatar, auth_provider, password)
         VALUES (?, ?, ?, ?, 'google', '')`,
        [username, email || `google_${googleId}@shopmebu.vn`, googleId, avatar]
      );
      [[user]] = await db.query('SELECT * FROM users WHERE id=?', [result.insertId]);
      done(null, user);
    } catch (e) {
      console.error('Google OAuth error:', e);
      done(e);
    }
  }));
}

module.exports = passport;
