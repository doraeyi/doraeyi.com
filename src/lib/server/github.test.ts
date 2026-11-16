import { describe, expect, it } from 'vitest';
import { parseContributions } from './github.js';

const cell = (date: string, id: string) =>
	`<td tabindex="0" data-ix="0" data-date="${date}" id="${id}" data-level="1" class="ContributionCalendar-day"></td>`;
const tip = (id: string, text: string) => `<tool-tip id="tooltip-${id}" for="${id}" popover="manual">${text}</tool-tip>`;

describe('parseContributions', () => {
	it('依 id 對上 tool-tip，照日期排好，總數用頁面上寫的', () => {
		const html = `
			<h2>1,234 contributions in the last year</h2>
			${cell('2026-01-02', 'day-2')}${cell('2026-01-01', 'day-1')}${cell('2026-01-03', 'day-3')}
			${tip('day-2', '5 contributions on January 2nd.')}
			${tip('day-1', 'No contributions on January 1st.')}
			${tip('day-3', '1 contribution on January 3rd.')}
			${tip('orphan', '9 contributions on nowhere.')}`;
		expect(parseContributions(html)).toEqual({
			days: [
				{ date: '2026-01-01', count: 0 },
				{ date: '2026-01-02', count: 5 },
				{ date: '2026-01-03', count: 1 }
			],
			total: 1234
		});
	});

	it('頁面沒寫總數就自己加', () => {
		const html = cell('2026-01-01', 'a') + cell('2026-01-02', 'b') + tip('a', '2 contributions') + tip('b', '3 contributions');
		expect(parseContributions(html).total).toBe(5);
	});

	it('格式變了就丟錯，不要默默回空的', () => {
		expect(() => parseContributions('<html></html>')).toThrow('格式變了');
	});
});
