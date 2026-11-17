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

-- 放在同事 VM 上跑的專案（Vercel 抓不到，所以手動登記）
-- 新增一列，網站上 VM 房間就會多一張桌子跟一位管理員
CREATE TABLE IF NOT EXISTS vm_project (
  slug         TEXT PRIMARY KEY,            -- 英數代號，例如 blog
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  url          TEXT NOT NULL,               -- 健康檢查會打這個網址
  repo         TEXT,
  tags         TEXT,                        -- JSON：["Astro", "部落格"]
  hidden       INTEGER NOT NULL DEFAULT 0,
  sort_order   INTEGER NOT NULL DEFAULT 0,
  updated_at   TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 健康檢查結果：管理員每 12 小時去看一次專案，掛了就會睡著
-- key 是 "vercel:<專案名>" 或 "vm:<slug>"
CREATE TABLE IF NOT EXISTS health (
  project_key  TEXT PRIMARY KEY,
  ok           INTEGER NOT NULL,            -- 1 = 正常
  status       INTEGER,                     -- HTTP 狀態碼；連不上是 NULL
  ms           INTEGER,                     -- 回應時間
  note         TEXT,                        -- 失敗原因
  checked_at   INTEGER NOT NULL,            -- 毫秒時間戳
  checks       INTEGER NOT NULL DEFAULT 0,  -- 累計檢查次數
  fails        INTEGER NOT NULL DEFAULT 0   -- 累計失敗次數，用來算妥善率
);

-- 各專案首頁的截圖（巡房時順便拍，檔案放在資料庫旁邊的 shots/ 資料夾）
CREATE TABLE IF NOT EXISTS screenshot (
  project_key  TEXT PRIMARY KEY,
  taken_at     INTEGER NOT NULL            -- 毫秒時間戳，也拿來當網址版本號
);

-- Claude 工作狀態：電腦上的 Claude Code 開工、做完一輪都會回報（scripts/claude-presence.mjs）
-- 一個 session 一列；太久沒回報就當作沒在做（src/lib/server/live.ts）
CREATE TABLE IF NOT EXISTS presence (
  session_id   TEXT PRIMARY KEY,
  repo         TEXT,                        -- git remote 的 owner/name（小寫），不是 git repo 就是 NULL
  dir          TEXT NOT NULL,               -- 資料夾名稱（小寫），對不到 repo 時拿來比專案代號
  state        TEXT NOT NULL,               -- working = 正在做；waiting = 做完了，等你回覆
  updated_at   INTEGER NOT NULL             -- 毫秒時間戳
);

-- GitHub webhook 收到的 push：管理員會跑去花園幫當天那棵樹澆水
-- 只留最近一天，舊的在寫入時順便刪掉
CREATE TABLE IF NOT EXISTS push (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  repo     TEXT NOT NULL,                   -- owner/name（小寫）
  commits  INTEGER NOT NULL,
  at       INTEGER NOT NULL                 -- 毫秒時間戳
);
