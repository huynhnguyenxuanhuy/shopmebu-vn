-- ============================================
-- SHOPMEBU.VN – Database Schema
-- MySQL 5.7+ / MariaDB 10.3+
-- ============================================

CREATE DATABASE IF NOT EXISTS shopmebu CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE shopmebu;

-- ===== USERS =====
CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  username      VARCHAR(50)  NOT NULL UNIQUE,
  email         VARCHAR(100) NOT NULL UNIQUE,
  password      VARCHAR(255) NOT NULL DEFAULT '',
  role          ENUM('guest','customer','staff','admin','superadmin') DEFAULT 'customer',
  balance       DECIMAL(15,0) DEFAULT 0,
  avatar        VARCHAR(500)  DEFAULT NULL,
  phone         VARCHAR(20)   DEFAULT NULL,
  -- OAuth
  google_id     VARCHAR(100)  DEFAULT NULL UNIQUE,
  facebook_id   VARCHAR(100)  DEFAULT NULL UNIQUE,
  auth_provider ENUM('local','google','facebook') DEFAULT 'local',
  is_active     TINYINT(1)    DEFAULT 1,
  created_at    DATETIME      DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- ===== GAME CATEGORIES =====
CREATE TABLE IF NOT EXISTS game_categories (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(100) NOT NULL UNIQUE,
  icon        VARCHAR(50)  DEFAULT '🎮',
  description TEXT,
  sort_order  INT          DEFAULT 0,
  is_active   TINYINT(1)   DEFAULT 1
) ENGINE=InnoDB;

INSERT INTO game_categories (name, slug, icon, sort_order) VALUES
  ('Huyền Ảnh Võ Lâm',  'huyen-anh-vo-lam', '⚔️', 1),
  ('Giang Hồ Kỳ Ngộ',   'giang-ho-ky-ngo',  '🐉', 2),
  ('Game VPlay Khác',    'vplay-khac',        '🎲', 3)
ON DUPLICATE KEY UPDATE
  name=VALUES(name),
  icon=VALUES(icon),
  sort_order=VALUES(sort_order);

-- ===== ACC TYPES =====
CREATE TABLE IF NOT EXISTS acc_types (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL,
  name        VARCHAR(100) NOT NULL,
  slug        VARCHAR(100) NOT NULL,
  UNIQUE KEY uniq_acc_type (category_id, slug),
  FOREIGN KEY (category_id) REFERENCES game_categories(id)
) ENGINE=InnoDB;

INSERT INTO acc_types (category_id, name, slug)
SELECT gc.id, t.name, t.slug
FROM game_categories gc
JOIN (
  SELECT 'Tự Chọn' AS name, 'tu-chon' AS slug UNION ALL
  SELECT 'Túi Mù Random', 'random' UNION ALL
  SELECT 'VIP Cao Cấp', 'vip' UNION ALL
  SELECT 'Acc REG', 'reg' UNION ALL
  SELECT 'Acc Reroll', 'reroll'
) t
ON DUPLICATE KEY UPDATE name=VALUES(name);

-- ===== ACCOUNTS (KHO ACC) =====
CREATE TABLE IF NOT EXISTS accounts (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  category_id   INT NOT NULL,
  acc_type_id   INT DEFAULT NULL,
  title         VARCHAR(200) DEFAULT NULL,
  -- Thông số acc
  rank          VARCHAR(50)  DEFAULT NULL,
  so_tuong      INT          DEFAULT 0,
  trang_phuc    INT          DEFAULT 0,
  ngoc          INT          DEFAULT 0,
  server        VARCHAR(50)  DEFAULT NULL,
  -- Ảnh (JSON array)
  images        TEXT         DEFAULT NULL,
  -- Thông tin đăng nhập (chỉ hiện sau khi mua)
  acc_username  VARCHAR(200) DEFAULT NULL,
  acc_password  VARCHAR(200) DEFAULT NULL,
  acc_info      TEXT         DEFAULT NULL,
  -- Giá (chỉ giá ATM)
  price         DECIMAL(15,0) NOT NULL DEFAULT 0,
  -- Trạng thái
  status        ENUM('available','sold','hidden') DEFAULT 'available',
  sold_at       DATETIME     DEFAULT NULL,
  created_at    DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES game_categories(id)
) ENGINE=InnoDB;

-- ===== ORDERS =====
CREATE TABLE IF NOT EXISTS orders (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  user_id      INT NOT NULL,
  account_id   INT NOT NULL,
  amount       DECIMAL(15,0) NOT NULL,
  status       ENUM('pending','completed','refunded') DEFAULT 'completed',
  -- Thông tin acc được giao cho khách (snapshot)
  acc_username VARCHAR(200) DEFAULT NULL,
  acc_password VARCHAR(200) DEFAULT NULL,
  acc_info     TEXT         DEFAULT NULL,
  created_at   DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)    REFERENCES users(id),
  FOREIGN KEY (account_id) REFERENCES accounts(id)
) ENGINE=InnoDB;

