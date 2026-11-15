import { expect, test } from '@playwright/test';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';

// 換顏色、燈光、地磚高度都可能讓 QR 掃不出來（之前就發生過紫色太淺），
// 所以每次部署前真的拍一張畫面、用 jsQR 解一次，白天跟晚上的光線都要過
const EXPECTED = 'https://github.com/doraeyi';

/** 原尺寸解不出來時再縮小試一次：燈光的光暈在大圖上比較容易干擾 */
function decode(png: Buffer) {
	const img = PNG.sync.read(png);
	for (const step of [1, 2]) {
		const w = Math.floor(img.width / step);
		const h = Math.floor(img.height / step);
		const data = new Uint8ClampedArray(w * h * 4);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) {
				const src = (y * step * img.width + x * step) * 4;
				data.set(img.data.subarray(src, src + 4), (y * w + x) * 4);
			}
		}
		const hit = jsQR(data, w, h);
		if (hit) return hit.data;
	}
	return null;
}

for (const [night, label] of [
	['0', '白天'],
	['1', '晚上']
] as const) {
	test(`往下拉變成的 QR 掃得到（${label}）`, async ({ page }) => {
		// ?capture：固定最高畫質、不會因為 CI 算圖慢就自動降級成清單模式
		await page.goto(`/?capture&night=${night}`);
		await expect(page.locator('canvas'), '沒有 WebGL，畫面退回清單模式').toBeVisible({ timeout: 30_000 });

		await page.getByRole('button', { name: 'QR', exact: true }).click();
		await expect(page.locator('.qr-card')).toBeVisible();
		// 卡片跟按鈕不在 QR 上，但還是藏起來，只留場景
		await page.addStyleTag({ content: '.hud, .dock, .qr-card, .pull { visibility: hidden !important; }' });

		// 鏡頭拉高、地磚升起要一點時間；CI 用軟體算圖比較慢，就一直拍到解得出來為止
		let text: string | null = null;
		const until = Date.now() + 30_000;
		while (!text && Date.now() < until) {
			await page.waitForTimeout(1000);
			text = decode(await page.screenshot());
		}
		// 失敗時留一張圖在 test-results/，CI 會當成 artifact 上傳
		if (!text) await page.screenshot({ path: test.info().outputPath('qr.png') });
		expect(text).toBe(EXPECTED);
	});
}
