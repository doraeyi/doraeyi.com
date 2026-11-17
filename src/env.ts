import { defineEnvVars } from '@sveltejs/kit/env';

const optional = (value: string | undefined) => (value ? value : undefined);

export const variables = defineEnvVars({
	VC_TOKEN: {
		schema: optional,
		description: 'Vercel 個人存取權杖（https://vercel.com/account/tokens），用來讀取上線中的專案'
	},
	VC_TEAM_ID: {
		schema: optional,
		description: '如果專案放在 Vercel Team 底下，填 team id（team_xxx），個人帳號留空'
	},
	PRESENCE_TOKEN: {
		schema: optional,
		description: '電腦上的 Claude Code 回報工作狀態用的密碼（scripts/claude-presence.mjs 帶著它打 /api/presence）；沒設就不收'
	},
	GITHUB_WEBHOOK_SECRET: {
		schema: optional,
		description: 'GitHub webhook 的 Secret，用來確認 /api/github 收到的 push 真的是 GitHub 送的；沒設就不收'
	},
	DATABASE_URL: {
		schema: optional,
		description: 'SQLite 資料庫檔案路徑，沒設就用 data/doraeyi.db（VM 上由 docker-compose 指到 /data/doraeyi.db）'
	}
});
