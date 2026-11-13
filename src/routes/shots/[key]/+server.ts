import { error } from '@sveltejs/kit';
import { readShot } from '#lib/server/shots.js';
import type { RequestHandler } from './$types';

// 專案首頁截圖。網址帶 ?v=拍攝時間，內容換了網址就會變，所以可以放心快取很久
export const GET: RequestHandler = async ({ params }) => {
	try {
		const body = await readShot(params.key);
		return new Response(new Uint8Array(body), {
			headers: { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=604800, immutable' }
		});
	} catch {
		error(404, '還沒有截圖');
	}
};
