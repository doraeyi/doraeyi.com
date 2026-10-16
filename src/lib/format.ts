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
