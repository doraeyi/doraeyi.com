import type { DeskState, LiveData } from '#lib/types.js';
import type { PresenceRow } from './db.js';

// Claude 的工作狀態跟 GitHub 的 push 要對到網站上的哪一張桌子：
//   先比 repo（owner/name），對不到再拿名稱（資料夾或 repo 名）比專案代號、repo 名、網站網域

/** 做事中每呼叫一次工具就回報一次（最快一分鐘一次），這麼久沒消息就當作停了 */
export const WORKING_TTL = 15 * 60 * 1000;
/** 做完一輪在等你回覆，這麼久沒動靜就當作下班了 */
export const WAITING_TTL = 30 * 60 * 1000;
/** 這麼久以前的 push 就不澆了 */
export const PUSH_TTL = 15 * 60 * 1000;

/** https://github.com/Owner/Name(.git)、git@github.com:Owner/Name.git → owner/name */
export function repoSlug(url: string | null | undefined): string | null {
	if (!url) return null;
	const m = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url.trim());
	return m ? `${m[1]}/${m[2]}`.toLowerCase() : null;
}

interface DeskRef {
	key: string;
	id: string;
	repo: string | null;
	url: string | null;
}

const hostOf = (url: string | null) => {
	try {
		return url ? new URL(url).host.replace(/^www\./, '').toLowerCase() : null;
	} catch {
		return null;
	}
};

/** 一個 repo 可能對到好幾張桌子（monorepo 在 Vercel 上拆成好幾個專案），全部回傳 */
export function matchDesks(desks: DeskRef[], repo: string | null, dir?: string | null): string[] {
	if (repo) {
		const hits = desks.filter((d) => repoSlug(d.repo) === repo);
		if (hits.length) return hits.map((d) => d.key);
	}
	const names = new Set([dir, repo?.split('/')[1]].filter(Boolean).map((n) => n!.toLowerCase()));
	if (!names.size) return [];
	// repo 叫 doraeyi.com、網站就在 doraeyi.com 這種也算
	return desks
		.filter((d) => names.has(d.id.toLowerCase()) || names.has(repoSlug(d.repo)?.split('/')[1] ?? '') || names.has(hostOf(d.url) ?? ''))
		.map((d) => d.key);
}

export function buildLive(
	desks: DeskRef[],
	presence: PresenceRow[],
	pushes: { id: number; repo: string; commits: number; at: number }[],
	now = Date.now()
): LiveData {
	const states: Record<string, DeskState> = {};
	for (const p of presence) {
		const age = now - p.updated_at;
		// 很久沒回報的「做事中」可能是中途被打斷，當作做完了在等你
		const state: DeskState | null = p.state === 'working' && age < WORKING_TTL ? 'working' : age < WAITING_TTL ? 'waiting' : null;
		if (!state) continue;
		// 同一個專案開了好幾個 session，有一個在做事就算在做事
		for (const key of matchDesks(desks, p.repo, p.dir)) if (states[key] !== 'working') states[key] = state;
	}
	return {
		desks: states,
		pushes: pushes.filter((p) => now - p.at < PUSH_TTL).map((p) => ({ ...p, key: matchDesks(desks, p.repo)[0] ?? null })),
		at: now
	};
}
