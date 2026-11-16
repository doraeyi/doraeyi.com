import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

// 用暫存資料夾裡的新資料庫，不碰 data/ 底下的真資料
const dir = mkdtempSync(join(tmpdir(), 'doraeyi-test-'));
vi.mock('$app/env/private', () => ({ DATABASE_URL: join(dir, 'test.db') }));

const { getHealth, saveHealth } = await import('./db.js');

afterAll(() => {
	// Windows 上資料庫連線還開著刪不掉，留在系統暫存資料夾就好
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch {
		/* 略過 */
	}
});

describe('妥善率', () => {
	const check = (ok: boolean, checkedAt: number) => ({ ok, status: ok ? 200 : 502, ms: 5, note: ok ? null : 'HTTP 502', checkedAt });

	it('累計成功次數 / 檢查次數，最新一次的結果蓋過舊的', () => {
		saveHealth('vm:a', check(true, 1));
		saveHealth('vm:a', check(false, 2));
		saveHealth('vm:a', check(true, 3));
		saveHealth('vm:a', check(true, 4));
		const h = getHealth().get('vm:a');
		expect(h).toMatchObject({ ok: true, status: 200, checkedAt: 4 });
		expect(h?.uptime).toBe(0.75);
	});

	it('全部失敗就是 0，各專案分開算', () => {
		saveHealth('vm:b', check(false, 1));
		expect(getHealth().get('vm:b')).toMatchObject({ ok: false, note: 'HTTP 502', uptime: 0 });
		expect(getHealth().get('vm:a')?.uptime).toBe(0.75);
	});
});
