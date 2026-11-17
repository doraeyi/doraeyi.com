import { createHmac } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { GITHUB_WEBHOOK_SECRET } from '$app/env/private';
import { savePush } from '#lib/server/db.js';
import { sameSecret } from '#lib/server/secret.js';
import type { RequestHandler } from './$types';

// GitHub webhook：repo 有 push 就通知這裡，管理員會跑去花園幫今天那棵樹澆水
// GitHub 用 Secret 對整個 body 簽章（X-Hub-Signature-256），對不上的一律不收

export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.text();
	const sig = request.headers.get('x-hub-signature-256') ?? '';
	if (!GITHUB_WEBHOOK_SECRET) error(503, '還沒設定 GITHUB_WEBHOOK_SECRET');
	const expected = 'sha256=' + createHmac('sha256', GITHUB_WEBHOOK_SECRET).update(raw).digest('hex');
	if (!sameSecret(sig, expected)) error(401, '簽章不對');

	const event = request.headers.get('x-github-event');
	// 剛加 webhook 時 GitHub 會先送一個 ping 試試看
	if (event === 'ping') return json({ ok: true, pong: true });
	if (event !== 'push') return json({ ok: true, ignored: event });

	const body = JSON.parse(raw) as { deleted?: boolean; commits?: unknown[]; repository?: { full_name?: string } };
	const repo = body.repository?.full_name?.toLowerCase();
	const commits = body.commits?.length ?? 0;
	// 刪分支、只推 tag 不算
	if (!repo || body.deleted || !commits) return json({ ok: true, ignored: 'no commits' });

	savePush(repo, commits);
	return json({ ok: true });
};
