// Q 版管理員：機器人、貓、狗。全部用基本幾何組起來，同一個部位的零件合併成一個 mesh，
// 顏色寫在頂點上，所有管理員共用同一個材質，draw call 才不會爆量

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { Keeper } from '#lib/types.js';

/** pattern：材質紋路（木紋、牆面…），見 detail.ts 的 PATTERN；不給就是素面 */
export type Part = [geometry: THREE.BufferGeometry, color: THREE.ColorRepresentation, matrix?: THREE.Matrix4, pattern?: number];

export const m4 = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) =>
	new THREE.Matrix4().compose(
		new THREE.Vector3(x, y, z),
		new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
		new THREE.Vector3(sx, sy, sz)
	);

/** 零件套上位置跟顏色後合成一個 geometry */
export function bake(parts: Part[]) {
	const color = new THREE.Color();
	const geos = parts.map(([g, c, m, pattern = 0]) => {
		const geo = g.clone();
		if (m) geo.applyMatrix4(m);
		// Color.set 會自動把 sRGB 轉成線性色彩，不用再轉一次
		color.set(c);
		const n = geo.attributes.position.count;
		const arr = new Float32Array(n * 3);
		for (let i = 0; i < n; i++) arr.set([color.r, color.g, color.b], i * 3);
		geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
		geo.setAttribute('pattern', new THREE.BufferAttribute(new Float32Array(n).fill(pattern), 1));
		return geo;
	});
	const merged = mergeGeometries(geos, false)!;
	for (const g of geos) g.dispose();
	return merged;
}

export const sphere = (r: number, w = 16, h = 12) => new THREE.SphereGeometry(r, w, h);
export const box = (x: number, y: number, z: number) => new THREE.BoxGeometry(x, y, z);
export const cyl = (r1: number, r2: number, h: number, seg = 12) => new THREE.CylinderGeometry(r1, r2, h, seg);
export const cone = (r: number, h: number) => new THREE.ConeGeometry(r, h, 10);

export interface KeeperState {
	asleep: boolean;
	/** 被點到之後過了幾秒（跳一下） */
	jump: number;
	/** 螢幕在哪個方向（頭要轉多少） */
	lookAt: number;
	/** Claude 正在改這個專案：盯著螢幕一直打字；waiting：做完了，轉過來等你回覆 */
	busy: 'working' | 'waiting' | null;
	/** 走路的速度 0~1：身體一跳一跳、手跟著擺 */
	walk: number;
	/** 拿著澆水壺 */
	carry: boolean;
	/** 澆水的程度 0~1：壺嘴往前倒 */
	water: number;
}

export interface KeeperRig {
	root: THREE.Group;
	/** 頭頂的位置（Zzz 從這裡飄出來） */
	headTop: THREE.Object3D;
	/** 澆水壺的壺嘴，水滴從這裡噴出來 */
	spout: THREE.Object3D;
	update(t: number, dt: number, s: KeeperState): void;
	dispose(): void;
}

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));

const PALETTE = {
	robot: [
		{ main: '#eef1f8', trim: '#6b7cff', dark: '#9aa3b8' },
		{ main: '#ffe9a8', trim: '#ff8a5c', dark: '#b39a6a' },
		{ main: '#c9f1e4', trim: '#29b98b', dark: '#7fa89a' }
	],
	cat: [
		{ main: '#f4a35c', belly: '#fff3e2', ear: '#ffb7c5' },
		{ main: '#a5abb8', belly: '#f2f3f7', ear: '#ffc2cf' },
		{ main: '#3e404c', belly: '#f7f7fa', ear: '#ff9fb4' }
	],
	dog: [
		{ main: '#f1d6a8', belly: '#fff8ea', ear: '#b9794a' },
		{ main: '#c98a55', belly: '#fbe6cc', ear: '#7a4a28' },
		{ main: '#f5f2ea', belly: '#ffffff', ear: '#9a6a44' }
	]
};