-- ===== NẠP TIỀN / TRANSACTIONS =====
CREATE TABLE IF NOT EXISTS transactions (
  id              INT AUTO_INCREMENT PRIMARY KEY,
  user_id         INT          DEFAULT NULL,  -- NULL nếu chưa khớp user
  type            ENUM('deposit','purchase','refund','admin_adjust') NOT NULL,
  amount          DECIMAL(15,0) NOT NULL,
  balance_before  DECIMAL(15,0) DEFAULT 0,
  balance_after   DECIMAL(15,0) DEFAULT 0,
  -- Thông tin thanh toán
  payment_method  ENUM('momo','tpbank','atm','zalopay','qr','manual','admin') DEFAULT NULL,
  transfer_code   VARCHAR(100)  DEFAULT NULL,  -- Mã giao dịch ngân hàng
  transfer_content VARCHAR(255) DEFAULT NULL,  -- Nội dung CK
  transfer_ref    VARCHAR(255)  DEFAULT NULL,  -- Ref từ webhook
  -- Trạng thái
  status          ENUM('pending','success','failed') DEFAULT 'pending',
  note            TEXT          DEFAULT NULL,
  created_at      DATETIME      DEFAULT CURRENT_TIMESTAMP,
  KEY idx_transactions_ref_type (transfer_ref, type),
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ===== PAYMENT WEBHOOKS LOG =====
CREATE TABLE IF NOT EXISTS payment_logs (
  id           INT AUTO_INCREMENT PRIMARY KEY,
  source       VARCHAR(50)  DEFAULT NULL,  -- 'sepay','momo','tpbank'
  raw_data     TEXT         DEFAULT NULL,  -- Raw JSON từ webhook
  amount       DECIMAL(15,0) DEFAULT 0,
  content      VARCHAR(500)  DEFAULT NULL,
  ref_code     VARCHAR(100)  DEFAULT NULL,
  matched_user INT           DEFAULT NULL,
  is_processed TINYINT(1)    DEFAULT 0,
  created_at   DATETIME      DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

CREATE INDEX idx_payment_logs_ref ON payment_logs (ref_code);
CREATE INDEX idx_payment_logs_processed ON payment_logs (is_processed);

-- ===== TOP 5 NẠP TIỀN =====
CREATE TABLE IF NOT EXISTS top_depositors (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  user_id     INT NOT NULL UNIQUE,
  period      VARCHAR(7)    NOT NULL,  -- '2025-01' (năm-tháng)
  total       DECIMAL(15,0) DEFAULT 0,
  count       INT           DEFAULT 0,
  rank        INT           DEFAULT 0,
  updated_at  DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB;

-- ===== BANNERS =====
CREATE TABLE IF NOT EXISTS banners (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  title      VARCHAR(200)  DEFAULT NULL,
  image_url  VARCHAR(500)  NOT NULL,
  link_url   VARCHAR(500)  DEFAULT '#',
  sort_order INT           DEFAULT 0,
  is_active  TINYINT(1)    DEFAULT 1
) ENGINE=InnoDB;

-- Ảnh banner placeholder (game VPlay themed)
INSERT INTO banners (title, image_url, link_url, sort_order) VALUES
  ('Huyền Ảnh Võ Lâm – Mua Acc Uy Tín', 'https://play-lh.googleusercontent.com/556FIxsnMJWgLOOSTgAbL1ceIynb3xQv6vjL_7hBTOpaiZaX1yxk21YEefZo4q7K=w1052-h592', '/game/huyen-anh-vo-lam', 1),
  ('Giang Hồ Kỳ Ngộ – Server Mới HOT',  'https://gianghokyngo.vplay.vn/home/img/bg-page1.jpg', '/game/giang-ho-ky-ngo', 2),
  ('Nạp Tiền +10% ATM',                 'https://play-lh.googleusercontent.com/EkeG-CnfqSe8Nq50orgfa1qFBpUDtI4ya8Z1lw1BjBeo6JdIqCpYDO7B5kaR3k41DI3R=w1052-h592', '/nap-tien', 3);

-- ===== SITE SETTINGS =====
CREATE TABLE IF NOT EXISTS settings (
  `key`   VARCHAR(100) PRIMARY KEY,
  value   TEXT         DEFAULT NULL
) ENGINE=InnoDB;

INSERT INTO settings (`key`, value) VALUES
  ('site_name',         'SHOPMEBU.VN'),
  ('hotline',           '0xxx.xxx.xxx'),
  ('zalo_link',         'https://zalo.me/g/gssfxa652'),
  ('facebook_group',    'https://www.facebook.com/share/g/1DnNmXyHPR/'),
  ('facebook_page',     'https://www.facebook.com/share/18jMzbCfXh/'),
  ('momo_name',         'VÕ PHAN TRUNG HIẾU'),
  ('momo_stk',          ''),
  ('tpbank_name',       'VO PHAN TRUNG HIEU'),
  ('tpbank_stk',        '01577578410'),
  ('deposit_bonus_pct', '10'),
  ('sepay_webhook_token', ''),
  ('acc_prefix',        'SHOPMEBU')
ON DUPLICATE KEY UPDATE `key`=`key`;

-- ===== NOTIFICATIONS =====
CREATE TABLE IF NOT EXISTS notifications (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  user_id    INT          NOT NULL,
  type       ENUM('order','deposit','system','promo') DEFAULT 'system',
  title      VARCHAR(200) NOT NULL,
  message    TEXT,
  link       VARCHAR(500) DEFAULT NULL,
  is_read    TINYINT(1)   DEFAULT 0,
  created_at DATETIME     DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Nếu nâng cấp từ DB cũ, đối chiếu các cột ở trên và chạy migration thủ công trước khi mở bán.
