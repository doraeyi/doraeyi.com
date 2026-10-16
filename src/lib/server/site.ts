import type { Project, SiteData } from '#lib/types.js';
import { getProfile, getProjectMeta, hasDatabase, type ProjectMeta } from './db.js';
import { fallbackActivity, fallbackProfile, fallbackProjects } from './fallback.js';
import { fetchDeployActivity, fetchVercelProjects, hasVercel } from './vercel.js';

const TTL = 5 * 60 * 1000;
let cache: { at: number; data: Promise<SiteData> } | null = null;

const PALETTE = ['#7c5cff', '#00d1ff', '#ff4fa3', '#ffb020', '#3ddc97', '#ff6b4a', '#4f7bff'];

function hashColor(s: string) {
	let h = 0;
	for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
	return PALETTE[Math.abs(h) % PALETTE.length];
}

/** 失敗時記 log 回傳 fallback，一個來源掛掉不會拖垮整頁 */
async function safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> {
	try {
		return await fn();
	} catch (err) {
		console.error(`[site] ${label} 失敗：`, err instanceof Error ? err.message : err);
		return fallback;
	}
}

function applyMeta(p: Project, m: ProjectMeta | undefined): Project {
	return {
		...p,
		title: m?.title || p.title,
		description: m?.description || p.description,
		tags: m?.tags ?? p.tags,
		url: m?.url || p.url,
		repo: m?.repo || p.repo,
		featured: m?.featured ?? p.featured,
		accent: m?.accent || p.accent || hashColor(p.id)
	};
}

async function load(): Promise<SiteData> {
	const vercel = hasVercel();
	const database = hasDatabase();

	const [profile, meta, projects, activity] = await Promise.all([
		database ? safe('讀取 profile', getProfile, null) : null,
		database ? safe('讀取 project_meta', getProjectMeta, new Map<string, ProjectMeta>()) : new Map<string, ProjectMeta>(),
		vercel ? safe('讀取 Vercel 專案', fetchVercelProjects, null) : null,
		vercel ? safe('讀取 Vercel 部署', fetchDeployActivity, null) : null
	]);

	const merged = (projects ?? fallbackProjects)
		.filter((p) => !meta.get(p.id)?.hidden)
		.map((p) => applyMeta(p, meta.get(p.id)))
		.sort((a, b) => {
			const oa = meta.get(a.id)?.sortOrder ?? 0;
			const ob = meta.get(b.id)?.sortOrder ?? 0;
			return Number(b.featured) - Number(a.featured) || oa - ob || (b.lastDeployAt ?? 0) - (a.lastDeployAt ?? 0);
		});

	const days = activity ?? fallbackActivity();

	return {
		profile: profile ?? fallbackProfile,
		projects: merged,
		activity: days,
		totalDeploys: days.reduce((n, d) => n + d.count, 0),
		source: { vercel: projects !== null, database: profile !== null }
	};
}

export function getSiteData(): Promise<SiteData> {
	if (!cache || Date.now() - cache.at > TTL) {
		cache = { at: Date.now(), data: load() };
	}
	return cache.data;
}