export function buildKeeper(kind: Keeper, variant: number, mat: THREE.Material, eyeMat: THREE.Material, seed: number): KeeperRig {
	const root = new THREE.Group();
	const body = new THREE.Group();
	const head = new THREE.Group();
	const headTop = new THREE.Object3D();
	root.add(body);
	body.add(head);
	head.add(headTop);

	const disposables: { dispose(): void }[] = [];
	const mesh = (geo: THREE.BufferGeometry, material = mat) => {
		const m = new THREE.Mesh(geo, material);
		m.castShadow = true;
		disposables.push(geo);
		return m;
	};

	let eyes: THREE.Mesh;
	let tail: THREE.Object3D | null = null;
	let armL: THREE.Object3D | null = null;
	let armR: THREE.Object3D | null = null;
	let lamp: THREE.Mesh | null = null;
	let lampMat: THREE.MeshBasicMaterial | null = null;

	if (kind === 'robot') {
		const c = PALETTE.robot[variant % 3];
		body.add(
			mesh(
				bake([
					[box(0.46, 0.4, 0.34), c.main, m4(0, 0.4, 0)],
					[box(0.26, 0.14, 0.02), c.trim, m4(0, 0.42, 0.175)],
					[cyl(0.07, 0.07, 0.2), c.dark, m4(-0.11, 0.12, 0)],
					[cyl(0.07, 0.07, 0.2), c.dark, m4(0.11, 0.12, 0)],
					[box(0.13, 0.07, 0.2), c.trim, m4(-0.11, 0.035, 0.03)],
					[box(0.13, 0.07, 0.2), c.trim, m4(0.11, 0.035, 0.03)],
					[cyl(0.06, 0.08, 0.06), c.dark, m4(0, 0.62, 0)]
				])
			)
		);
		head.position.y = 0.64;
		head.add(
			mesh(
				bake([
					[box(0.58, 0.44, 0.44), c.main, m4(0, 0.24, 0)],
					[box(0.46, 0.28, 0.02), '#161a33', m4(0, 0.24, 0.225)],
					[cyl(0.06, 0.06, 0.06), c.trim, m4(-0.3, 0.24, 0, 0, 0, Math.PI / 2)],
					[cyl(0.06, 0.06, 0.06), c.trim, m4(0.3, 0.24, 0, 0, 0, Math.PI / 2)],
					[cyl(0.015, 0.015, 0.16), c.dark, m4(0, 0.53, 0)]
				])
			)
		);
		lampMat = new THREE.MeshBasicMaterial({ color: '#46e39a' });
		disposables.push(lampMat);
		lamp = mesh(sphere(0.045, 10, 8), lampMat);
		lamp.position.y = 0.63;
		head.add(lamp);
		eyes = mesh(bake([[box(0.08, 0.1, 0.01), '#ffffff', m4(-0.1)], [box(0.08, 0.1, 0.01), '#ffffff', m4(0.1)]]), eyeMat);
		eyes.position.set(0, 0.25, 0.237);
		headTop.position.y = 0.66;
		const arm = (side: number) => {
			const pivot = new THREE.Group();
			pivot.position.set(side * 0.28, 0.54, 0);
			pivot.add(mesh(bake([[cyl(0.05, 0.05, 0.26), c.dark, m4(0, -0.13, 0)], [sphere(0.07, 10, 8), c.trim, m4(0, -0.28, 0)]])));
			body.add(pivot);
			return pivot;
		};
		armL = arm(-1);
		armR = arm(1);
	} else {
		const c = PALETTE[kind][variant % 3];
		const dog = kind === 'dog';
		body.add(
			mesh(
				bake([
					[sphere(0.3), c.main, m4(0, 0.28, -0.02, 0, 0, 0, 1.05, 1, 1)],
					[sphere(0.2), c.belly, m4(0, 0.26, 0.12, 0, 0, 0, 1, 1.1, 0.8)],
					[sphere(0.085, 10, 8), c.main, m4(-0.12, 0.06, 0.2, 0, 0, 0, 1, 0.8, 1.2)],
					[sphere(0.085, 10, 8), c.main, m4(0.12, 0.06, 0.2, 0, 0, 0, 1, 0.8, 1.2)],
					[sphere(0.1, 10, 8), c.main, m4(-0.2, 0.08, -0.05, 0, 0, 0, 1, 0.8, 1.4)],
					[sphere(0.1, 10, 8), c.main, m4(0.2, 0.08, -0.05, 0, 0, 0, 1, 0.8, 1.4)]
				])
			)
		);
		head.position.y = 0.5;
		const face: Part[] = dog
			? [
					[sphere(0.3), c.main, m4(0, 0.2, 0, 0, 0, 0, 1.08, 0.96, 1)],
					[sphere(0.13), c.belly, m4(0, 0.1, 0.24, 0, 0, 0, 1.2, 0.85, 1)],
					[sphere(0.05, 10, 8), '#22202a', m4(0, 0.15, 0.37, 0, 0, 0, 1.2, 0.9, 1)],
					[sphere(0.1, 10, 8), c.ear, m4(-0.29, 0.14, 0, 0, 0, 0.35, 0.7, 1.7, 0.5)],
					[sphere(0.1, 10, 8), c.ear, m4(0.29, 0.14, 0, 0, 0, -0.35, 0.7, 1.7, 0.5)],
					[sphere(0.04, 8, 6), '#ff8fa3', m4(0, 0.02, 0.31, 0, 0, 0, 1, 0.6, 0.6)]
				]
			: [
					[sphere(0.29), c.main, m4(0, 0.2, 0, 0, 0, 0, 1.12, 0.94, 1)],
					[sphere(0.12), c.belly, m4(0, 0.1, 0.22, 0, 0, 0, 1.3, 0.75, 0.9)],
					[sphere(0.03, 8, 6), '#ff7d97', m4(0, 0.15, 0.32)],
					[cone(0.1, 0.18), c.main, m4(-0.17, 0.44, 0, 0, 0, 0.3)],
					[cone(0.1, 0.18), c.main, m4(0.17, 0.44, 0, 0, 0, -0.3)],
					[cone(0.055, 0.1), c.ear, m4(-0.165, 0.425, 0.04, 0, 0, 0.3)],
					[cone(0.055, 0.1), c.ear, m4(0.165, 0.425, 0.04, 0, 0, -0.3)]
				];
		head.add(mesh(bake(face)));
		eyes = mesh(
			bake([
				[sphere(0.045, 10, 8), '#ffffff', m4(-0.11, 0, 0, 0, 0, 0, 1, 1.2, 0.6)],
				[sphere(0.045, 10, 8), '#ffffff', m4(0.11, 0, 0, 0, 0, 0, 1, 1.2, 0.6)]
			]),
			eyeMat
		);
		eyes.position.set(0, 0.23, 0.27);
		headTop.position.y = 0.5;

		tail = new THREE.Group();
		tail.position.set(0, 0.12, -0.28);
		const curve = dog
			? new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0.12, -0.08), new THREE.Vector3(0, 0.24, -0.06)])
			: new THREE.CatmullRomCurve3([
					new THREE.Vector3(0, 0, 0),
					new THREE.Vector3(0.05, 0.1, -0.16),
					new THREE.Vector3(0.12, 0.3, -0.14),
					new THREE.Vector3(0.08, 0.44, -0.04)
				]);
		tail.add(mesh(bake([[new THREE.TubeGeometry(curve, 12, dog ? 0.05 : 0.04, 6), c.main]])));
		body.add(tail);
	}
	head.add(eyes);

	// 澆水壺：平常收起來，要去花園才拿出來。機器人用右手拿，貓狗抱在胸前
	const can = new THREE.Group();
	can.add(
		mesh(
			bake([
				[cyl(0.09, 0.1, 0.17, 12), '#5aa9e6', m4(0, 0, 0)],
				[cyl(0.092, 0.092, 0.025, 12), '#3d86c4', m4(0, 0.085, 0)],
				// 壺嘴往前斜上，把手在後面
				[cyl(0.018, 0.026, 0.22, 8), '#3d86c4', m4(0, 0.05, 0.15, 0.95, 0, 0)],
				[cyl(0.032, 0.02, 0.03, 8), '#3d86c4', m4(0, 0.13, 0.24, 0.95, 0, 0)],
				[new THREE.TorusGeometry(0.06, 0.014, 6, 12, Math.PI), '#3d86c4', m4(0, 0.09, -0.07, 0, Math.PI / 2, 0)]
			])
		)
	);
	const spout = new THREE.Object3D();
	spout.position.set(0, 0.14, 0.26);
	can.add(spout);
	can.visible = false;
	if (armR) {
		can.position.set(0, -0.36, 0.05);
		armR.add(can);
	} else {
		can.position.set(0.12, 0.26, 0.3);
		body.add(can);
	}

	// 每位管理員的動作節奏錯開，看起來才不會像同一支動畫複製貼上
	const phase = seed * 1.7;
	let blinkAt = 1 + (seed % 3);
	let lookUntil = 2 + (seed % 4);
	let lookTarget = 0;
	let headYaw = 0;
	let headPitch = 0;
	let headRoll = 0;
	let sit = 0;

	let walkAmt = 0;
	let waterAmt = 0;

	return {
		root,
		headTop,
		spout,
		update(t, dt, s) {
			// 醒著：輪流看螢幕跟看鏡頭；睡著：頭垂下來、身體慢慢呼吸
			// Claude 在做事：一直盯著螢幕；做完在等你：轉過來看鏡頭；走路、澆水：看前面
			if (t > lookUntil) {
				lookTarget = lookTarget === 0 ? s.lookAt : 0;
				lookUntil = t + 2.5 + ((seed * 7 + t) % 3);
			}
			const away = s.walk > 0.01 || s.carry;
			const look = away ? 0 : s.busy === 'working' ? s.lookAt : s.busy === 'waiting' ? 0 : lookTarget;
			const asleep = s.asleep && !away;
			sit = damp(sit, asleep ? 1 : 0, 3, dt);
			walkAmt = damp(walkAmt, s.walk, 8, dt);
			waterAmt = damp(waterAmt, s.water, 4, dt);
			headYaw = damp(headYaw, asleep ? 0 : look, 5, dt);
			const nod = s.busy === 'working' && !away ? Math.sin(t * 5 + phase) * 0.05 + 0.08 : s.busy === 'waiting' && !away ? -0.12 : Math.sin(t * 1.3 + phase) * 0.06;
			headPitch = damp(headPitch, asleep ? 0.5 : nod + waterAmt * 0.3, 3, dt);
			// 等你回覆的時候歪著頭
			const tilt = s.busy === 'waiting' && !away ? 0.22 + Math.sin(t * 1.1 + phase) * 0.05 : Math.sin(t * 0.9 + phase) * 0.05;
			headRoll = damp(headRoll, asleep ? 0.28 : tilt, 3, dt);
			head.rotation.set(headPitch, headYaw, headRoll);

			const breathe = asleep ? Math.sin(t * 1.4 + phase) * 0.025 : 0;
			const stride = t * 11 + phase;
			body.scale.set(1 + breathe * 0.5, 1 - sit * 0.06 + breathe, 1 + breathe * 0.5);
			body.position.y = (1 - sit) * Math.abs(Math.sin(t * 2 + phase)) * 0.02 * (1 - walkAmt) + walkAmt * Math.abs(Math.sin(stride)) * 0.07;
			body.rotation.z = walkAmt * Math.sin(stride) * 0.1;
			can.visible = s.carry;
			if (!armR) can.rotation.x = waterAmt * 0.9;

			// 被點到會開心地跳一下、轉一圈
			if (s.jump < 0.7 && !asleep) {
				const k = s.jump / 0.7;
				root.position.y = Math.sin(k * Math.PI) * 0.35;
				body.rotation.y = k * Math.PI * 2;
			} else {
				root.position.y = 0;
				body.rotation.y = 0;
			}

			// 眨眼；睡著就一直閉著
			let open = 1;
			if (asleep) open = 0.12;
			else if (t > blinkAt) {
				open = 0.1;
				if (t > blinkAt + 0.12) blinkAt = t + 2.5 + ((seed * 13 + t) % 2.5);
			}
			eyes.scale.y = damp(eyes.scale.y, open, 30, dt);

			if (tail) {
				const speed = kind === 'dog' ? 11 : 2.2;
				const amp = asleep ? 0.05 : kind === 'dog' ? (s.busy === 'waiting' ? 0.9 : 0.6) : 0.35;
				tail.rotation.y = Math.sin(t * speed + phase) * amp;
			}
			if (armL && armR) {
				// 看螢幕的時候在打字；Claude 在做事時打得特別快
				const typing = !asleep && !away && Math.abs(headYaw) > 0.3 ? 1 : 0;
				const speed = s.busy === 'working' ? 26 : 16;
				// 走路時兩手前後擺；拿著壺的右手往前伸，澆水時再抬高一點
				const swing = Math.sin(stride) * 0.5 * walkAmt;
				armL.rotation.x = -typing * 0.9 + Math.sin(t * speed + phase) * 0.12 * typing - sit * 0.2 + swing;
				armR.rotation.x = s.carry ? -0.5 - waterAmt * 0.5 : -typing * 0.9 + Math.sin(t * speed + phase + 1.6) * 0.12 * typing - sit * 0.2 - swing;
				// 等你回覆的時候舉起左手揮一揮
				const wave = s.busy === 'waiting' && !away ? 1 : 0;
				armL.rotation.z = -0.15 - sit * 0.1 - wave * (2.3 + Math.sin(t * 6 + phase) * 0.3);
				armR.rotation.z = 0.15 + sit * 0.1;
				can.rotation.x = s.carry ? 0.5 + waterAmt * 0.9 : 0;
			}
			if (lamp && lampMat) {
				const blink = s.busy === 'working' ? Math.sin(t * 12 + phase) > 0 : Math.sin(t * 3 + phase) > 0.6;
				lampMat.color.set(asleep ? '#3a3f55' : blink ? '#ffffff' : s.busy === 'working' ? '#ff9a4d' : '#46e39a');
			}
		},
		dispose() {
			for (const d of disposables) d.dispose();
		}
	};
}
