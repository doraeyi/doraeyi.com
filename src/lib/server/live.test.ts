import { describe, expect, it } from 'vitest';
import { buildLive, matchDesks, repoSlug, WAITING_TTL, WORKING_TTL } from './live.js';

const matchDesk = (...a: Parameters<typeof matchDesks>) => matchDesks(...a)[0] ?? null;

const desks = [
	{ key: 'vercel:yiwallet', id: 'yiwallet', repo: 'https://github.com/doraeyi/YIWallet', url: null },
	{ key: 'vercel:yiwallet-tools', id: 'yiwallet-tools', repo: 'https://github.com/doraeyi/YIWallet', url: null },
	{ key: 'vm:site', id: 'site', repo: 'https://github.com/doraeyi/doraeyi.com', url: null },
	{ key: 'vm:blog', id: 'blog', repo: null, url: 'https://blog.doraeyi.com' },
	{ key: 'vm:home', id: 'home', repo: null, url: 'https://www.home.dev' },
	{ key: 'work:work', id: 'work', repo: null, url: null }
];

describe('對到哪一張桌子', () => {
	it('各種 git remote 寫法都變成小寫的 owner/name', () => {
		expect(repoSlug('https://github.com/Doraeyi/YIWallet.git')).toBe('doraeyi/yiwallet');
		expect(repoSlug('git@github.com:doraeyi/doraeyi.com.git')).toBe('doraeyi/doraeyi.com');
		expect(repoSlug('https://gitlab.com/a/b')).toBeNull();
	});

	it('先比 repo，沒有 repo 的專案拿資料夾名稱比代號', () => {
		expect(matchDesk(desks, 'doraeyi/doraeyi.com', 'whatever')).toBe('vm:site');
		expect(matchDesk(desks, null, 'Blog')).toBe('vm:blog');
		expect(matchDesk(desks, 'someone/else', 'nope')).toBeNull();
	});

	it('公司的專案只送 work，對到工作室那張不公開的桌子', () => {
		expect(matchDesks(desks, null, 'work')).toEqual(['work:work']);
	});

	it('monorepo 拆成好幾個專案，每一張桌子都算', () => {
		expect(matchDesks(desks, 'doraeyi/yiwallet', 'YIWallet')).toEqual(['vercel:yiwallet', 'vercel:yiwallet-tools']);
	});

	it('沒填 repo 的專案，repo 名稱跟網站網域一樣也算', () => {
		expect(matchDesk(desks, 'doraeyi/home.dev', 'home-site')).toBe('vm:home');
		expect(matchDesk(desks, 'doraeyi/blog.doraeyi.com')).toBe('vm:blog');
	});
});

describe('即時狀態', () => {
	const now = 10 * 3600 * 1000;
	const row = (dir: string, state: 'working' | 'waiting', ago: number) => ({ repo: null, dir, state, updated_at: now - ago });

	it('做事中太久沒回報變成等待，再更久就消失', () => {
		const live = buildLive(desks, [row('blog', 'working', WORKING_TTL + 1), row('site', 'waiting', WAITING_TTL + 1)], [], now);
		expect(live.desks).toEqual({ 'vm:blog': 'waiting' });
	});

	it('同一個專案有一個 session 在做事就算在做事', () => {
		const live = buildLive(desks, [row('blog', 'working', 0), row('blog', 'waiting', 0)], [], now);
		expect(live.desks['vm:blog']).toBe('working');
	});

	it('澆水的進度：還沒收到 → 等部署 → 澆完，並標上是哪一張桌子', () => {
		const base = { sha: null, commits: 0, runs: '[]', saw_run: 0, ok: 1, pushed_at: null, done_at: null, started_at: now };
		const live = buildLive(
			desks,
			[],
			[
				{ ...base, id: 1, repo: 'doraeyi/yiwallet' },
				{ ...base, id: 2, repo: 'doraeyi/doraeyi.com', commits: 2, pushed_at: now },
				{ ...base, id: 3, repo: 'someone/else', commits: 1, pushed_at: now, done_at: now, ok: 0 }
			],
			now
		);
		expect(live.waterings.map((w) => [w.key, w.phase, w.ok])).toEqual([
			['vercel:yiwallet', 'pushing', true],
			['vm:site', 'deploying', true],
			[null, 'done', false]
		]);
	});
});
