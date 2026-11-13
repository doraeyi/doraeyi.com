import { VC_TEAM_ID, VC_TOKEN } from '$app/env/private';
import type { Project } from '#lib/types.js';

/** 從各來源抓回來、還沒加上主機、管理員、健康狀態的專案 */
export type BaseProject = Omit<Project, 'key' | 'host' | 'keeper' | 'health' | 'asleep' | 'shot'>;

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

export async function fetchVercelProjects(): Promise<BaseProject[]> {
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
