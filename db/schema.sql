-- doraeyi.com 資料庫（SQLite）
-- 伺服器啟動時會自動執行這份檔案（src/lib/server/db.ts），不用手動跑。
-- 資料庫檔案位置由 DATABASE_URL 決定，VM 上是 ./data/doraeyi.db。

-- 個人資料，只會有 id = 1 這一列；第一次啟動會放入 src/lib/server/fallback.ts 的預設值
CREATE TABLE IF NOT EXISTS profile (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  name        TEXT NOT NULL,
  handle      TEXT NOT NULL,
  role        TEXT NOT NULL,
  tagline     TEXT NOT NULL,
  bio         TEXT NOT NULL,
  location    TEXT NOT NULL DEFAULT '',
  email       TEXT NOT NULL DEFAULT '',
  avatar_url  TEXT,
  skills      TEXT NOT NULL DEFAULT '[]',   -- JSON：["Svelte", "Python", ...]
  links       TEXT NOT NULL DEFAULT '[]',   -- JSON：[{"label":"GitHub","url":"https://..."}]
  updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 每個 Vercel 專案的補充說明（key = Vercel 上的專案名稱）
-- 沒有在這張表的專案也會顯示，只是用 Vercel 上的名字、沒有介紹
CREATE TABLE IF NOT EXISTS project_meta (
  vercel_name  TEXT PRIMARY KEY,
  title        TEXT,                        -- 顯示名稱，留空就用 vercel_name
  description  TEXT,
  tags         TEXT,                        -- JSON：["記帳", "PWA"]
  url          TEXT,                        -- 覆寫 Vercel 抓到的網址
  repo         TEXT,
  accent       TEXT,                        -- 卡片主色，例如 #7c5cff；留空就用色階
  featured     INTEGER NOT NULL DEFAULT 0,  -- 1 = 放大顯示
  hidden       INTEGER NOT NULL DEFAULT 0,  -- 1 = 不公開
  sort_order   INTEGER NOT NULL DEFAULT 0,  -- 越小越前面
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
