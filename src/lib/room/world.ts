// 畫面上的兩間房間要的資料：從 SiteData 整理出來，主執行緒跟 Worker 都用這份

import type { Host, Keeper, SiteData } from '#lib/types.js';

export interface Desk {
	key: string;
	title: string;
	/** 螢幕上顯示的網域，沒有網址就是 null */
	domain: string | null;
	keeper: Keeper;
	keeperName: string;
	asleep: boolean;
	/** 還沒檢查過 */
	unchecked: boolean;
	ms: number | null;
	/** 首頁截圖，螢幕會貼這張；沒有就顯示文字版 */
	shot: string | null;
}

export interface Room {
	host: Host;
	label: string;
	sub: string;
	desks: Desk[];
}

export interface World {
	handle: string;
	rooms: [Room, Room];
	/** 過去一年每天的提交數，舊 → 新 */
	commits: number[];
	/** 台灣時間是晚上：窗外變夜景、檯燈打開 */
	night: boolean;
	/** 往下拉會變出來的 GitHub QR code */
	qr: SiteData['qr'];
}

const NAMES: Record<Keeper, string[]> = {
	robot: ['Bolt', 'Pixel', 'Byte', 'Gizmo'],
	cat: ['麻糬', '芝麻', '布丁', '湯圓'],
	dog: ['豆花', '可樂', '旺財', '饅頭']
};

export const KEEPER_LABEL: Record<Keeper, string> = { robot: '機器人', cat: '貓', dog: '狗' };

export function domainOf(url: string | null) {
	if (!url) return null;
	try {
		return new URL(url).host.replace(/^www\./, '');
	} catch {
		return null;
	}
}

/** 名字依專案 key 固定，不會每次重新整理就換人 */
export function keeperName(key: string, keeper: Keeper) {
	let h = 0;
	for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
	const list = NAMES[keeper];
	return list[h % list.length];
}

export function taipeiNight(now = new Date()) {
	const hour = Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Taipei' }).format(now));
	return hour >= 18 || hour < 6;
}

export function buildWorld(data: SiteData): World {
	const desks = (host: Host): Desk[] =>
		data.projects
			.filter((p) => p.host === host)
			.map((p) => ({
				key: p.key,
				title: p.title,
				domain: domainOf(p.url),
				keeper: p.keeper,
				keeperName: keeperName(p.key, p.keeper),
				asleep: p.asleep,
				unchecked: !p.health,
				ms: p.health?.ms ?? null,
				shot: p.shot
			}));

	return {
		handle: data.profile.handle,
		rooms: [
			{ host: 'vercel', label: 'VERCEL', sub: '雲端託管', desks: desks('vercel') },
			{ host: 'vm', label: 'VM', sub: '同事的機房', desks: desks('vm') }
		],
		commits: data.github?.days.map((d) => d.count) ?? [],
		night: taipeiNight(),
		qr: data.qr
	};
}
