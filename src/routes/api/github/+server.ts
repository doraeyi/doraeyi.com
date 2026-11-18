import { createHmac } from 'node:crypto';
import { error, json } from '@sveltejs/kit';
import { recordPush, recordRun } from '#lib/server/db.js';
import { sameSecret, webhookSecret } from '#lib/server/secret.js';
import type { RequestHandler } from './$types';

// GitHub webhook：push 跟 GitHub Actions 的進度。管理員從 push 開始澆水，Actions 全部跑完才停
// （webhook 要勾 push 跟 workflow_run 兩種事件）
// GitHub 用 Secret 對整個 body 簽章（X-Hub-Signature-256），對不上的一律不收

export const POST: RequestHandler = async ({ request }) => {
	const raw = await request.text();
	const sig = request.headers.get('x-hub-signature-256') ?? '';
	const secret = webhookSecret();
	if (!secret) error(503, '還沒設定 GITHUB_WEBHOOK_SECRET 或 PRESENCE_TOKEN');
	const expected = 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex');
	if (!sameSecret(sig, expected)) error(401, '簽章不對');

	const event = request.headers.get('x-github-event');
	// 剛加 webhook 時 GitHub 會先送一個 ping 試試看
	if (event === 'ping') return json({ ok: true, pong: true });

	const body = JSON.parse(raw) as {
		action?: string;
		after?: string;
		deleted?: boolean;
		commits?: unknown[];
		repository?: { full_name?: string };
		workflow_run?: { id: number; head_sha: string; event: string; conclusion: string | null };
	};
	const repo = body.repository?.full_name?.toLowerCase();
	if (!repo) return json({ ok: true, ignored: 'no repo' });

	if (event === 'push') {
		const commits = body.commits?.length ?? 0;
		// 刪分支、只推 tag 不算
		if (body.deleted || !commits || !body.after) return json({ ok: true, ignored: 'no commits' });
		recordPush(repo, body.after, commits);
		return json({ ok: true });
	}

	const run = body.workflow_run;
	// 只看 push 觸發的；排程、手動觸發的 Actions 不關澆水的事
	if (event === 'workflow_run' && run && run.event === 'push') {
		if (body.action === 'completed') recordRun(repo, run.head_sha, run.id, 'end', ['success', 'skipped', 'neutral'].includes(run.conclusion ?? ''));
		else recordRun(repo, run.head_sha, run.id, 'start', true);
		return json({ ok: true });
	}
	return json({ ok: true, ignored: event });
};
