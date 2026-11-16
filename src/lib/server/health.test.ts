import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Health } from '#lib/types.js';

const saved: { key: string; ok: boolean; note: string | null }[] = [];
vi.mock('./db.js', () => ({ saveHealth: (key: string, h: Health) => saved.push({ key, ok: h.ok, note: h.note }) }));

const { CHECK_EVERY, checkIfDue, nextCheckAt, probe } = await import('./health.js');

function respond(status: number) {
	vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status })));
}

beforeEach(() => {
	saved.length = 0;
	vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('probe：只有 5xx、逾時、連不上才算掛', () => {
	it.each([200, 301, 401, 404, 499])('HTTP %i 算正常', async (status) => {
		respond(status);
		expect(await probe('https://example.com')).toMatchObject({ ok: true, status, note: null });
	});

	it.each([500, 502, 503])('HTTP %i 算掛掉', async (status) => {
		respond(status);
		expect(await probe('https://example.com')).toMatchObject({ ok: false, status, note: `HTTP ${status}` });
	});

	it('逾時', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new DOMException('timeout', 'TimeoutError'))));
		expect(await probe('https://example.com')).toEqual({ ok: false, status: null, ms: null, note: '15 秒沒回應' });
	});

	it('連不上', async () => {
		vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('fetch failed'))));
		expect(await probe('https://example.com')).toEqual({ ok: false, status: null, ms: null, note: '連不上' });
	});
});

describe('checkIfDue', () => {
	const fresh = (checkedAt: number): Health => ({ ok: true, status: 200, ms: 10, note: null, checkedAt, uptime: 1 });

	it('只檢查超過 12 小時或沒檢查過的專案；Vercel 回報壞掉的不用打網址', async () => {
		respond(200);
		const now = Date.now();
		const health = new Map([
			['a', fresh(now)],
			['b', fresh(now - CHECK_EVERY)]
		]);
		await checkIfDue(
			[
				{ key: 'a', url: 'https://a.test' },
				{ key: 'b', url: 'https://b.test' },
				{ key: 'c', url: null, brokenReason: '部署失敗' },
				{ key: 'd', url: null }
			],
			health
		);
		expect(saved.sort((x, y) => x.key.localeCompare(y.key))).toEqual([
			{ key: 'b', ok: true, note: null },
			{ key: 'c', ok: false, note: '部署失敗' }
		]);
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('都還沒到期就不跑', () => {
		respond(200);
		expect(checkIfDue([{ key: 'a', url: 'https://a.test' }], new Map([['a', fresh(Date.now())]]))).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it('nextCheckAt 取最早到期的那個', () => {
		const health = new Map([
			['a', fresh(1_000)],
			['b', fresh(500)]
		]);
		expect(nextCheckAt(health)).toBe(500 + CHECK_EVERY);
	});
});
