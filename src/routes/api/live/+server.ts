import { json } from '@sveltejs/kit';
import { getLive } from '#lib/server/site.js';
import type { RequestHandler } from './$types';

// 管理員現在在做什麼，前端每隔一陣子來問一次；即時的東西不能快取
export const GET: RequestHandler = async () => json(await getLive(), { headers: { 'cache-control': 'no-store' } });
