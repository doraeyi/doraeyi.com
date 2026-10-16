import type { ActivityDay, Profile, Project } from '#lib/types.js';

// 資料庫或 Vercel 還沒設定時用的內容，讓網站本身先跑得起來

export const fallbackProfile: Profile = {
	name: 'Doraeyi',
	handle: 'doraeyi',
	role: '全端開發者 · 產品實作者',
	tagline: '把想法做成每天真的會打開的東西。',
	bio: '我喜歡從一個小麻煩開始，把它做成一個完整的產品：從資料庫、API 到介面跟動畫都自己來。這裡是我目前上線中的作品。',
	location: 'Taiwan',
	email: '',
	avatarUrl: null,
	skills: ['TypeScript', 'Svelte', 'Next.js', 'React', 'Python', 'FastAPI', 'MySQL', 'Three.js', 'Vercel'],
	links: [{ label: 'GitHub', url: 'https://github.com/doraeyi' }]
};

const day = 864e5;
const now = Date.now();

const demo = (
	id: string,
	title: string,
	description: string,
	framework: string,
	tags: string[],
	ageDays: number,
	featured = false
): Project => ({
	id,
	title,
	description,
	url: null,
	repo: null,
	framework,
	tags,
	featured,
	accent: '',
	createdAt: now - ageDays * day,
	updatedAt: now - (ageDays % 9) * day,
	lastDeployAt: now - (ageDays % 9) * day,
	state: 'READY'
});

export const fallbackProjects: Project[] = [
	demo('yiwallet', 'YIWallet', '記帳 App：預算提醒、固定支出、朋友分帳、年度回顧，還能用 Siri 記一筆。', 'nextjs', ['記帳', 'PWA'], 220, true),
	demo('schemalens', 'SchemaLens', '把資料庫 schema 畫成可以拖拉的關聯圖，改 DSL 畫布就即時更新。', 'nextjs', ['資料庫', '視覺化'], 140, true),
	demo('authora', 'Authora', '示範資料，接上 Vercel 後會換成真正的專案。', 'vite', ['示範'], 90),
	demo('taifex-journal', 'Taifex Journal', '示範資料，接上 Vercel 後會換成真正的專案。', 'nextjs', ['示範'], 60),
	demo('blog', 'Blog', '示範資料，接上 Vercel 後會換成真正的專案。', 'astro', ['示範'], 30)
];

/** 假的部署熱度圖，讓格子在沒資料時也有畫面 */
export function fallbackActivity(): ActivityDay[] {
	const out: ActivityDay[] = [];
	let seed = 7;
	const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	for (let i = 0; i < 365; i++) {
		const r = rand();
		const count = r > 0.55 ? Math.floor(rand() * (r > 0.9 ? 9 : 4)) + 1 : 0;
		if (count) out.push({ date: new Date(now - i * day).toISOString().slice(0, 10), count });
	}
	return out;
}
