export interface Profile {
	name: string;
	handle: string;
	role: string;
	tagline: string;
	bio: string;
	location: string;
	email: string;
	avatarUrl: string | null;
	skills: string[];
	links: { label: string; url: string }[];
}

/** 管理員最近一次去看專案的結果 */
export interface Health {
	ok: boolean;
	status: number | null;
	ms: number | null;
	/** 失敗原因，例如「逾時」「HTTP 502」 */
	note: string | null;
	checkedAt: number;
	/** 累計妥善率 0–1 */
	uptime: number;
}

export type Host = 'vercel' | 'vm';

/** 每位管理員的長相，依專案名稱固定分配 */
export type Keeper = 'robot' | 'cat' | 'dog';

export interface Project {
	/** "vercel:<專案名>" 或 "vm:<slug>"，也是 health 表的 key */
	key: string;
	/** Vercel 專案名稱或 VM 專案的 slug，也是 project_meta 表的 key */
	id: string;
	host: Host;
	title: string;
	description: string;
	url: string | null;
	repo: string | null;
	framework: string | null;
	tags: string[];
	featured: boolean;
	accent: string;
	createdAt: number;
	updatedAt: number;
	lastDeployAt: number | null;
	state: 'READY' | 'BUILDING' | 'ERROR' | 'QUEUED' | 'CANCELED' | 'UNKNOWN';
	keeper: Keeper;
	/** 還沒檢查過是 null */
	health: Health | null;
	/** 管理員睡著了 = 最近一次檢查失敗 */
	asleep: boolean;
	/** 首頁截圖的網址（/shots/...），還沒拍過是 null */
	shot: string | null;
}

export interface ActivityDay {
	/** YYYY-MM-DD */
	date: string;
	count: number;
}

export interface GithubData {
	login: string;
	url: string;
	/** 過去一年的提交格子 */
	days: ActivityDay[];
	total: number;
	publicRepos: number;
	followers: number;
	/** 最近的公開動態 */
	recent: { repo: string; kind: string; at: number }[];
}

export interface SiteData {
	profile: Profile;
	projects: Project[];
	github: GithubData | null;
	/** 下一次例行檢查的時間 */
	nextCheckAt: number;
	/** 往下拉會變出來的 QR code：size × size 格，bits 是一串 0/1 */
	qr: { url: string; size: number; bits: string };
	source: { vercel: boolean; database: boolean; github: boolean };
}

export type DeskState = 'working' | 'waiting';

/**
 * 一次 push 從開始到部署完成，管理員這段時間都在花園澆水：
 *   pushing：Claude 開始 git push，GitHub 還沒收到；deploying：GitHub 收到了，等 GitHub Actions 跑完；done：澆完了
 */
export interface Watering {
	id: number;
	key: string | null;
	repo: string;
	commits: number;
	phase: 'pushing' | 'deploying' | 'done';
	/** false：push 沒送上去，或部署失敗 */
	ok: boolean;
	startedAt: number;
}

/** 即時狀態：前端每隔一陣子來問一次（/api/live） */
export interface LiveData {
	/** 專案 key → 那位管理員現在的狀態；不在裡面的就是閒著 */
	desks: Record<string, DeskState>;
	/** 正在澆水（跟剛澆完）的 push。id 只會變大；key 是 null 代表網站上沒有這個專案 */
	waterings: Watering[];
	at: number;
}
