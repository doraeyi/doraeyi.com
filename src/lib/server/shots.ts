import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { DB_FILE, saveShot } from './db.js';

// 各專案首頁的截圖，貼到 3D 房間裡桌上的螢幕
// 用 WordPress 的 mshots 服務拍（免費、不用帳號），容器裡就不用裝一整套 Chrome。
// mshots 第一次被要求時會先回一張「生成中」的 GIF，過十幾秒再要一次才是真的截圖，所以要重試

export const SHOT_EVERY = 24 * 60 * 60 * 1000;
const DIR = join(dirname(DB_FILE), 'shots');
const UA = 'Mozilla/5.0 (compatible; doraeyi.com-patrol/1.0; +https://doraeyi.com)';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** key 裡有冒號，換成檔名安全的字元 */
const fileFor = (key: string) => join(DIR, key.replace(/[^a-z0-9-]/gi, '_') + '.jpg');

export const readShot = (key: string) => readFile(fileFor(key));

/** 拍一張 1280×800 視窗的首頁，縮成 640×400（訪客下載比較輕） */
async function capture(key: string, url: string) {
	const api = `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=640&h=400&vpw=1280&vph=800`;
	for (let attempt = 0; attempt < 5; attempt++) {
		const res = await fetch(api, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) });
		if (res.ok && res.headers.get('content-type')?.startsWith('image/jpeg')) {
			await mkdir(DIR, { recursive: true });
			await writeFile(fileFor(key), Buffer.from(await res.arrayBuffer()));
			saveShot(key, Date.now());
			return true;
		}
		void res.body?.cancel();
		await sleep(20_000);
	}
	return false;
}

let running: Promise<void> | null = null;

/** 一次拍一張，避免同時打太多請求；同一時間只跑一輪 */
export function captureAll(targets: { key: string; url: string }[]) {
	if (!targets.length || running) return running;
	running = (async () => {
		for (const t of targets) {
			try {
				if (!(await capture(t.key, t.url))) console.warn('[shots] 截圖一直沒好：', t.url);
			} catch (err) {
				console.warn('[shots] 截圖失敗：', t.url, err instanceof Error ? err.message : err);
			}
		}
	})().finally(() => (running = null));
	return running;
}
