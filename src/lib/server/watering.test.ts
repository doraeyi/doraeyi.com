import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// 用暫存資料夾裡的新資料庫，不碰 data/ 底下的真資料
const dir = mkdtempSync(join(tmpdir(), 'doraeyi-water-'));
vi.mock('$app/env/private', () => ({ DATABASE_URL: join(dir, 'test.db') }));

const { getWaterings, NO_CI_WAIT, PUSH_WAIT, recordPush, recordRun, startWatering } = await import('./db.js');

const S = 1000;
const one = (repo: string, now: number) => getWaterings(now).filter((w) => w.repo === repo);

describe('澆水：從開始 push 到部署完成', () => {
	it('Claude 開始 push → GitHub 收到 → Actions 全部跑完才澆完', () => {
		const t = 10_000 * S;
		startWatering('me/a', t);
		startWatering('me/a', t + S); // 重複的不另開
		expect(one('me/a', t + 2 * S)).toMatchObject([{ commits: 0, pushed_at: null, done_at: null }]);

		recordPush('me/a', 'sha1', 3, t + 3 * S);
		recordRun('me/a', 'sha1', 11, 'start', true, t + 5 * S);
		recordRun('me/a', 'sha1', 12, 'start', true, t + 5 * S);
		recordRun('me/a', 'sha1', 11, 'end', true, t + 60 * S);
		expect(one('me/a', t + 61 * S)[0]).toMatchObject({ commits: 3, done_at: null });

		recordRun('me/a', 'sha1', 12, 'end', true, t + 200 * S);
		expect(one('me/a', t + 201 * S)[0]).toMatchObject({ done_at: t + 200 * S, ok: 1, started_at: t });
	});

	it('手動 push（沒有 Claude 先通知），部署失敗也算澆完，只是 ok = 0', () => {
		const t = 20_000 * S;
		recordPush('me/b', 'shaB', 1, t);
		recordRun('me/b', 'shaB', 21, 'start', true, t + S);
		recordRun('me/b', 'shaB', 21, 'end', false, t + 90 * S);
		expect(one('me/b', t + 91 * S)[0]).toMatchObject({ started_at: t, done_at: t + 90 * S, ok: 0 });
	});

	it('沒有 CI 的 repo：GitHub 收到後等一下就收工', () => {
		const t = 30_000 * S;
		recordPush('me/c', 'shaC', 2, t);
		expect(one('me/c', t + NO_CI_WAIT - S)[0].done_at).toBeNull();
		expect(one('me/c', t + NO_CI_WAIT + S)[0]).toMatchObject({ done_at: t + NO_CI_WAIT + S, ok: 1 });
	});

	it('Actions 的通知比 push 先到也接得起來', () => {
		const t = 40_000 * S;
		recordRun('me/d', 'shaD', 31, 'start', true, t);
		recordPush('me/d', 'shaD', 4, t + S);
		recordRun('me/d', 'shaD', 31, 'end', true, t + 30 * S);
		expect(one('me/d', t + 31 * S)).toMatchObject([{ commits: 4, done_at: t + 30 * S }]);
	});

	it('開始 push 了 GitHub 卻一直沒收到：當作沒推成功', () => {
		const t = 50_000 * S;
		startWatering('me/e', t);
		expect(one('me/e', t + PUSH_WAIT + S)[0]).toMatchObject({ ok: 0, done_at: t + PUSH_WAIT + S });
	});
});
