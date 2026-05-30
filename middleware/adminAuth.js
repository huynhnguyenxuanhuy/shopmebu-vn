/* ============================================
   middleware/adminAuth.js
   Bảo vệ routes Admin – chỉ admin/superadmin
   ============================================ */
module.exports = function adminAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Vui lòng đăng nhập!');
    return res.redirect(`/admin/login?returnUrl=${encodeURIComponent(req.originalUrl || '/admin')}`);
  }
  const role = req.session.user.role;
  if (role !== 'admin' && role !== 'superadmin') {
    req.flash('error', 'Tài khoản này không có quyền vào Admin Panel!');
    return res.redirect('/admin/login');
  }
  next();
};
