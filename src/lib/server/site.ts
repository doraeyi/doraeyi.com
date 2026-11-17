import QRCode from 'qrcode';
import type { GithubData, Health, Keeper, LiveData, Project, SiteData } from '#lib/types.js';
import { getHealth, getPresence, getProfile, getProjectMeta, getPushes, getShots, getVmProjects, type ProjectMeta } from './db.js';
import { fallbackProfile, fallbackProjects } from './fallback.js';
import { fetchGithub, GITHUB_LOGIN } from './github.js';
import { checkIfDue, nextCheckAt, type Target } from './health.js';
import { buildLive, PUSH_TTL, WAITING_TTL } from './live.js';
import { captureAll, SHOT_EVERY } from './shots.js';
import { fetchVercelProjects, hasVercel, type BaseProject } from './vercel.js';

type Unchecked = Omit<Project, 'health' | 'asleep' | 'shot'>;
interface Base {
	profile: SiteData['profile'];
	projects: Unchecked[];
	source: { vercel: boolean; database: boolean };
}

/** 小快取：過期才重抓，同時間的請求共用同一次抓取 */
function cached<T>(ttl: number, load: () => Promise<T>) {
	let entry: { at: number; data: Promise<T> } | null = null;
	return () => {
		if (!entry || Date.now() - entry.at > ttl) entry = { at: Date.now(), data: load() };
		return entry.data;
	};
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

function applyMeta(p: BaseProject, m: ProjectMeta | undefined): BaseProject {
	return {
		...p,
		title: m?.title || p.title,
		description: m?.description || p.description,
		tags: m?.tags ?? p.tags,
		url: m?.url || p.url,
		repo: m?.repo || p.repo,
		featured: m?.featured ?? p.featured,
		accent: m?.accent || p.accent
	};
}

// 同一間房間裡輪流分配，保證機器人、貓、狗都會出現
const KEEPERS: Keeper[] = ['robot', 'cat', 'dog'];

/**
 * 公司的專案：工作室裡固定一張桌子，名稱、程式、網址都不公開。
 * 電腦上的 hook 在公司資料夾裡工作時只送 dir: 'work'（見 scripts/claude-presence.mjs），對到的就是這張桌子
 */
export const WORK_ID = 'work';
function workDesk(keeper: Keeper): Unchecked {
	return {
		key: `work:${WORK_ID}`,
		id: WORK_ID,
		host: 'vercel',
		title: '公司的專案',
		description: '上班時用 Claude 寫的公司專案。名稱跟程式都不公開，這裡只看得到員工有沒有在忙。',
		url: null,
		repo: null,
		framework: null,
		tags: ['上班'],
		featured: false,
		accent: '',
		createdAt: 0,
		updatedAt: 0,
		lastDeployAt: null,
		state: 'UNKNOWN',
		keeper
	};
}

const loadBase = cached<Base>(5 * 60 * 1000, async () => {
	const [profile, meta, vercel, vm] = await Promise.all([
		safe('讀取 profile', getProfile, null),
		safe('讀取 project_meta', getProjectMeta, new Map<string, ProjectMeta>()),
		hasVercel() ? safe('讀取 Vercel 專案', fetchVercelProjects, null) : null,
		safe('讀取 vm_project', getVmProjects, [])
	]);

	const vercelProjects: Unchecked[] = (vercel ?? fallbackProjects)
		.filter((p) => !meta.get(p.id)?.hidden)
		.map((p) => applyMeta(p, meta.get(p.id)))
		.sort((a, b) => {
			const oa = meta.get(a.id)?.sortOrder ?? 0;
			const ob = meta.get(b.id)?.sortOrder ?? 0;
			return Number(b.featured) - Number(a.featured) || oa - ob || (b.lastDeployAt ?? 0) - (a.lastDeployAt ?? 0);
		})
		.map((p, i) => ({ ...p, key: `vercel:${p.id}`, host: 'vercel', keeper: KEEPERS[i % 3] }));

	const vmProjects: Unchecked[] = vm.map((v, i) => ({
		key: `vm:${v.slug}`,
		id: v.slug,
		host: 'vm',
		title: v.title,
		description: v.description,
		url: v.url,
		repo: v.repo,
		framework: null,
		tags: v.tags,
		featured: false,
		accent: '',
		createdAt: 0,
		updatedAt: 0,
		lastDeployAt: null,
		state: 'UNKNOWN',
		keeper: KEEPERS[(i + 1) % 3]
	}));

	return {
		profile: profile ?? fallbackProfile,
		projects: [...vercelProjects, workDesk(KEEPERS[vercelProjects.length % 3]), ...vmProjects],
		source: { vercel: vercel !== null, database: profile !== null }
	};
});

/** GitHub 個人頁的 QR code，在伺服器算好，前端只負責排方塊 */
function githubQr(): SiteData['qr'] {
	const url = `https://github.com/${GITHUB_LOGIN}`;
	const { modules } = QRCode.create(url, { errorCorrectionLevel: 'M' });
	return { url, size: modules.size, bits: Array.from(modules.data, (b) => (b ? '1' : '0')).join('') };
}
const qr = githubQr();

const loadGithub = cached<GithubData | null>(30 * 60 * 1000, () => safe('讀取 GitHub', () => fetchGithub(), null));

/** 沒有網址的示範專案不檢查（管理員保持醒著） */
function targets(projects: Unchecked[]): Target[] {
	return projects.map((p) => ({
		key: p.key,
		url: p.url,
		brokenReason: p.state === 'ERROR' ? 'Vercel 部署失敗' : undefined
	}));
}

/** 網站正常、超過一天沒拍（或從來沒拍過）的專案，補拍首頁截圖 */
function shotsDue(projects: Unchecked[], h: Map<string, Health>, shots: Map<string, number>) {
	const now = Date.now();
	return projects
		.filter((p) => p.url && h.get(p.key)?.ok && now - (shots.get(p.key) ?? 0) >= SHOT_EVERY)
		.map((p) => ({ key: p.key, url: p.url! }));
}

export async function getSiteData(): Promise<SiteData> {
	const [base, github] = await Promise.all([loadBase(), loadGithub()]);
	const h = await safe('讀取 health', async () => getHealth(), new Map<string, Health>());
	const shots = await safe('讀取 screenshot', async () => getShots(), new Map<string, number>());

	// 有人進來時順便看一下是不是該巡房、該補拍截圖了，不等結果
	void checkIfDue(targets(base.projects), h);
	void captureAll(shotsDue(base.projects, h, shots));

	return {
		profile: base.profile,
		projects: base.projects.map((p) => {
			const ph = h.get(p.key) ?? null;
			const at = shots.get(p.key);
			return { ...p, health: ph, asleep: ph ? !ph.ok : false, shot: at ? `/shots/${encodeURIComponent(p.key)}?v=${at}` : null };
		}),
		github,
		nextCheckAt: nextCheckAt(h),
		qr,
		source: { ...base.source, github: github !== null }
	};
}

/** 管理員現在在做什麼：Claude 的工作狀態、最近的 push */
export async function getLive(): Promise<LiveData> {
	const base = await loadBase();
	const now = Date.now();
	return buildLive(
		base.projects,
		await safe('讀取 presence', async () => getPresence(now - WAITING_TTL), []),
		await safe('讀取 push', async () => getPushes(now - PUSH_TTL), []),
		now
	);
}

/** 伺服器啟動後每小時看一次有沒有該巡房的專案；沒人逛網站也會照時間檢查 */
export function startPatrol() {
	const tick = async () => {
		const base = await loadBase();
		await checkIfDue(targets(base.projects), await safe('讀取 health', async () => getHealth(), new Map<string, Health>()));
		// 巡完房再拍截圖，才知道哪些網站是正常的
		const h = await safe('讀取 health', async () => getHealth(), new Map<string, Health>());
		const shots = await safe('讀取 screenshot', async () => getShots(), new Map<string, number>());
		await captureAll(shotsDue(base.projects, h, shots));
	};
	void tick();
	setInterval(() => void tick(), 60 * 60 * 1000).unref();
}
