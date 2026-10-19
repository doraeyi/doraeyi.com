<div align="center">

# doraeyi.com

**會自己更新的個人作品集：自動列出 Vercel 上線中的專案與一年部署熱度圖**

![SvelteKit](https://img.shields.io/badge/SvelteKit-3-FF3E00?style=flat-square&logo=svelte&logoColor=white)
![Svelte](https://img.shields.io/badge/Svelte-5-FF3E00?style=flat-square&logo=svelte&logoColor=white)
![Three.js](https://img.shields.io/badge/Three.js-0.186-000000?style=flat-square&logo=threedotjs&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-mysql2-4479A1?style=flat-square&logo=mysql&logoColor=white)
![Vercel](https://img.shields.io/badge/Vercel-hosted-000000?style=flat-square&logo=vercel&logoColor=white)

</div>

---

## 📖 簡介

doraeyi.com 是我的個人網站。作品區不用手動維護：網站在伺服器端呼叫 Vercel API，只要專案有正式環境部署就會自動出現，並畫出一整年的部署熱度圖。自我介紹與每個專案的中文說明、標籤、主色則存在 MySQL，改資料庫網站就跟著變。

## ✨ 功能特色

- 🚀 **自動作品清單**：讀取 Vercel 上有 production 部署的專案，優先顯示自訂網域
- 🟩 **部署熱度圖**：一年內每天的部署次數，類似 GitHub contribution
- 🗂️ **專案補充資訊**：中文名稱、介紹、標籤、主色，可設 `hidden` 隱藏或 `featured` 放大
- 🌌 **Three.js 背景場景**
- 🧪 **沒設定也能跑**：缺環境變數時自動使用示範資料
- ⚡ **伺服器快取 5 分鐘**，減少 API 呼叫

## 🏗️ 系統架構

```mermaid
flowchart LR
    Visitor["訪客"] --> Page["SvelteKit 頁面<br/>Vercel"]
    Page --> Load["+page.server.ts<br/>快取 5 分鐘"]
    Load -- "VC_TOKEN" --> VercelAPI["Vercel API<br/>專案 & 部署紀錄"]
    Load -- "DATABASE_URL" --> DB[("MySQL<br/>profile / project_meta")]
    Load -. 未設定時 .-> Fallback["示範資料"]
```

## 🧰 技術棧

| 類別 | 技術 |
| --- | --- |
| 框架 | SvelteKit 3、Svelte 5、TypeScript、Vite |
| 視覺 | Three.js |
| 資料 | Vercel REST API、MySQL（mysql2） |
| 部署 | Vercel（`@sveltejs/adapter-vercel`） |

## 📂 專案結構

```text
doraeyi/
├── src/
│   ├── routes/
│   │   ├── +page.server.ts     # 取 Vercel 與資料庫資料
│   │   └── +page.svelte
│   └── lib/
│       ├── components/         # Scene（Three.js）、ProjectCard、Activity（熱度圖）
│       └── server/             # vercel.ts、db.ts、site.ts、fallback.ts
├── db/schema.sql               # profile、project_meta 資料表
└── static/
```

## 🚀 快速開始

```bash
pnpm install
cp .env.example .env   # 不填也能跑，會用示範資料
pnpm dev
```

## ⚙️ 環境變數

| 變數 | 說明 |
| --- | --- |
| `VC_TOKEN` | 到 <https://vercel.com/account/tokens> 建立，用來讀取專案清單與部署紀錄 |
| `VC_TEAM_ID` | 專案放在 Team 底下才需要 |
| `DATABASE_URL` | `mysql://user:pass@host:port/doraeyi` |

> 變數名稱不能用 `VERCEL_` 開頭（Vercel 保留給系統變數），所以這裡用 `VC_`。

## 🗄️ 資料表

| 資料表 | 用途 |
| --- | --- |
| `profile` | 名字、介紹、技能、連結 |
| `project_meta` | 以 Vercel 專案名稱為 key，補中文名稱、介紹、標籤、主色、`hidden`、`featured` |

```sql
INSERT INTO project_meta (vercel_name, title, description, tags, featured)
VALUES ('yiwallet', 'YIWallet', '記帳 App……', JSON_ARRAY('記帳', 'PWA'), TRUE);
```

## 🚢 部署

在 Vercel 匯入這個 repo，設定上面的環境變數，再把 `doraeyi.com` 綁到這個專案。
