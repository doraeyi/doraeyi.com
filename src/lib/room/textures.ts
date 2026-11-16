// 用 2D canvas 畫的貼圖：螢幕、招牌、窗戶、假陰影。Worker 裡用 OffscreenCanvas，不碰 document

import * as THREE from 'three';
import type { Desk } from './world.js';

const FONT = '"PingFang TC", "Microsoft JhengHei", "Noto Sans TC", "Heiti TC", system-ui, sans-serif';

function canvas2d(w: number, h: number) {
	const c =
		typeof OffscreenCanvas !== 'undefined'
			? new OffscreenCanvas(w, h)
			: Object.assign(document.createElement('canvas'), { width: w, height: h });
	const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
	return { c, ctx };
}

function texture(c: OffscreenCanvas | HTMLCanvasElement) {
	const t = new THREE.CanvasTexture(c as HTMLCanvasElement);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 4;
	return t;
}

/** 卡通光影：只有三階亮度 */
export function toonRamp() {
	// 暗面別太黑：太黑的話牆跟木頭的紋路都看不到，像剪紙
	const data = new Uint8Array([118, 118, 118, 255, 184, 184, 184, 255, 255, 255, 255, 255]);
	const t = new THREE.DataTexture(data, 3, 1);
	t.minFilter = t.magFilter = THREE.NearestFilter;
	t.needsUpdate = true;
	return t;
}

/** 物件底下的圓形假陰影，比真的陰影便宜很多 */
export function blobTexture() {
	const { c, ctx } = canvas2d(64, 64);
	const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
	g.addColorStop(0, 'rgba(0,0,0,0.55)');
	g.addColorStop(0.6, 'rgba(0,0,0,0.25)');
	g.addColorStop(1, 'rgba(0,0,0,0)');
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, 64, 64);
	return texture(c);
}

export function zTexture() {
	const { c, ctx } = canvas2d(64, 64);
	ctx.font = `900 52px ${FONT}`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	ctx.lineWidth = 8;
	ctx.strokeStyle = '#1d2140';
	ctx.strokeText('Z', 32, 34);
	ctx.fillStyle = '#ffffff';
	ctx.fillText('Z', 32, 34);
	return texture(c);
}

function fit(ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D, text: string, max: number, weight: number, size: number) {
	let s = size;
	do ctx.font = `${weight} ${s}px ${FONT}`;
	while (ctx.measureText(text).width > max && --s > 10);
}

/** 桌上螢幕：專案名、網域、狀態 */
export function screenTexture(d: Desk) {
	const W = 320,
		H = 200;
	const { c, ctx } = canvas2d(W, H);
	const down = d.asleep;
	const bg = ctx.createLinearGradient(0, 0, 0, H);
	bg.addColorStop(0, down ? '#3a0f1a' : '#10162e');
	bg.addColorStop(1, down ? '#1c0710' : '#0a0d1c');
	ctx.fillStyle = bg;
	ctx.fillRect(0, 0, W, H);

	// 掃描線，像舊螢幕
	ctx.fillStyle = 'rgba(255,255,255,0.03)';
	for (let y = 0; y < H; y += 4) ctx.fillRect(0, y, W, 1);

	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = '#ffffff';
	fit(ctx, d.title, W - 40, 800, 40);
	ctx.fillText(d.title, 20, 66);

	ctx.fillStyle = down ? '#ff9db0' : '#8fd8ff';
	fit(ctx, d.domain ?? '尚未公開', W - 40, 500, 22);
	ctx.fillText(d.domain ?? '尚未公開', 20, 104);

	const color = down ? '#ff5d7a' : d.unchecked ? '#9aa0c0' : '#46e39a';
	const label = down ? 'DOWN · 管理員睡著了' : d.unchecked ? '等待第一次巡房' : `ONLINE${d.ms !== null ? ` · ${d.ms}ms` : ''}`;
	ctx.fillStyle = color;
	ctx.beginPath();
	ctx.arc(30, 156, 8, 0, Math.PI * 2);
	ctx.fill();
	ctx.font = `700 22px ${FONT}`;
	ctx.fillText(label, 48, 164);

	// 底下一條狀態列
	ctx.fillStyle = color;
	ctx.globalAlpha = 0.85;
	ctx.fillRect(0, H - 10, W, 10);
	return texture(c);
}

/** 房間牆上的招牌 */
export function signTexture(label: string, sub: string, kind: 'vercel' | 'vm') {
	const W = 512,
		H = 160;
	const { c, ctx } = canvas2d(W, H);
	ctx.fillStyle = kind === 'vercel' ? '#0b0b0e' : '#16263a';
	ctx.beginPath();
	ctx.roundRect(4, 4, W - 8, H - 8, 28);
	ctx.fill();
	ctx.lineWidth = 4;
	ctx.strokeStyle = kind === 'vercel' ? '#ffffff' : '#56d4ff';
	ctx.stroke();

	let x = 40;
	if (kind === 'vercel') {
		ctx.fillStyle = '#ffffff';
		ctx.beginPath();
		ctx.moveTo(x + 36, 42);
		ctx.lineTo(x + 76, 114);
		ctx.lineTo(x - 4, 114);
		ctx.closePath();
		ctx.fill();
	} else {
		// 一台小伺服器的圖示
		ctx.fillStyle = '#56d4ff';
		for (let i = 0; i < 3; i++) {
			ctx.fillRect(x, 40 + i * 28, 72, 20);
			ctx.fillStyle = '#16263a';
			ctx.fillRect(x + 52, 46 + i * 28, 8, 8);
			ctx.fillStyle = '#56d4ff';
		}
	}
	x += 100;
	ctx.fillStyle = '#ffffff';
	ctx.font = `900 64px ${FONT}`;
	ctx.textBaseline = 'alphabetic';
	ctx.fillText(label, x, 98);
	ctx.fillStyle = kind === 'vercel' ? '#a5a5b5' : '#9fd9f0';
	ctx.font = `600 26px ${FONT}`;
	ctx.fillText(sub, x + 2, 134);
	return texture(c);
}

