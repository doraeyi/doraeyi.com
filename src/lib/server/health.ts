import type { Health } from '#lib/types.js';
import { saveHealth } from './db.js';

// 管理員的例行巡房：每 12 小時把每個專案的網址打一次
// 回應 2xx / 3xx 算正常；4xx 也算有在跑（例如首頁要登入），只有 5xx、逾時、連不上才算掛掉

export const CHECK_EVERY = 12 * 60 * 60 * 1000;
const TIMEOUT = 15_000;

export interface Target {
	key: string;
	url: string | null;
	/** Vercel 自己回報部署失敗時，不用打網址也知道壞了 */
	brokenReason?: string;
}

export async function probe(url: string): Promise<Omit<Health, 'uptime' | 'checkedAt'>> {
	const started = performance.now();
	try {
		const res = await fetch(url, {
			redirect: 'follow',
			// 標頭只能放 ASCII，放中文 fetch 會直接丟錯
			headers: { 'User-Agent': 'doraeyi.com-patrol/1.0 (+https://doraeyi.com)' },
			signal: AbortSignal.timeout(TIMEOUT)
		});
		// 只要狀態碼，body 不讀，連線直接放掉
		void res.body?.cancel();
		const ms = Math.round(performance.now() - started);
		const ok = res.status < 500;
		return { ok, status: res.status, ms, note: ok ? null : `HTTP ${res.status}` };
	} catch (err) {
		const timeout = err instanceof Error && err.name === 'TimeoutError';
		if (!timeout) console.warn('[health]', url, err instanceof Error ? (err.cause ?? err.message) : err);
		return { ok: false, status: null, ms: null, note: timeout ? `${TIMEOUT / 1000} 秒沒回應` : '連不上' };
	}
}

export async function checkAll(targets: Target[]) {
	await Promise.all(
		targets.map(async (t) => {
			if (!t.url && !t.brokenReason) return;
			const result = t.brokenReason ? { ok: false, status: null, ms: null, note: t.brokenReason } : await probe(t.url!);
			saveHealth(t.key, { ...result, checkedAt: Date.now() });
		})
	);
}

let running: Promise<void> | null = null;

/** 同一時間只跑一輪；有專案超過 12 小時沒檢查（或從來沒檢查過）才跑 */
export function checkIfDue(targets: Target[], health: Map<string, Health>) {
	const now = Date.now();
	const due = targets.filter((t) => {
		const h = health.get(t.key);
		return !h || now - h.checkedAt >= CHECK_EVERY;
	});
	if (!due.length || running) return running;
	running = checkAll(due)
		.catch((err) => console.error('[health] 巡房失敗：', err))
		.finally(() => (running = null));
	return running;
}

/** 最早該重新檢查的時間，給畫面顯示「下次巡房」 */
export function nextCheckAt(health: Map<string, Health>) {
	const times = [...health.values()].map((h) => h.checkedAt + CHECK_EVERY);
	return times.length ? Math.min(...times) : Date.now();
}
