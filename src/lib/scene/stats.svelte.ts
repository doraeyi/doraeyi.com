// 3D 場景的即時狀態，給 ?debug=perf 面板讀

import type { SceneStats } from './protocol.js';

export type SceneMode = 'pending' | 'worker' | 'main' | 'lite';

export const sceneInfo = $state({
	mode: 'pending' as SceneMode,
	/** 為什麼選這個模式（或為什麼降級） */
	reason: '',
	gpu: '',
	dpr: 1,
	stats: null as SceneStats | null,
	/** 從開始載入到第一幀出現花了多久 */
	readyMs: 0
});