/** 走廊上的名牌 */
export function nameTexture(handle: string) {
	const W = 512,
		H = 128;
	const { c, ctx } = canvas2d(W, H);
	ctx.textAlign = 'center';
	ctx.textBaseline = 'middle';
	fit(ctx, handle, W - 48, 900, 76);
	ctx.shadowColor = '#8b7bff';
	ctx.shadowBlur = 24;
	ctx.fillStyle = '#ffffff';
	ctx.fillText(handle, W / 2, H / 2 + 4);
	ctx.shadowBlur = 0;
	return texture(c);
}

/** 窗外：白天藍天白雲，晚上星星月亮 */
export function windowTexture(night: boolean) {
	const W = 128,
		H = 128;
	const { c, ctx } = canvas2d(W, H);
	const g = ctx.createLinearGradient(0, 0, 0, H);
	if (night) {
		g.addColorStop(0, '#0b1030');
		g.addColorStop(1, '#2a2160');
	} else {
		g.addColorStop(0, '#6ec3ff');
		g.addColorStop(1, '#c8ecff');
	}
	ctx.fillStyle = g;
	ctx.fillRect(0, 0, W, H);
	if (night) {
		ctx.fillStyle = '#fff';
		for (let i = 0; i < 18; i++) ctx.fillRect((i * 53) % W, (i * 37) % (H - 30), 2, 2);
		ctx.fillStyle = '#fff6c8';
		ctx.beginPath();
		ctx.arc(88, 36, 14, 0, Math.PI * 2);
		ctx.fill();
	} else {
		ctx.fillStyle = 'rgba(255,255,255,0.9)';
		for (const [x, y] of [
			[34, 40],
			[84, 70]
		]) {
			ctx.beginPath();
			ctx.arc(x, y, 12, 0, Math.PI * 2);
			ctx.arc(x + 14, y - 5, 14, 0, Math.PI * 2);
			ctx.arc(x + 28, y, 11, 0, Math.PI * 2);
			ctx.fill();
		}
	}
	return texture(c);
}

/** 有首頁截圖時的螢幕：截圖鋪滿，下面一條狀態列寫專案名稱跟回應時間 */
export function shotTexture(d: Desk, img: ImageBitmap) {
	const W = 512,
		H = 320;
	const { c, ctx } = canvas2d(W, H);
	// 截圖是 16:10，螢幕也是，直接鋪滿；比例不同時裁中間
	const s = Math.max(W / img.width, H / img.height);
	ctx.drawImage(img, (W - img.width * s) / 2, (H - img.height * s) / 2, img.width * s, img.height * s);

	const bar = 46;
	const g = ctx.createLinearGradient(0, H - bar - 24, 0, H);
	g.addColorStop(0, 'rgba(10,12,28,0)');
	g.addColorStop(0.35, 'rgba(10,12,28,0.85)');
	g.addColorStop(1, 'rgba(10,12,28,0.95)');
	ctx.fillStyle = g;
	ctx.fillRect(0, H - bar - 24, W, bar + 24);

	ctx.fillStyle = '#46e39a';
	ctx.beginPath();
	ctx.arc(22, H - bar / 2, 7, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = '#ffffff';
	ctx.textBaseline = 'middle';
	fit(ctx, d.title, W - 160, 800, 24);
	ctx.fillText(d.title, 38, H - bar / 2);
	if (d.ms !== null) {
		ctx.fillStyle = '#8fd8ff';
		ctx.font = `600 18px ${FONT}`;
		ctx.textAlign = 'right';
		ctx.fillText(`${d.ms}ms`, W - 16, H - bar / 2);
	}
	return texture(c);
}

/** 提交地毯角落的說明牌 */
export function carpetLabelTexture(total: number) {
	const W = 512,
		H = 160;
	const { c, ctx } = canvas2d(W, H);
	// 花園裡的木頭立牌
	ctx.fillStyle = '#f8f4ea';
	ctx.beginPath();
	ctx.roundRect(4, 4, W - 8, H - 8, 26);
	ctx.fill();
	ctx.lineWidth = 6;
	ctx.strokeStyle = '#9a7350';
	ctx.stroke();

	// GitHub 的貓頭鷹太複雜，用一個小方格圖示代表「提交格子」，顏色跟花圃一樣由淡綠到深綠
	const colors = ['#b9c79d', '#93c46f', '#62a650', '#3e8744', '#2a6633'];
	for (let r = 0; r < 3; r++)
		for (let k = 0; k < 3; k++) {
			ctx.fillStyle = colors[(r * 2 + k) % colors.length];
			ctx.fillRect(32 + k * 22, 38 + r * 22, 18, 18);
		}

	ctx.textBaseline = 'alphabetic';
	ctx.fillStyle = '#2f2a22';
	fit(ctx, 'GitHub 提交紀錄', W - 150, 900, 44);
	ctx.fillText('GitHub 提交紀錄', 118, 76);
	ctx.fillStyle = '#6b5a43';
	const sub = `過去一年 ${total} 次・一天一株・右邊是今天`;
	fit(ctx, sub, W - 150, 600, 24);
	ctx.fillText(sub, 120, 118);
	return texture(c);
}
