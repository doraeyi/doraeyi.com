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
	DATABASE_URL: {
		schema: optional,
		description: 'MySQL 連線字串，例如 mysql://user:pass@liam.name404.com:13306/doraeyi'
	}
});
