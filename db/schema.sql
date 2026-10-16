-- doraeyi.com 資料庫
-- 在 liam.name404.com 的 MySQL 上執行：
--   mysql -h liam.name404.com -P 13306 -u <user> -p < db/schema.sql

CREATE DATABASE IF NOT EXISTS doraeyi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE doraeyi;

-- 個人資料，只會有 id = 1 這一列
CREATE TABLE IF NOT EXISTS profile (
  id          TINYINT UNSIGNED PRIMARY KEY DEFAULT 1,
  name        VARCHAR(80)   NOT NULL,
  handle      VARCHAR(80)   NOT NULL,
  role        VARCHAR(120)  NOT NULL,
  tagline     VARCHAR(255)  NOT NULL,
  bio         TEXT          NOT NULL,
  location    VARCHAR(80)   NOT NULL DEFAULT '',
  email       VARCHAR(160)  NOT NULL DEFAULT '',
  avatar_url  VARCHAR(500)  NULL,
  skills      JSON          NOT NULL,   -- ["Svelte", "Python", ...]
  links       JSON          NOT NULL,   -- [{"label":"GitHub","url":"https://..."}]
  updated_at  TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT profile_single_row CHECK (id = 1)
);

-- 每個 Vercel 專案的補充說明（key = Vercel 上的專案名稱）
-- 沒有在這張表的專案也會顯示，只是用 Vercel 上的名字、沒有介紹
CREATE TABLE IF NOT EXISTS project_meta (
  vercel_name  VARCHAR(100) PRIMARY KEY,
  title        VARCHAR(120) NULL,          -- 顯示名稱，留空就用 vercel_name
  description  TEXT         NULL,
  tags         JSON         NULL,          -- ["記帳", "PWA"]
  url          VARCHAR(500) NULL,          -- 覆寫 Vercel 抓到的網址
  repo         VARCHAR(500) NULL,
  accent       VARCHAR(16)  NULL,          -- 卡片主色，例如 #7c5cff
  featured     BOOLEAN      NOT NULL DEFAULT FALSE,
  hidden       BOOLEAN      NOT NULL DEFAULT FALSE,  -- 不想公開的專案設 TRUE
  sort_order   INT          NOT NULL DEFAULT 0,      -- 越小越前面
  updated_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO profile (id, name, handle, role, tagline, bio, location, email, skills, links)
VALUES (
  1,
  'Doraeyi',
  'doraeyi',
  '全端開發者 · 產品實作者',
  '把想法做成每天真的會打開的東西。',
  '我喜歡從一個小麻煩開始，把它做成一個完整的產品：從資料庫、API 到介面跟動畫都自己來。這裡是我目前上線中的作品。',
  'Taiwan',
  '',
  JSON_ARRAY('TypeScript', 'Svelte', 'Next.js', 'React', 'Python', 'FastAPI', 'MySQL', 'Three.js', 'Vercel'),
  JSON_ARRAY(JSON_OBJECT('label', 'GitHub', 'url', 'https://github.com/doraeyi'))
)
ON DUPLICATE KEY UPDATE id = id;
