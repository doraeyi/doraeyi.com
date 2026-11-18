import { error, json } from '@sveltejs/kit';
import { PRESENCE_TOKEN } from '$app/env/private';
import { savePresence, startWatering, type PresenceState } from '#lib/server/db.js';
import { repoSlug } from '#lib/server/live.js';
import { sameSecret } from '#lib/server/secret.js';
import type { RequestHandler } from './$types';

// 電腦上的 Claude Code 每次開工、呼叫工具、做完一輪都會打這裡（scripts/claude-presence.mjs）
// 只收專案在哪個 repo、現在的狀態，不收對話內容

/** Claude Code hook 的事件名稱 → 管理員的狀態；null 是 session 結束 */
const STATE: Record<string, PresenceState | null> = {
	UserPromptSubmit: 'working',
	PreToolUse: 'working',
	PostToolUse: 'working',
	Stop: 'waiting',
	Notification: 'waiting',
	SessionEnd: null
};

export const POST: RequestHandler = async ({ request }) => {
	const auth = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
	if (!PRESENCE_TOKEN || !sameSecret(auth, PRESENCE_TOKEN)) error(401, '密碼不對');

	const body = (await request.json().catch(() => null)) as { session?: unknown; event?: unknown; repo?: unknown; dir?: unknown; push?: unknown } | null;
	const session = typeof body?.session === 'string' ? body.session.slice(0, 100) : '';
	const event = typeof body?.event === 'string' ? body.event : '';
	const dir = typeof body?.dir === 'string' ? body.dir.slice(0, 100).toLowerCase() : '';
	if (!session || !dir || !(event in STATE)) error(400, '少了 session、dir 或 event 不認得');

	const repo = repoSlug(typeof body?.repo === 'string' ? body.repo : null);
	savePresence(session, { repo, dir, state: STATE[event] });
	// Claude 正要 git push：管理員先出發去花園，等 GitHub 收到、部署完成
	if (body?.push === true && repo) startWatering(repo);
	return json({ ok: true });
};
