-- =====================================================================
-- TrackDesk - Veritabani Semasi
-- Idempotent: CREATE TABLE IF NOT EXISTS - tekrar calistirmak guvenli.
-- Kurulum: phpMyAdmin'de "trackdesk" DB olustur, bu dosyayi calistir.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS `trackdesk`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE `trackdesk`;

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  full_name     VARCHAR(190) NOT NULL,
  username      VARCHAR(100) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(30) NOT NULL DEFAULT 'admin',
  is_active     TINYINT(1) NOT NULL DEFAULT 1,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name           VARCHAR(190) NOT NULL,
  contact_person VARCHAR(190) NULL,
  phone          VARCHAR(60)  NULL,
  tax_number     VARCHAR(60)  NULL,
  address        TEXT NULL,
  note           TEXT NULL,
  is_active      TINYINT(1) NOT NULL DEFAULT 1,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customers_name (name)
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_brands (
  id         INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(190) NOT NULL,
  is_active  TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS catalog_products (
  id                 INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  brand_id           INT UNSIGNED NOT NULL,
  name               VARCHAR(190) NOT NULL,
  default_unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active          TINYINT(1) NOT NULL DEFAULT 1,
  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_products_brand (brand_id),
  CONSTRAINT fk_products_brand FOREIGN KEY (brand_id)
    REFERENCES catalog_brands(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transactions (
  id               INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id      INT UNSIGNED NOT NULL,
  transaction_date DATE NOT NULL,
  stage            VARCHAR(20) NOT NULL DEFAULT 'created',
  total_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_due_date DATE NULL,
  note             TEXT NULL,
  created_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_tx_customer (customer_id),
  INDEX idx_tx_date (transaction_date),
  CONSTRAINT fk_tx_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS transaction_items (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id INT UNSIGNED NOT NULL,
  product_id     INT UNSIGNED NULL,
  product_label  VARCHAR(255) NOT NULL,
  quantity       INT NOT NULL DEFAULT 0,
  unit_price     DECIMAL(12,2) NOT NULL DEFAULT 0,
  line_total     DECIMAL(12,2) NOT NULL DEFAULT 0,
  INDEX idx_items_tx (transaction_id),
  CONSTRAINT fk_items_tx FOREIGN KEY (transaction_id)
    REFERENCES transactions(id) ON DELETE CASCADE,
  CONSTRAINT fk_items_product FOREIGN KEY (product_id)
    REFERENCES catalog_products(id) ON DELETE SET NULL
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS collections (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  transaction_id  INT UNSIGNED NOT NULL,
  collection_date DATE NOT NULL,
  amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  note            TEXT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_col_tx (transaction_id),
  CONSTRAINT fk_col_tx FOREIGN KEY (transaction_id)
    REFERENCES transactions(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rollovers (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  source_year SMALLINT NOT NULL,
  target_year SMALLINT NOT NULL,
  amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  note        TEXT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_roll_customer (customer_id),
  CONSTRAINT fk_roll_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS rollover_collections (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rollover_id     INT UNSIGNED NOT NULL,
  collection_date DATE NOT NULL,
  amount          DECIMAL(12,2) NOT NULL DEFAULT 0,
  note            TEXT NULL,
  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_rollcol_roll (rollover_id),
  CONSTRAINT fk_rollcol_roll FOREIGN KEY (rollover_id)
    REFERENCES rollovers(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_ledger_entries (
  id          INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  customer_id INT UNSIGNED NOT NULL,
  entry_type  ENUM('payment','debt') NOT NULL,
  amount      DECIMAL(12,2) NOT NULL DEFAULT 0,
  entry_date  DATE NOT NULL,
  note        TEXT NULL,
  created_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_ledger_customer (customer_id),
  INDEX idx_ledger_date (entry_date),
  CONSTRAINT fk_ledger_customer FOREIGN KEY (customer_id)
    REFERENCES customers(id) ON DELETE CASCADE
) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
