import type { Host, Project } from '#lib/types.js';

const FRAMEWORKS: Record<string, string> = {
	nextjs: 'Next.js',
	sveltekit: 'SvelteKit',
	'sveltekit-1': 'SvelteKit',
	svelte: 'Svelte',
	vite: 'Vite',
	astro: 'Astro',
	nuxtjs: 'Nuxt',
	remix: 'Remix',
	'create-react-app': 'React',
	vue: 'Vue',
	gatsby: 'Gatsby',
	hugo: 'Hugo',
	angular: 'Angular',
	fastapi: 'FastAPI',
	flask: 'Flask',
	express: 'Express',
	hono: 'Hono'
};

export const frameworkLabel = (f: string) => FRAMEWORKS[f] ?? f;

const rtf = new Intl.RelativeTimeFormat('zh-TW', { numeric: 'auto' });

export function timeAgo(ts: number) {
	const diff = (ts - Date.now()) / 1000;
	const units: [Intl.RelativeTimeFormatUnit, number][] = [
		['year', 31536000],
		['month', 2592000],
		['week', 604800],
		['day', 86400],
		['hour', 3600],
		['minute', 60]
	];
	for (const [unit, sec] of units) {
		if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
	}
	return '剛剛';
}

export const ROOMS: Record<Host, { name: string; blurb: string }> = {
	vercel: { name: '工作室', blurb: '部署在 Vercel 上的專案，清單直接從 Vercel 抓，上線新東西這裡就會多一張桌子。' },
	vm: { name: '機房', blurb: '跑在同事 VM 上的專案：Docker 容器、Traefik 轉網域，GitHub Actions 推上去自動部署。' }
};

/** 管理員現在的狀態：cls 給燈號跟狀態框配色用 */
export const projectStatus = (p: Project) =>
	p.asleep ? { cls: 'down', text: '睡著了' } : p.health ? { cls: 'up', text: '醒著值班中' } : { cls: 'idle', text: '等第一次巡房' };
