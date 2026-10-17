import { VC_TEAM_ID, VC_TOKEN } from '$app/env/private';
import type { ActivityDay, Project } from '#lib/types.js';

const API = 'https://api.vercel.com';

interface VercelProject {
	id: string;
	name: string;
	framework?: string | null;
	createdAt: number;
	updatedAt?: number;
	link?: { type?: string; org?: string; repo?: string; projectNamespace?: string; projectName?: string };
	targets?: {
		production?: { alias?: string[]; url?: string; readyState?: string; createdAt?: number };
	};
	latestDeployments?: { alias?: string[]; url?: string; readyState?: string; createdAt?: number; target?: string | null }[];
}

interface VercelDeployment {
	uid: string;
	name: string;
	created: number;
	state?: string;
	readyState?: string;
}

export const hasVercel = () => Boolean(VC_TOKEN);

async function call<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
	const url = new URL(path, API);
	for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
	if (VC_TEAM_ID) url.searchParams.set('teamId', VC_TEAM_ID);

	const res = await fetch(url, { headers: { Authorization: `Bearer ${VC_TOKEN}` } });
	if (!res.ok) throw new Error(`Vercel API ${res.status}: ${await res.text()}`);
	return res.json() as Promise<T>;
}

/** 自訂網域優先，其次才是 *.vercel.app */
function pickUrl(p: VercelProject): string | null {
	const prod = p.targets?.production ?? p.latestDeployments?.find((d) => d.target === 'production');
	const aliases = prod?.alias ?? [];
	const host =
		aliases.find((a) => !a.endsWith('.vercel.app')) ??
		aliases.sort((a, b) => a.length - b.length)[0] ??
		prod?.url;
	return host ? `https://${host}` : null;
}

function pickRepo(p: VercelProject): string | null {
	const l = p.link;
	if (!l?.repo) return null;
	if (l.type === 'github') return `https://github.com/${l.org}/${l.repo}`;
	if (l.type === 'gitlab') return `https://gitlab.com/${l.projectNamespace}/${l.projectName}`;
	return null;
}

export async function fetchVercelProjects(): Promise<Project[]> {
	const all: VercelProject[] = [];
	let until: number | undefined;
	do {
		const page = await call<{ projects: VercelProject[]; pagination?: { next: number | null } }>(
			'/v10/projects',
			{ limit: 100, ...(until ? { until } : {}) }
		);
		all.push(...page.projects);
		until = page.pagination?.next ?? undefined;
	} while (until);

	return all
		.filter((p) => p.targets?.production) // 只顯示有正式上線的
		.map((p) => {
			const prod = p.targets!.production!;
			return {
				id: p.name,
				title: p.name,
				description: '',
				url: pickUrl(p),
				repo: pickRepo(p),
				framework: p.framework ?? null,
				tags: [],
				featured: false,
				accent: '',
				createdAt: p.createdAt,
				updatedAt: p.updatedAt ?? p.createdAt,
				lastDeployAt: prod.createdAt ?? null,
				state: (prod.readyState as Project['state']) ?? 'UNKNOWN'
			};
		});
}

/** 過去一年的正式部署次數（像 GitHub 的貢獻格子） */
export async function fetchDeployActivity(): Promise<ActivityDay[]> {
	const since = Date.now() - 365 * 864e5;
	const counts = new Map<string, number>();
	let until: number | undefined;

	// 最多翻 20 頁 = 2000 次部署，避免帳號很大時拖太久
	for (let i = 0; i < 20; i++) {
		const page = await call<{ deployments: VercelDeployment[]; pagination?: { next: number | null } }>(
			'/v6/deployments',
			{ limit: 100, since, ...(until ? { until } : {}) }
		);
		for (const d of page.deployments) {
			const day = new Date(d.created).toISOString().slice(0, 10);
			counts.set(day, (counts.get(day) ?? 0) + 1);
		}
		until = page.pagination?.next ?? undefined;
		if (!until || until < since) break;
	}

	return [...counts].map(([date, count]) => ({ date, count }));
}
