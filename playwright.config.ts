import { defineConfig } from '@playwright/test';

const PORT = 4180;

// 只有一件事要守：房間變身成 QR 之後，手機真的掃得到。
// CI 用 Playwright 自己下載的 Chromium（軟體算圖），本機直接借系統裝的 Chrome，不用另外下載瀏覽器
export default defineConfig({
	testDir: 'tests',
	timeout: 90_000,
	retries: process.env.CI ? 1 : 0,
	reporter: process.env.CI ? [['github'], ['list']] : 'list',
	use: {
		baseURL: `http://localhost:${PORT}`,
		channel: process.env.CI ? undefined : 'chrome',
		launchOptions: { args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] }
	},
	projects: [
		{ name: 'desktop', use: { viewport: { width: 1280, height: 800 } } },
		{ name: 'phone', use: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } }
	],
	webServer: {
		command: 'pnpm build && node build/index.js',
		url: `http://localhost:${PORT}`,
		env: { PORT: String(PORT), DATABASE_URL: 'test-results/qr.db' },
		reuseExistingServer: !process.env.CI,
		timeout: 180_000
	}
});
