import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';

vi.mock('$app/env/private', () => ({}));
const { deriveWebhookSecret } = await import('./secret.js');

describe('webhook 的 Secret', () => {
	it('有設 GITHUB_WEBHOOK_SECRET 就用它', () => {
		expect(deriveWebhookSecret('mine', 'token')).toBe('mine');
	});

	it('沒設就從 PRESENCE_TOKEN 算，跟 setup-live.ps1 用同一個算法', () => {
		const expected = createHmac('sha256', 'token').update('doraeyi github webhook').digest('hex');
		expect(deriveWebhookSecret(undefined, 'token')).toBe(expected);
		expect(deriveWebhookSecret('', 'token')).toBe(expected);
	});

	it('兩個都沒設就不收', () => {
		expect(deriveWebhookSecret(undefined, undefined)).toBeUndefined();
	});
});
