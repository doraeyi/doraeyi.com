import { createHmac, timingSafeEqual } from 'node:crypto';
import { GITHUB_WEBHOOK_SECRET, PRESENCE_TOKEN } from '$app/env/private';

/** 比對密碼、簽章：花的時間跟內容無關，不會被一個字一個字猜出來 */
export function sameSecret(a: string, b: string) {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * GitHub webhook 的 Secret：有設 GITHUB_WEBHOOK_SECRET 就用它；沒設就從 PRESENCE_TOKEN 算出來，
 * 這樣只要在 VM 跟電腦上放同一組 PRESENCE_TOKEN，scripts/setup-live.ps1 就能算出同一組 Secret 去設 webhook，
 * 不用再把第二組密碼從一台機器搬到另一台。從算出來的值推不回 PRESENCE_TOKEN
 */
export function webhookSecret() {
	return deriveWebhookSecret(GITHUB_WEBHOOK_SECRET, PRESENCE_TOKEN);
}

export function deriveWebhookSecret(explicit: string | undefined, presence: string | undefined) {
	if (explicit) return explicit;
	return presence ? createHmac('sha256', presence).update('doraeyi github webhook').digest('hex') : undefined;
}
