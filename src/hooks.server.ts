import { building } from '$app/env';
import type { ServerInit } from '@sveltejs/kit/hooks';
import { startPatrol } from '#lib/server/site.js';

// 伺服器一啟動就開始例行巡房（build 預渲染時不要跑）
export const init: ServerInit = () => {
	if (!building) startPatrol();
};
