// 主執行緒 ↔ Worker 之間的訊息格式

import type { ScrollState } from './pose.js';

export interface SceneOptions {
	width: number;
	height: number;
	dpr: number;
	reduced: boolean;
}

export type ToScene =
	| { type: 'init'; canvas: OffscreenCanvas; options: SceneOptions }
	| { type: 'resize'; width: number; height: number; dpr: number }
	| { type: 'pointer'; x: number; y: number }
	| { type: 'scroll'; state: ScrollState }
	| { type: 'visible'; visible: boolean };

export interface SceneStats {
	/** 每秒畫了幾幀（內容區刻意降到 30fps 時會比較低） */
	fps: number;
	/** 每秒 rAF 迴圈跑了幾次，GPU 跟不上時這個會掉 */
	loopFps: number;
	/** 最近一秒最慢的一幀（毫秒） */
	worstMs: number;
}

export type FromScene =
	| { type: 'ready'; gpu: string }
	| { type: 'stats'; stats: SceneStats }
	| { type: 'error'; message: string };
