# doraeyi.com

個人作品集網站：自我介紹 + 自動列出 Vercel 上正在上線的專案 + 一年的部署熱度圖。

SvelteKit 3 · Svelte 5 · Three.js · MySQL（liam.name404.com）· 部署在 Vercel

## 本機開發

```bash
pnpm install
cp .env.example .env   # 填入下面三個值，不填也能跑（會用示範資料）
pnpm dev
```

## 環境變數

| 變數 | 用途 |
| --- | --- |
| `VC_TOKEN` | 到 https://vercel.com/account/tokens 建一個。網站用它讀取你的專案清單與部署紀錄 |
| `VC_TEAM_ID` | 專案放在 Team 底下才需要 |
| `DATABASE_URL` | `mysql://user:pass@liam.name404.com:13306/doraeyi` |

> 變數名稱不能用 `VERCEL_` 開頭，那是 Vercel 保留給系統變數的，所以這裡用 `VC_`。

## 資料從哪來

1. **Vercel API**：只要有正式環境（production）部署的專案都會出現，網址優先用自訂網域。
2. **MySQL**（`db/schema.sql`）：
   - `profile`：名字、介紹、技能、連結，改了網站就跟著變。
   - `project_meta`：用 Vercel 專案名稱當 key，補上中文名稱、介紹、標籤、主色，或設 `hidden = TRUE` 藏起來、`featured = TRUE` 放大顯示。

資料在伺服器快取 5 分鐘。

```sql
INSERT INTO project_meta (vercel_name, title, description, tags, featured)
VALUES ('yiwallet', 'YIWallet', '記帳 App……', JSON_ARRAY('記帳', 'PWA'), TRUE);
```

## 部署

在 Vercel 匯入這個 repo，設定上面的環境變數，再把 `doraeyi.com` 綁到這個專案。
