// 主執行緒 ↔ Worker 之間的訊息格式

import type { World } from './world.js';

/** 鏡頭停靠點：全景、兩間房間、GitHub 地毯，或某一張桌子的 key */
export type Focus = 'all' | 'vercel' | 'vm' | 'github' | (string & {});

/** 2：開陰影、高解析度；1：關陰影、降解析度（手機起始值） */
export type Tier = 1 | 2;

export interface SceneOptions {
	width: number;
	height: number;
	dpr: number;
	reduced: boolean;
	tier: Tier;
}

export type ToScene =
	| { type: 'init'; canvas: OffscreenCanvas; options: SceneOptions; world: World }
	| { type: 'resize'; width: number; height: number; dpr: number }
	/** 拖曳旋轉，單位是畫面寬度的比例 */
	| { type: 'orbit'; dx: number; dy: number }
	/** 縮放，>1 拉遠 */
	| { type: 'zoom'; factor: number }
	/** 滑鼠位置（-1~1），用來找滑到哪張桌子 */
	| { type: 'hover'; x: number; y: number }
	| { type: 'click'; x: number; y: number }
	/** panel：資訊卡有沒有打開，打開時畫面中心要讓開 */
	| { type: 'focus'; focus: Focus; panel: boolean }
	| { type: 'tier'; tier: Tier }
	/** 直接切換 QR code（切換列上的按鈕） */
	| { type: 'qr'; on: boolean }
	| { type: 'visible'; visible: boolean };

export interface SceneStats {
	fps: number;
	/** 每秒 rAF 迴圈跑了幾次，GPU 跟不上時這個會掉 */
	loopFps: number;
	/** 最近一秒最慢的一幀（毫秒） */
	worstMs: number;
	drawCalls: number;
	triangles: number;
	tier: Tier;
}

export type FromScene =
	| { type: 'ready'; gpu: string }
	| { type: 'stats'; stats: SceneStats }
	| { type: 'hover'; key: string | null }
	| { type: 'select'; key: string }
	/** on：現在是不是 QR code；pull：往下拉了多少（0~1，到 1 就變身），往回推是負的 */
	| { type: 'qr'; on: boolean; pull: number }
	| { type: 'error'; message: string };
