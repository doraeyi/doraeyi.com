import { describe, expect, it } from 'vitest';
import { domainOf, keeperName, taipeiNight } from './world.js';

describe('keeperName', () => {
	it('同一個 key 永遠是同一位，名字來自該種類的名單', () => {
		expect(keeperName('vm:blog', 'cat')).toBe(keeperName('vm:blog', 'cat'));
		expect(['麻糬', '芝麻', '布丁', '湯圓']).toContain(keeperName('vm:blog', 'cat'));
		expect(['Bolt', 'Pixel', 'Byte', 'Gizmo']).toContain(keeperName('vercel:x', 'robot'));
	});

	it('不同 key 會分到不同名字', () => {
		const names = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((k) => keeperName(k, 'dog')));
		expect(names.size).toBeGreaterThan(1);
	});
});

describe('taipeiNight：台灣時間 18:00–05:59 算晚上', () => {
	// 台灣是 UTC+8，所以台灣 18:00 = UTC 10:00、台灣 06:00 = UTC 22:00
	it.each([
		['2026-06-01T09:59:00Z', false],
		['2026-06-01T10:00:00Z', true],
		['2026-06-01T15:59:00Z', true],
		['2026-06-01T16:00:00Z', true],
		['2026-06-01T21:59:00Z', true],
		['2026-06-01T22:00:00Z', false],
		['2026-06-01T04:00:00Z', false]
	])('%s → %s', (iso, night) => {
		expect(taipeiNight(new Date(iso))).toBe(night);
	});
});

describe('domainOf', () => {
	it('去掉 www，壞網址跟 null 回 null', () => {
		expect(domainOf('https://www.doraeyi.com/path')).toBe('doraeyi.com');
		expect(domainOf('not a url')).toBeNull();
		expect(domainOf(null)).toBeNull();
	});
});
