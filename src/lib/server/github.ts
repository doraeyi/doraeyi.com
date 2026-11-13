import type { ActivityDay, GithubData } from '#lib/types.js';

// GitHub 資料都是公開的，不需要 token：
//   提交格子：個人頁上那張綠色格子圖的 HTML（API 要 GraphQL + token 才拿得到）
//   個人資料、最近動態：REST API，未登入每小時 60 次，網站有快取所以夠用

export const GITHUB_LOGIN = 'doraeyi';
const UA = { 'User-Agent': 'doraeyi.com' };

async function get(url: string, accept?: string) {
	const res = await fetch(url, {
		headers: { ...UA, ...(accept ? { Accept: accept } : {}) },
		signal: AbortSignal.timeout(10_000)
	});
	if (!res.ok) throw new Error(`GitHub ${res.status}: ${url}`);
	return res;
}

/** 從格子圖的 HTML 抓每天的提交數：格子有 data-date，數字寫在對應的 tool-tip 裡 */
async function fetchDays(login: string): Promise<{ days: ActivityDay[]; total: number }> {
	const html = await (await get(`https://github.com/users/${login}/contributions`)).text();

	const dates = new Map<string, string>();
	for (const m of html.matchAll(/data-date="(\d{4}-\d{2}-\d{2})"[^>]*?id="([^"]+)"/g)) dates.set(m[2], m[1]);

	const days: ActivityDay[] = [];
	for (const m of html.matchAll(/<tool-tip[^>]*for="([^"]+)"[^>]*>([^<]*)<\/tool-tip>/g)) {
		const date = dates.get(m[1]);
		const n = /^(\d+) contribution/.exec(m[2]);
		if (date) days.push({ date, count: n ? Number(n[1]) : 0 });
	}
	if (!days.length) throw new Error('GitHub 格子圖的格式變了，抓不到資料');

	const total = /([\d,]+)\s+contributions?\s+in the last year/.exec(html);
	days.sort((a, b) => a.date.localeCompare(b.date));
	return { days, total: total ? Number(total[1].replace(/,/g, '')) : days.reduce((n, d) => n + d.count, 0) };
}

const KIND: Record<string, string> = {
	PushEvent: '推了程式碼',
	CreateEvent: '建立',
	PullRequestEvent: '發了 PR',
	IssuesEvent: '開了 issue',
	ReleaseEvent: '發布新版',
	WatchEvent: '收藏',
	ForkEvent: 'Fork'
};

export async function fetchGithub(login = GITHUB_LOGIN): Promise<GithubData> {
	const api = 'application/vnd.github+json';
	const [cal, user, events] = await Promise.all([
		fetchDays(login),
		get(`https://api.github.com/users/${login}`, api).then((r) => r.json() as Promise<{ public_repos: number; followers: number; html_url: string }>),
		get(`https://api.github.com/users/${login}/events/public?per_page=30`, api)
			.then((r) => r.json() as Promise<{ type: string; repo: { name: string }; created_at: string }[]>)
			.catch(() => [])
	]);

	return {
		login,
		url: user.html_url,
		days: cal.days,
		total: cal.total,
		publicRepos: user.public_repos,
		followers: user.followers,
		recent: events
			.filter((e) => e.type in KIND)
			.slice(0, 6)
			.map((e) => ({ repo: e.repo.name, kind: KIND[e.type], at: Date.parse(e.created_at) }))
	};
}
