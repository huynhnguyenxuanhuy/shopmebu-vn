# SHOPMEBU.VN – Hướng Dẫn Deploy VPS

## Yêu Cầu
- Node.js >= 18
- MySQL >= 5.7 / MariaDB >= 10.3
- PM2 (process manager)
- Nginx (reverse proxy)

## 1. Upload Code Lên VPS

```bash
# Dùng FileZilla hoặc scp
scp -r shopmebu/ user@your-vps-ip:/var/www/shopmebu
```

## 2. Cài Đặt Dependencies

```bash
cd /var/www/shopmebu
npm install
```

## 3. Tạo Database & Chạy Schema

```bash
mysql -u root -p
CREATE DATABASE shopmebu CHARACTER SET utf8mb4;
exit

mysql -u root -p shopmebu < database/schema.sql
```

## 4. Cấu Hình .env

```bash
cp .env.example .env
nano .env
# Điền thông tin DB, SESSION_SECRET, BASE_URL
```

Gợi ý production:

```env
NODE_ENV=production
BASE_URL=https://shopmebu.vn
TRUST_PROXY=1
COOKIE_SECURE=1
SESSION_SECRET=chuoi_bi_mat_dai_toi_thieu_32_ky_tu
```

Kiểm tra cấu hình trước khi chạy thật:

```bash
npm run check:syntax
npm run check:deploy
```

## 5. Thông Tin Ngân Hàng / Nội Dung Website

- QR nạp tiền đang dùng VietQR động theo thông tin trong Admin → Cài đặt.
- Có thể sửa nội dung trang chủ và trang thông tin tại Admin → Nội Dung Website.
- Thêm logo/favicon nếu cần vào `public/img/`.

## 6. Khởi Động Server

```bash
# Development
node app.js

# Production với PM2
npm install -g pm2
pm2 start app.js --name shopmebu
pm2 startup
pm2 save
```

## 7. Cấu Hình Nginx

```nginx
limit_req_zone $binary_remote_addr zone=shopmebu_api:10m rate=10r/s;
limit_req_zone $binary_remote_addr zone=shopmebu_login:10m rate=5r/m;

server {
    listen 80;
    server_name shopmebu.vn www.shopmebu.vn;

    client_max_body_size 8m;

    location ~ ^/(dang-nhap|dang-ky)$ {
        limit_req zone=shopmebu_login burst=10 nodelay;
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location ~ ^/api/ {
        limit_req zone=shopmebu_api burst=30 nodelay;
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    location /healthz {
        proxy_pass http://localhost:3000/healthz;
    }
}
```

Sau đó cài SSL bằng Certbot hoặc panel VPS để domain chạy HTTPS.

## 8. Cấu Hình SePay Webhook

1. Đăng ký tài khoản tại [sepay.vn](https://sepay.vn)
2. Kết nối tài khoản ngân hàng chủ shop
3. Cấu hình webhook URL: `https://shopmebu.vn/api/webhook/sepay`
4. Lấy API Token và điền vào `.env` → `SEPAY_WEBHOOK_TOKEN`
5. Restart app: `pm2 restart shopmebu`
6. Test chuyển khoản nhỏ với nội dung nạp tiền user được web tạo.

## 9. Tạo Tài Khoản Admin

```sql
-- Sau khi đăng ký tài khoản bình thường, nâng quyền:
UPDATE users SET role='superadmin' WHERE username='your_username';
```

Tài khoản local demo hiện có trong fallback JSON không tự chuyển vào MySQL production. Khi deploy thật, tạo admin trong MySQL theo câu SQL ở trên.

## 10. Kiểm Tra Sau Deploy

```bash
curl -I https://shopmebu.vn
curl https://shopmebu.vn/healthz
pm2 logs shopmebu --lines 100
```

Checklist test tay:
- Đăng ký / đăng nhập local.
- Đăng nhập Google nếu đã cấu hình OAuth thật.
- Nạp tiền hiển thị đúng QR và nội dung chuyển khoản.
- Webhook SePay cộng tiền đúng user.
- Mua acc trừ tiền, giao acc, acc đã bán biến mất khỏi danh mục.
- Admin xem dashboard, đơn hàng, users, acc, thanh toán, CMS nội dung.

## 11. Bảo Mật Production

App đã có sẵn:
- Security headers cơ bản.
- Same-origin guard cho request POST/PUT/PATCH/DELETE.
- Rate limit cho login/register, mua acc, webhook, admin.
- Cookie session `httpOnly`, `sameSite`, và `secure` khi bật HTTPS.
- SePay webhook token + chống xử lý trùng mã giao dịch.

VPS nên bật firewall:

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

Không mở trực tiếp cổng Node `3000` ra internet; để Node chạy nội bộ sau Nginx.

## Cấu Trúc Thư Mục

```
shopmebu/
├── app.js              ← Entry point
├── .env                ← Biến môi trường (tạo từ .env.example)
├── config/
│   └── db.js           ← Kết nối MySQL
├── database/
│   └── schema.sql      ← Schema + seed data
├── routes/
│   ├── index.js        ← Trang chủ, tìm kiếm
│   ├── auth.js         ← Đăng ký, đăng nhập
│   ├── game.js         ← Danh mục, chi tiết acc
│   ├── napTien.js      ← Trang nạp tiền
│   └── api.js          ← Webhook + Mua acc tự động
├── views/
│   ├── layout.ejs
│   ├── partials/
│   │   ├── header.ejs
│   │   └── footer.ejs
│   ├── index.ejs       ← Trang chủ
│   ├── game.ejs        ← Danh mục game
│   ├── acc-detail.ejs  ← Chi tiết acc
│   ├── nap-tien.ejs    ← Nạp tiền
│   ├── dang-nhap.ejs
│   ├── dang-ky.ejs
│   ├── tai-khoan.ejs
│   ├── search.ejs
│   ├── 404.ejs
│   └── 500.ejs
└── public/
    ├── css/style.css
    ├── js/main.js
    └── img/            ← Ảnh QR, logo (tự thêm)
```
