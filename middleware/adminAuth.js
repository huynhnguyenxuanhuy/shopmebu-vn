/* ============================================
   middleware/adminAuth.js
   Bảo vệ routes Admin – chỉ admin/superadmin
   ============================================ */
module.exports = function adminAuth(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Vui lòng đăng nhập!');
    if (req.xhr || req.headers.accept?.includes('application/json') || ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return res.status(401).json({
        success: false,
        message: 'Phiên admin đã hết hạn, vui lòng đăng nhập lại.',
        redirect: `/admin/login?returnUrl=${encodeURIComponent(req.originalUrl || '/admin')}`
      });
    }
    return res.redirect(`/admin/login?returnUrl=${encodeURIComponent(req.originalUrl || '/admin')}`);
  }
  const role = req.session.user.role;
  if (role !== 'admin' && role !== 'superadmin') {
    req.flash('error', 'Tài khoản này không có quyền vào Admin Panel!');
    if (req.xhr || req.headers.accept?.includes('application/json') || ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return res.status(403).json({ success: false, message: 'Tài khoản này không có quyền vào Admin Panel!' });
    }
    return res.redirect('/admin/login');
  }
  next();
};
