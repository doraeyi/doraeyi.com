// 3D 球依捲動位置的姿態。WebGL 版和 CSS 版共用，兩種模式的球才會走一樣的路線

export interface ScrollState {
	/** scrollY / 視窗高，0 = 首屏頂端，1 = 捲過一整個首屏 */
	hero: number;
	/** 整頁捲動進度 0–1 */
	progress: number;
}

export interface Pose {
	/** 世界座標，單位跟 three.js 場景一樣 */
	x: number;
	y: number;
	scale: number;
	/** 0–1，內容區會淡到背景 */
	fade: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const ease = (v: number) => v * v * (3 - 2 * v);

/** 首屏在主角位置；往下捲退到右邊當背景；到頁尾回到中間 */
export function blobPose({ hero, progress }: ScrollState, mobile: boolean): Pose {
	const he = ease(clamp01(hero));
	const ee = ease(clamp01((progress - 0.86) / 0.14));
	return {
		x: lerp(lerp(mobile ? 0 : 1.9, mobile ? 1.6 : 3.6, he), 0, ee),
		y: lerp(lerp(mobile ? 0.9 : 0.1, mobile ? 1.2 : 0.4, he), mobile ? -1.3 : -2.1, ee),
		scale: (mobile ? 0.72 : 1) * lerp(lerp(1, 0.75, he), 0.7, ee),
		fade: lerp(lerp(1, 0.16, he), 0.4, ee)
	};
}

/** 相機設定：CSS 版要用同樣的視角換算像素 */
export const CAMERA_Z = 6;
export const fovFor = (width: number) => (width < 700 ? 58 : 42);
/** 在 z=0 平面上，一個世界單位等於幾個 CSS 像素 */
export const pxPerUnit = (width: number, height: number) =>
	height / (2 * CAMERA_Z * Math.tan(((fovFor(width) / 2) * Math.PI) / 180));
