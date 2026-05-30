# THÔNG TIN DEPLOY - SHOPMEBU.VN

## 🌐 Hosting (CloudFly cPanel)
- **cPanel URL:** https://cp024007.cloudfly.vn:2083
- **Username cPanel:** gjkbizr
- **SSO Login:** my.cloudfly.vn → Cloud Hosting → shopmebu.vn → "Đăng nhập vào cPanel"

## 🗄️ Database MySQL
- **Host:** localhost
- **Database:** gjkbizr_shopmebu
- **Username:** gjkbizr_shopmebu
- **Password:** Shopmebu@2024!
- **Port:** 3306

## 🗂️ App Node.js
- **App root:** /home/gjkbizr/shopmebu
- **Startup file:** app.js
- **Node version:** 20.19.4
- **Mode:** production
- **URL:** https://shopmebu.vn

## 👤 Admin Panel
- **URL:** https://shopmebu.vn/admin
- **Username:** shopmebu
- **Password:** Shopmebu@2024!
- **Role:** superadmin

## 🔑 SePay Webhook
- **Token:** YGNEPZQT3ZPLSLOGUTLX5W7NFHAVEK2UYMVV1KFCJWXJMMMFXNL9WCZDO3AINIPB
- **Webhook URL:** https://shopmebu.vn/api/webhook/sepay
- **Tên webhook:** ShopMeBu Nạp Tiền
- **Auth:** API Key — đã cấu hình trong dashboard SePay ✅

## 🔐 Session Secret
SESSION_SECRET=shopmebu_super_secret_key_2024_random_long

## 📁 File .env trên server
/home/gjkbizr/shopmebu/.env

## 💰 TPBank (nhận tiền)
- **Tên:** VÕ PHAN TRUNG HIẾU
- **STK:** 01577578410
- **Chi nhánh:** Hồ Chí Minh

## 📲 MoMo (nhận tiền)
- **Tên:** VÕ PHAN TRUNG HIẾU
- **STK:** *(cần cập nhật STK MoMo thật trong admin Settings)*

## 📌 Mã nạp tiền
- Format: SMB{userId} (ví dụ: SMB1, SMB2...)
- Bonus: +10% khi nạp
- Tối thiểu: 10.000đ

## ✅ Trạng thái deploy (29/5/2026)
- [x] Upload & extract code
- [x] npm install (120 packages)
- [x] Tạo .env
- [x] Tạo database gjkbizr_shopmebu
- [x] Import schema (11 tables)
- [x] Fix charset toàn bộ DB tables → utf8mb4
- [x] Node.js app v20.19.4 chạy qua Passenger
- [x] SSL/HTTPS (AutoSSL Let's Encrypt, hết hạn 27/8/2026, tự gia hạn)
- [x] HTTP → HTTPS redirect (301) qua .htaccess
- [x] Cấu hình SePay webhook (API Key auth)
- [x] Tạo admin user (shopmebu / superadmin)
- [x] Fix encoding lỗi: game names, icons, tên chủ TK
- [x] Xóa debug hint trên trang admin login
- [x] DNS A record: shopmebu.vn → 103.82.24.7 ✅
- [x] DNS www: www.shopmebu.vn → 103.82.24.7 (đã thêm, đang propagate)

## ⚠️ Còn cần làm sau khi có dữ liệu thật
- [ ] Thêm STK MoMo thật vào Admin → Cài Đặt Shop
- [ ] Thêm acc game vào kho (Admin → Thêm Acc Mới hoặc Thêm Bulk)
- [ ] Test nạp tiền end-to-end bằng chuyển khoản thật
- [ ] Cập nhật link Zalo/Facebook thật (hiện đang dùng link demo)
- [ ] SSL www.shopmebu.vn (sau khi www DNS propagate hoàn toàn)

## 🔧 Cấu hình server quan trọng
- **public_html/.htaccess:** HTTP→HTTPS redirect + Passenger config
- **DB charset:** utf8mb4_unicode_ci (đã convert tất cả tables)
- **Cookie secure:** true (chỉ hoạt động qua HTTPS)
- **Node env:** production
