import type { Profile } from '#lib/types.js';
import type { VmProject } from './db.js';
import type { BaseProject } from './vercel.js';

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
): BaseProject => ({
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

export const fallbackProjects: BaseProject[] = [
	demo('yiwallet', 'YIWallet', '記帳 App：預算提醒、固定支出、朋友分帳、年度回顧，還能用 Siri 記一筆。', 'nextjs', ['記帳', 'PWA'], 220, true),
	demo('schemalens', 'SchemaLens', '把資料庫 schema 畫成可以拖拉的關聯圖，改 DSL 畫布就即時更新。', 'nextjs', ['資料庫', '視覺化'], 140, true),
	demo('authora', 'Authora', '示範資料，接上 Vercel 後會換成真正的專案。', 'vite', ['示範'], 90),
	demo('taifex-journal', 'Taifex Journal', '示範資料，接上 Vercel 後會換成真正的專案。', 'nextjs', ['示範'], 60),
	demo('blog', 'Blog', '示範資料，接上 Vercel 後會換成真正的專案。', 'astro', ['示範'], 30)
];

/** VM 上一開始就有的專案；第一次建資料庫時寫進 vm_project 表，之後在表裡改就好 */
export const fallbackVmProjects: VmProject[] = [
	{
		slug: 'blog',
		title: 'Blog',
		description: '我的部落格：技術筆記跟心情短文，用 Claude 幫忙整理草稿，後台審過才發布。',
		url: 'https://blog.doraeyi.com',
		repo: null,
		tags: ['部落格', 'SQLite'],
		sortOrder: 0
	},
	{
		slug: 'doraeyi-site',
		title: 'doraeyi.com',
		description: '就是你現在看的這個網站：兩間 3D 房間，每個專案都有一位管理員顧著。',
		url: 'https://doraeyi.com',
		repo: 'https://github.com/doraeyi/doraeyi.com',
		tags: ['Svelte', 'Three.js'],
		sortOrder: 1
	}
];
