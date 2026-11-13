// 兩間房間的 3D 場景本體。不碰 window / document，同一份程式可以在 Worker 或主執行緒跑
//
// 效能重點：
//   靜態的牆、地板、桌子全部合成一個 mesh；管理員每個部位一個 mesh、共用同一個頂點色材質
//   提交地毯 365 根柱子用 InstancedMesh，一次畫完；假陰影也是 InstancedMesh
//   tier 2 才開即時陰影；太卡時主執行緒會叫這裡降到 tier 1

import * as THREE from 'three';
import { bake, box, buildKeeper, cone, cyl, m4, sphere, type KeeperRig, type Part } from './keepers.js';
import type { Focus, FromScene, SceneOptions, SceneStats, Tier } from './protocol.js';
import { blobTexture, nameTexture, screenTexture, shotTexture, signTexture, toonRamp, windowTexture, zTexture } from './textures.js';
import type { Desk, Room, World } from './world.js';

const CELL_X = 2.7;
const CELL_Z = 2.5;
const WALL_H = 2.8;
const GAP = 2.4;
const BAR = 0.26;

const raf: (cb: (t: number) => void) => number =
	typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (cb) => setTimeout(() => cb(performance.now()), 16) as unknown as number;
const caf: (id: number) => void = typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : clearTimeout;

const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
/** 有一點彈性的出場曲線 */
const popEase = (k: number) => (k >= 1 ? 1 : 1 - Math.pow(2, -9 * k) * Math.cos(k * 9));

const THEME = {
	vercel: { wall: '#f4f1ea', trim: '#16161c', floor: '#dcc6a6', floorEdge: '#a98e6c', desk: '#c99a6b', leg: '#2a2a30' },
	vm: { wall: '#2e3f58', trim: '#56d4ff', floor: '#44546b', floorEdge: '#27313f', desk: '#8c9bb2', leg: '#1d2533' }
};

// 提交格子：淡紫 → 主色紫 → 最多的那幾天用青色點亮，跟網站主色同一組
const LEVEL_COLORS = ['#ddd6ee', '#b9acf3', '#9584f5', '#7059e6', '#4cc9f0'].map((c) => new THREE.Color(c));

interface DeskView {
	desk: Desk;
	x: number;
	z: number;
	rig: KeeperRig;
	ring: THREE.Mesh;
	ringMat: THREE.MeshBasicMaterial;
	alarm: THREE.MeshBasicMaterial;
	zzz: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; offset: number }[];
	jumpAt: number;
	pops: THREE.Object3D[];
}

interface RoomView {
	room: Room;
	x: number;
	z: number;
	w: number;
	d: number;
}

interface Stop {
	target: THREE.Vector3;
	dist: number;
	yaw: number;
	pitch: number;
}

export type RoomHandle = ReturnType<typeof createRoom>;

export function createRoom(
	canvas: HTMLCanvasElement | OffscreenCanvas,
	options: SceneOptions,
	world: World,
	emit: (msg: FromScene) => void
) {
	let { width, height, dpr, tier } = options;
	const { reduced } = options;

	const renderer = new THREE.WebGLRenderer({
		canvas: canvas as HTMLCanvasElement,
		antialias: true,
		alpha: true,
		powerPreference: 'high-performance'
	});
	renderer.setClearColor(0x000000, 0);
	renderer.shadowMap.type = THREE.PCFSoftShadowMap;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 120);
	const disposables: { dispose(): void }[] = [];
	const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

	// ---- 材質：靜態物件跟管理員都用頂點色 + 卡通三階光影 ----
	const ramp = keep(toonRamp());
	const toon = keep(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
	const eyeDark = keep(new THREE.MeshBasicMaterial({ color: '#1b1b26' }));
	const eyeGlow = keep(new THREE.MeshBasicMaterial({ color: '#6ff3ff' }));
	const eyeDim = keep(new THREE.MeshBasicMaterial({ color: '#3a4766' }));
	const zTex = keep(zTexture());

	// ---- 燈光：白天亮、晚上換成月光 + 房間裡的暖燈 ----
	const night = world.night;
	const hemi = new THREE.HemisphereLight('#e4ecff', '#3b3550', night ? 0.75 : 1.5);
	const sun = new THREE.DirectionalLight(night ? '#a9b8ff' : '#fff1dc', night ? 1.2 : 2.4);
	sun.position.set(-6, 12, 9);
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.bias = -0.0006;
	sun.shadow.normalBias = 0.02;
	scene.add(hemi, sun, sun.target);

	// ---- 版面：兩間房間、中間走廊、前面院子，全部放在同一塊正方形底板上 ----
	// 底板的地磚就是 QR code 的格子：平常看是拼花地板，從正上方看就是 GitHub 的 QR code
	const size = (n: number) => {
		const cols = clamp(n, 2, 3);
		const rows = Math.max(1, Math.ceil(n / cols));
		return { cols, rows, w: cols * CELL_X + 0.6, d: rows * CELL_Z + 1.5 };
	};
	const [ra, rb] = world.rooms;
	const sa = size(ra.desks.length);
	const sb = size(rb.desks.length);
	const dMax = Math.max(sa.d, sb.d);
	const weeks = Math.ceil(world.commits.length / 7);
	const carpetD = 7 * BAR + 0.7;
	// 正方形邊長：寬要放得下兩間房間 + 走廊，深要放得下房間 + 院子（地毯）
	const S = Math.max(sa.w + sb.w + GAP, dMax + carpetD + 2.4);
	const back = -S / 2;
	const rooms: RoomView[] = [
		{ room: ra, x: -S / 2 + sa.w / 2, z: back + sa.d / 2, w: sa.w, d: sa.d },
		{ room: rb, x: S / 2 - sb.w / 2, z: back + sb.d / 2, w: sb.w, d: sb.d }
	];
	const hallX = (-S / 2 + sa.w + S / 2 - sb.w) / 2;
	const carpet = weeks ? { x: 0, z: back + dMax + 0.9 + carpetD / 2, w: weeks * BAR + 0.7, d: carpetD } : null;

	// 出場動畫的物件：[物件, 延遲秒數]
	const pops: [THREE.Object3D, number][] = [];
	// 變 QR 時會壓扁融進地板的物件（家具、管理員、地毯），跟往外倒的牆
	const sinkers: [THREE.Object3D, number][] = [];
	const folds: { pivot: THREE.Object3D; axis: 'x' | 'z'; sign: number; delay: number }[] = [];
	const hits: THREE.Mesh[] = [];
	const hitGeo = keep(new THREE.BoxGeometry(1, 1, 1));
	const hitMat = keep(new THREE.MeshBasicMaterial());
	const addHit = (key: string, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
		const m = new THREE.Mesh(hitGeo, hitMat);
		m.position.set(x, y, z);
		m.scale.set(sx, sy, sz);
		m.userData.key = key;
		m.updateMatrixWorld();
		hits.push(m);
	};

	function mesh(geo: THREE.BufferGeometry) {
		keep(geo);
		const m = new THREE.Mesh(geo, toon);
		m.castShadow = true;
		m.receiveShadow = true;
		return m;
	}
	function toonPlain() {
		return keep(new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: ramp }));
	}

	// 假陰影：全部一次畫
	const blobs: THREE.Matrix4[] = [];
	const addBlob = (x: number, z: number, s: number, y = 0.06) => blobs.push(m4(x, y, z, -Math.PI / 2, 0, 0, s, s, 1));

	// ---- 底板 ----
	const board = new THREE.Group();
	scene.add(board);
	pops.push([board, 0]);
	board.add(
		mesh(
			bake([
				[box(S + 0.2, 0.3, S + 0.2), '#d9ccb2', m4(0, -0.15, 0)],
				[box(S + 0.5, 0.26, S + 0.5), '#5b4a3a', m4(0, -0.42, 0)]
			])
		)
	);

	// ---- 房間 ----
	const desks: DeskView[] = [];
	// 有首頁截圖的螢幕，場景跑起來後再一張一張換上去
	const shotQueue: [Desk, THREE.MeshBasicMaterial][] = [];
	const leds: THREE.Vector3[] = [];

	rooms.forEach((rv, ri) => {
		const kind = rv.room.host;
		const t = THEME[kind];
		const group = new THREE.Group();
		group.position.set(rv.x, 0, rv.z);
		scene.add(group);
		pops.push([group, 0.1 + ri * 0.15]);

		const { w, d } = rv;
		const outer = ri === 0 ? -1 : 1; // 外側牆在哪一邊

		// 牆壁以牆腳為軸，變 QR 時往外倒平，倒在底板外面不擋格子
		const backWall = new THREE.Group();
		backWall.position.set(0, 0, -d / 2);
		const backParts: Part[] = [
			[box(w, WALL_H, 0.2), t.wall, m4(0, WALL_H / 2, 0.1)],
			[box(w, 0.12, 0.04), t.trim, m4(0, 0.06, 0.22)],
			[box(w, 0.08, 0.26), t.trim, m4(0, WALL_H + 0.04, 0.1)]
		];
		// 機房天花板上的線槽掛在後牆上
		if (kind === 'vm') backParts.push([box(w - 0.4, 0.08, 0.3), '#56d4ff', m4(0, WALL_H - 0.15, 0.5)]);
		backWall.add(mesh(bake(backParts)));
		const sign = new THREE.Mesh(
			keep(new THREE.PlaneGeometry(2.6, 0.81)),
			keep(new THREE.MeshBasicMaterial({ map: keep(signTexture(rv.room.label, rv.room.sub, kind)), transparent: true }))
		);
		sign.position.set(0, WALL_H - 0.75, 0.205);
		backWall.add(sign);
		group.add(backWall);
		folds.push({ pivot: backWall, axis: 'x', sign: -1, delay: 0.05 + ri * 0.05 });

		const sideWall = new THREE.Group();
		sideWall.position.set((outer * w) / 2, 0, 0);
		const inward = -outer;
		const winZ = -d / 2 + Math.min(1.8, d / 2);
		sideWall.add(
			mesh(
				bake([
					[box(0.2, WALL_H, d), t.wall, m4(inward * 0.1, WALL_H / 2, 0)],
					[box(0.04, 0.12, d - 0.2), t.trim, m4(inward * 0.22, 0.06, 0.1)],
					[box(0.26, 0.08, d), t.trim, m4(inward * 0.1, WALL_H + 0.04, 0)],
					[box(0.06, 1.1, 1.3), t.trim, m4(inward * 0.21, 1.65, winZ)]
				])
			)
		);
		const win = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.1, 0.9)), keep(new THREE.MeshBasicMaterial({ map: keep(windowTexture(night)) })));
		win.position.set(inward * 0.245, 1.65, winZ);
		win.rotation.y = inward * (Math.PI / 2);
		sideWall.add(win);
		group.add(sideWall);
		folds.push({ pivot: sideWall, axis: 'z', sign: outer, delay: 0.08 + ri * 0.05 });

		// 家具擺設
		const parts: Part[] = [];
		if (kind === 'vercel') {
			// 角落一盆植物、一個書櫃
			const px = -outer * (w / 2 - 0.45);
			parts.push(
				[cyl(0.22, 0.17, 0.4), '#e07a5f', m4(px, 0.2, -d / 2 + 0.5)],
				[sphere(0.32, 10, 8), '#4caf7a', m4(px, 0.75, -d / 2 + 0.5)],
				[cone(0.24, 0.6), '#3d9a6a', m4(px + 0.1, 0.95, -d / 2 + 0.45)],
				[sphere(0.22, 10, 8), '#5cc48a', m4(px - 0.12, 1.05, -d / 2 + 0.55)]
			);
			const bx = outer * (w / 2 - 0.75);
			parts.push([box(0.9, 1.5, 0.36), '#3a3a44', m4(bx, 0.75, -d / 2 + 0.38)]);
			const books = ['#ff7a7a', '#ffd166', '#6b7cff', '#4cc9f0', '#f4f1ea', '#8b7bff'];
			for (let shelf = 0; shelf < 3; shelf++)
				for (let b = 0; b < 5; b++)
					parts.push([
						box(0.12, 0.3 + ((b * 7 + shelf) % 3) * 0.04, 0.26),
						books[(b + shelf * 2) % books.length],
						m4(bx - 0.3 + b * 0.15, 0.32 + shelf * 0.46, -d / 2 + 0.4)
					]);
			addBlob(rv.x + px, rv.z - d / 2 + 0.5, 0.9);
		} else {
			// 機房：兩座機櫃，前面有會閃的燈
			for (const side of [-1, 1]) {
				const rx = side * (w / 2 - 0.62);
				parts.push(
					[box(0.72, 1.9, 0.6), '#1b2330', m4(rx, 0.95, -d / 2 + 0.52)],
					[box(0.62, 1.7, 0.02), '#2a3546', m4(rx, 0.95, -d / 2 + 0.83)]
				);
				for (let row = 0; row < 7; row++)
					for (let col = 0; col < 3; col++)
						leds.push(new THREE.Vector3(rv.x + rx - 0.2 + col * 0.09, 0.3 + row * 0.22, rv.z - d / 2 + 0.85));
			}
		}
		const decor = mesh(bake(parts));
		group.add(decor);
		sinkers.push([decor, 0.05 + ri * 0.05]);

		// 晚上每間房間點一盞暖燈
		if (night) {
			const lamp = new THREE.PointLight('#ffcf8a', 7, 9, 1.8);
			lamp.position.set(0, WALL_H - 0.3, 0);
			group.add(lamp);
		}

		// 桌子：每張桌子 = 一個專案
		const { cols } = ri === 0 ? sa : sb;
		rv.room.desks.forEach((desk, i) => {
			const c = i % cols;
			const r = Math.floor(i / cols);
			const x = -w / 2 + 0.3 + CELL_X * (c + 0.5) - 0.35;
			const z = -d / 2 + 1.15 + CELL_Z * (r + 0.5);
			const deskGroup = new THREE.Group();
			deskGroup.position.set(x, 0, z);
			group.add(deskGroup);

			const top = 0.74;
			const deskParts: Part[] = [
				[box(1.4, 0.07, 0.72), t.desk, m4(0, top, 0)],
				[box(0.06, top, 0.06), t.leg, m4(-0.64, top / 2, -0.3)],
				[box(0.06, top, 0.06), t.leg, m4(0.64, top / 2, -0.3)],
				[box(0.06, top, 0.06), t.leg, m4(-0.64, top / 2, 0.3)],
				[box(0.06, top, 0.06), t.leg, m4(0.64, top / 2, 0.3)],
				// 螢幕外框跟腳架
				[cyl(0.03, 0.03, 0.18, 8), '#2b2d3a', m4(-0.1, top + 0.12, -0.18)],
				[box(0.26, 0.02, 0.16), '#2b2d3a', m4(-0.1, top + 0.045, -0.18)],
				[box(0.84, 0.54, 0.05), '#22243a', m4(-0.1, top + 0.45, -0.2, 0, 0.25, 0)],
				// 鍵盤、馬克杯
				[box(0.46, 0.025, 0.15), '#e9e9f0', m4(-0.05, top + 0.05, 0.14, 0, 0.25, 0)],
				[cyl(0.06, 0.055, 0.12, 10), desk.asleep ? '#ff8fa3' : '#ffd166', m4(0.48, top + 0.1, 0.1)]
			];
			deskGroup.add(mesh(bake(deskParts)));

			const screenMat = keep(new THREE.MeshBasicMaterial({ map: keep(screenTexture(desk)) }));
			const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.76, 0.475)), screenMat);
			screen.position.set(-0.1 + Math.sin(0.25) * 0.027, top + 0.45, -0.2 + Math.cos(0.25) * 0.027);
			screen.rotation.y = 0.25;
			deskGroup.add(screen);
			if (desk.shot && !desk.asleep) shotQueue.push([desk, screenMat]);

			// 桌角的警示燈：掛掉時會閃紅光
			const alarm = keep(new THREE.MeshBasicMaterial({ color: '#3a3f55' }));
			const alarmMesh = new THREE.Mesh(keep(new THREE.SphereGeometry(0.07, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2)), alarm);
			alarmMesh.position.set(0.6, top + 0.035, -0.26);
			deskGroup.add(alarmMesh);

			// 滑過去時地上亮起的圈
			const ringMat = keep(new THREE.MeshBasicMaterial({ color: kind === 'vercel' ? '#6b5cff' : '#56d4ff', transparent: true, opacity: 0, depthWrite: false }));
			const ring = new THREE.Mesh(keep(new THREE.RingGeometry(1.05, 1.18, 48)), ringMat);
			ring.rotation.x = -Math.PI / 2;
			ring.position.set(0.35, 0.065, 0.05);
			ring.visible = false;
			deskGroup.add(ring);

			const seed = ri * 10 + i;
			const variant = Math.floor(i / 3) + ri;
			const rig = buildKeeper(desk.keeper, variant, toon, desk.keeper === 'robot' ? (desk.asleep ? eyeDim : eyeGlow) : eyeDark, seed);
			rig.root.position.set(0.98, 0.05, 0.12);
			rig.root.rotation.y = -0.65;
			deskGroup.add(rig.root);

			const zzz = desk.asleep
				? [0, 1, 2].map((k) => {
						const mat = keep(new THREE.SpriteMaterial({ map: zTex, transparent: true, depthWrite: false }));
						const sprite = new THREE.Sprite(mat);
						deskGroup.add(sprite);
						return { sprite, mat, offset: k / 3 };
					})
				: [];

			const wx = rv.x + x;
			const wz = rv.z + z;
			addBlob(wx, wz, 1.7);
			addBlob(wx + 0.98, wz + 0.12, 0.75, 0.065);
			addHit(desk.key, wx + 0.35, 0.7, wz + 0.05, 2.2, 1.6, 1.5);

			desks.push({ desk, x: wx, z: wz, rig, ring, ringMat, alarm, zzz, jumpAt: -10, pops: [deskGroup] });
			pops.push([deskGroup, 0.45 + desks.length * 0.07]);
			sinkers.push([deskGroup, 0.12 + desks.length * 0.025]);
		});

		addHit(kind, rv.x, 0.05, rv.z, w, 0.1, d);
	});

	// ---- 走廊：名牌立在後面 ----
	{
		const hall = mesh(
			bake([
				[cyl(0.05, 0.05, 2.4, 8), '#2a2a30', m4(0, 1.2, 0)],
				[cyl(0.2, 0.24, 0.1, 12), '#2a2a30', m4(0, 0.1, 0)]
			])
		);
		hall.position.set(hallX, 0, back + 0.5);
		scene.add(hall);
		pops.push([hall, 0.3]);
		sinkers.push([hall, 0.02]);

		const plate = new THREE.Mesh(
			keep(new THREE.PlaneGeometry(2.4, 0.6)),
			keep(new THREE.MeshBasicMaterial({ map: keep(nameTexture(world.handle)), transparent: true, depthWrite: false }))
		);
		plate.position.set(hallX, WALL_H + 0.25, back + 0.5);
		scene.add(plate);
		pops.push([plate, 0.35]);
		sinkers.push([plate, 0]);
	}

	// ---- GitHub 提交地毯：一年 365 根柱子 ----
	let bars: THREE.InstancedMesh | null = null;
	const barHeights: number[] = [];
	if (carpet) {
		const base = mesh(bake([
				[box(carpet.w, 0.12, carpet.d), '#f4f1fa', m4(0, 0.06, 0)],
				[box(carpet.w + 0.12, 0.08, carpet.d + 0.12), '#8b7bff', m4(0, 0.04, 0)]
			]));
		base.position.set(carpet.x, 0, carpet.z);
		scene.add(base);
		pops.push([base, 0.25]);
		sinkers.push([base, 0.2]);

		const max = Math.max(1, ...world.commits);
		bars = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(BAR * 0.82, 1, BAR * 0.82)), toonPlain(), world.commits.length);
		bars.castShadow = true;
		bars.receiveShadow = true;
		world.commits.forEach((n, i) => {
			const level = n === 0 ? 0 : Math.min(4, 1 + Math.floor((n / max) * 3.999));
			barHeights.push(n === 0 ? 0.04 : 0.12 + Math.sqrt(n / max) * 1.1);
			bars!.setColorAt(i, LEVEL_COLORS[level]);
		});
		scene.add(bars);
		addHit('github', carpet.x, 0.3, carpet.z, carpet.w, 0.8, carpet.d);
	}
	const barMatrix = new THREE.Matrix4();
	/** mult：變成 QR code 時柱子縮回地毯 */
	const setBars = (time: number, mult = 1) => {
		if (!bars || !carpet) return;
		for (let i = 0; i < barHeights.length; i++) {
			const col = Math.floor(i / 7);
			const k = reduced ? 1 : popEase(clamp((time - 1.0 - col * 0.018) / 0.8, 0, 1));
			const h = Math.max(0.001, barHeights[i] * k * mult);
			barMatrix.compose(
				new THREE.Vector3(carpet.x - carpet.w / 2 + 0.35 + (col + 0.5) * BAR, 0.12 + h / 2, carpet.z - carpet.d / 2 + 0.35 + ((i % 7) + 0.5) * BAR),
				new THREE.Quaternion(),
				new THREE.Vector3(1, h, 1)
			);
			bars.setMatrixAt(i, barMatrix);
		}
		bars.instanceMatrix.needsUpdate = true;
	};
	setBars(reduced ? 99 : 0);

	// ---- 機櫃上的燈 ----
	let ledMesh: THREE.InstancedMesh | null = null;
	if (leds.length) {
		ledMesh = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(0.05, 0.05, 0.02)), keep(new THREE.MeshBasicMaterial()), leds.length);
		leds.forEach((p, i) => ledMesh!.setMatrixAt(i, m4(p.x, p.y, p.z)));
		scene.add(ledMesh);
	}
	const ledColors = [new THREE.Color('#46e39a'), new THREE.Color('#1c3a2c'), new THREE.Color('#ffc861')];
	const blinkLeds = () => {
		if (!ledMesh) return;
		for (let i = 0; i < leds.length; i++) ledMesh.setColorAt(i, ledColors[Math.random() < 0.7 ? 0 : Math.random() < 0.8 ? 1 : 2]);
		ledMesh.instanceColor!.needsUpdate = true;
	};
	blinkLeds();

	// ---- 假陰影 ----
	const blobMesh = new THREE.InstancedMesh(
		keep(new THREE.PlaneGeometry(1, 1)),
		keep(new THREE.MeshBasicMaterial({ map: keep(blobTexture()), transparent: true, depthWrite: false })),
		blobs.length
	);
	blobs.forEach((b, i) => blobMesh.setMatrixAt(i, b));
	scene.add(blobMesh);

	// ---- QR 地磚（ICQR 的做法） ----
	// 整塊底板切成 QR 的格子。平常深色格子只是淡淡的拼花，院子裡空著的深色格子長成矮樹籬；
	// 變 QR 時家具融進地板、牆往外倒，深色格子全部升起來、顏色變深，從正上方看就是 QR code
	const qrN = world.qr.size;
	const QUIET = 2; // 四周留兩格淺色，掃描器才找得到邊界
	const gridN = qrN + QUIET * 2;
	const C = S / gridN;
	type Zone = 'vercel' | 'vm' | 'hall' | 'yard';
	const zoneAt = (x: number, z: number): Zone => {
		if (z < back + sa.d && x < -S / 2 + sa.w) return 'vercel';
		if (z < back + sb.d && x > S / 2 - sb.w) return 'vm';
		return z < back + dMax ? 'hall' : 'yard';
	};
	// qr：變身後深色格子的顏色。用各區原本的色系（像 ICQR 的綠色樹葉），幾種深淺混著用；
	// 亮度要壓得夠低，跟淺色地磚的對比夠大，掃描器才讀得到
	const ZONE: Record<Zone, { light: string[]; dark: string; qr: string[] }> = {
		vercel: { light: ['#ecdfc6', '#e6d7bb', '#efe4cf'], dark: '#c8ad86', qr: ['#6e4524', '#7a4d29', '#633d1f', '#82552e'] },
		vm: { light: ['#e3e9f1', '#dce3ec', '#e8edf4'], dark: '#aebdd0', qr: ['#2a4590', '#24408a', '#33509f', '#203a7e'] },
		hall: { light: ['#e9e4ef', '#e2dcea'], dark: '#bdb4cf', qr: ['#43369a', '#4b3da6', '#3b2f8c'] },
		yard: { light: ['#f1eadb', '#ebe2cf', '#f5efe3'], dark: '#a99fd6', qr: ['#4a3aa8', '#5442b5', '#3f3196', '#4d3eae'] }
	};
	const QR_H = 0.42;
	const WHITE = new THREE.Color('#ffffff');
	interface Tile {
		x: number;
		z: number;
		dark: boolean;
		h0: number;
		c0: THREE.Color;
		c1: THREE.Color;
		delay: number;
	}
	const tiles: Tile[] = [];
	{
		let seed = 23;
		const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
		const inCarpet = (x: number, z: number) =>
			carpet !== null && Math.abs(x - carpet.x) < carpet.w / 2 + C / 2 && Math.abs(z - carpet.z) < carpet.d / 2 + C / 2;
		for (let r = 0; r < gridN; r++)
			for (let c = 0; c < gridN; c++) {
				const qr = r - QUIET;
				const qc = c - QUIET;
				const dark = qr >= 0 && qc >= 0 && qr < qrN && qc < qrN && world.qr.bits[qr * qrN + qc] === '1';
				const x = -S / 2 + (c + 0.5) * C;
				const z = back + (r + 0.5) * C;
				const zone = zoneAt(x, z);
				const theme = ZONE[zone];
				// 院子裡沒被地毯蓋住的深色格子長成高低不一的樹籬
				const hedge = dark && zone === 'yard' && !inCarpet(x, z);
				const h0 = hedge ? 0.16 + 0.22 * (Math.sin(c * 0.7 + 0.4) * Math.cos(r * 0.55) + 1) + rand() * 0.12 : 0.05;
				const c0 = new THREE.Color(dark ? theme.dark : theme.light[Math.floor(rand() * theme.light.length)]);
				if (hedge) c0.offsetHSL(0, 0, (rand() - 0.5) * 0.08);
				tiles.push({
					x,
					z,
					dark,
					h0,
					c0,
					// 淺色地磚變身時往白色提亮，晚上燈光偏暗也有足夠對比
					c1: dark ? new THREE.Color(theme.qr[Math.floor(rand() * theme.qr.length)]) : c0.clone().lerp(WHITE, 0.6),
					// 從中間往外一圈一圈升起
					delay: (Math.hypot(x, z) / (S * 0.71)) * 0.25
				});
			}
	}
	const tileMesh = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), toonPlain(), tiles.length);
	// 地磚不接收陰影：變成 QR 時旁邊升起的格子不會把淺色地磚照暗
	tileMesh.receiveShadow = false;
	const tileMatrix = new THREE.Matrix4();
	const tileColor = new THREE.Color();
	const smooth = (k: number) => k * k * (3 - 2 * k);
	function setTiles(qq: number) {
		for (let i = 0; i < tiles.length; i++) {
			const tl = tiles[i];
			// 深色格子升起、變色；淺色格子只提亮，不升高
			const k = smooth(clamp((qq - 0.3 - tl.delay) / 0.4, 0, 1));
			const h = tl.dark ? tl.h0 + (QR_H - tl.h0) * k : tl.h0;
			const w = C * (tl.dark ? 1 : 0.94);
			tileMatrix.makeScale(w, h, w).setPosition(tl.x, h / 2, tl.z);
			tileMesh.setMatrixAt(i, tileMatrix);
			tileMesh.setColorAt(i, tileColor.copy(tl.c0).lerp(tl.c1, k));
		}
		tileMesh.instanceMatrix.needsUpdate = true;
		tileMesh.instanceColor!.needsUpdate = true;
	}
	setTiles(0);
	board.add(tileMesh);

	let q = 0; // 0 = 平常的房間，1 = 正上方看 QR code
	let lastQ = 0;

	function applyQr() {
		if (Math.abs(q - lastQ) < 1e-4) return;
		lastQ = q;
		// 家具、管理員、地毯依序壓扁融進地板
		for (const [obj, delay] of sinkers) {
			const k = smooth(clamp((q - delay) / 0.4, 0, 1));
			obj.scale.set(1 + k * 0.15, Math.max(1e-4, 1 - k), 1 + k * 0.15);
			obj.visible = k < 0.999;
		}
		// 牆以牆腳為軸往外倒平
		for (const f of folds) {
			const k = smooth(clamp((q - f.delay) / 0.45, 0, 1));
			if (f.axis === 'x') f.pivot.rotation.x = (f.sign * Math.PI * k) / 2;
			else f.pivot.rotation.z = (-f.sign * Math.PI * k) / 2;
		}
		setBars(99, 1 - smooth(clamp(q / 0.35, 0, 1)));
		if (bars) bars.visible = q < 0.35;
		if (ledMesh) ledMesh.visible = q < 0.1;
		blobMesh.visible = q < 0.1;
		setTiles(q);
	}

	// 陰影範圍蓋住整塊底板
	const extent = S / 2 + 1.5;
	Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 1, far: 40 });
	sun.target.position.set(0, 0, 0);

	// ---- 鏡頭 ----
	const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
	const portrait = () => width / height < 0.9;
	// 資訊卡打開時要讓出來的空間：桌面版卡片在右邊，手機版在下面
	let panel = false;
	const panelW = () => (panel && !portrait() ? Math.min(440, width * 0.36) : 0);
	/** 讓寬 halfW、深 halfD 的範圍剛好塞進畫面（扣掉資訊卡佔掉的寬度） */
	const fitDist = (halfW: number, halfD: number) => {
		const aspect = (width - panelW()) / height;
		const byW = halfW / Math.tan(Math.atan(Math.tan(halfFov) * aspect));
		const byH = halfD / Math.tan(halfFov);
		return Math.max(byW, byH) * 1.12 + 2;
	};

	function stopFor(focus: Focus): Stop {
		if (focus === 'vercel' || focus === 'vm') {
			const rv = rooms[focus === 'vercel' ? 0 : 1];
			return { target: new THREE.Vector3(rv.x, 0.9, rv.z + 0.2), dist: fitDist(rv.w / 2 + 0.3, rv.d / 2 + 0.6), yaw: focus === 'vercel' ? 0.16 : -0.16, pitch: 0.6 };
		}
		if (focus === 'github' && carpet) {
			return { target: new THREE.Vector3(carpet.x, 0.2, carpet.z), dist: fitDist(carpet.w / 2 + 0.2, carpet.d), yaw: 0, pitch: 0.95 };
		}
		const dv = desks.find((d) => d.desk.key === focus);
		if (dv) return { target: new THREE.Vector3(dv.x + 0.4, 0.85, dv.z + 0.1), dist: fitDist(1.4, 1.2), yaw: -0.25, pitch: 0.48 };
		if (focus === 'top') {
			return { target: new THREE.Vector3(0, 0.9, back + dMax / 2 + 0.3), dist: fitDist(S / 2 + 0.3, dMax / 2 + 0.8), yaw: -0.1, pitch: 0.6 };
		}

		return {
			target: new THREE.Vector3(0, 0.4, 0),
			dist: fitDist(S / 2 + 0.3, S / 2 + 0.6),
			yaw: -0.14,
			pitch: 0.62
		};
	}

	let focus: Focus = 'all';
	// 往下滾時鏡頭沿著這條路線一路往後退，例如桌子 → 整間房間 → 上半部 → 整塊底板；
	// u 是退到哪裡（0 = 起點，ladder.length - 1 = 全景），中間的位置在兩站之間平滑內插
	let ladder: Focus[] = ['all'];
	let u = 0;
	const ladderFor = (f: Focus): Focus[] => {
		if (f === 'all') return ['all'];
		if (desks.some((d) => d.desk.key === f)) return [f, f.split(':')[0], 'top', 'all'];
		if (f === 'vercel' || f === 'vm') return [f, 'top', 'all'];
		return [f, 'all'];
	};
	function ladderGoal(): Stop {
		const i = Math.min(Math.floor(u), ladder.length - 1);
		const j = Math.min(i + 1, ladder.length - 1);
		const k = smooth(u - i);
		const a = stopFor(ladder[i]);
		const b = stopFor(ladder[j]);
		return {
			target: a.target.lerp(b.target, k),
			// 距離用對數內插，拉遠的速度看起來才均勻
			dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * k),
			yaw: a.yaw + (b.yaw - a.yaw) * k,
			pitch: a.pitch + (b.pitch - a.pitch) * k
		};
	}
	let goal = stopFor(focus);
	// QR code 的狀態：qrOn 是目標，pull 是使用者往下拉的累積量（到 1 就變身，往回推到 -1 就變回來）
	let qrOn = false;
	let pull = 0;
	let sentPull = 0;
	// 開場從高處俯衝下來
	const cam = reduced
		? { ...goal, target: goal.target.clone() }
		: { target: goal.target.clone(), dist: goal.dist * 1.7, yaw: goal.yaw + 0.7, pitch: 1.15 };
	const user = { yaw: 0, pitch: 0, zoom: 1 };
	const shift = { x: 0, y: 0 };
	// QR 模式把畫面往上推一點，下面留給說明卡
	const shiftGoal = () => (qrOn ? { x: 0, y: (QR_BOTTOM - QR_TOP) / 2 } : !panel ? { x: 0, y: 0 } : portrait() ? { x: 0, y: height * 0.24 } : { x: panelW() / 2, y: 0 });
	let lastInput = -10;

	// 變成 QR 時鏡頭轉到底板正上方，同時把視角收窄、拉遠（推拉變焦），
	// 畫面大小不變但透視被壓平，升起來的格子從上面看才會剛好對齊
	const BASE_FOV = camera.fov;
	const QR_FOV = 3.5;
	const qrTarget = new THREE.Vector3(0, QR_H, 0);
	const lookTarget = new THREE.Vector3();
	const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
	const tanHalf = (fov: number) => Math.tan(THREE.MathUtils.degToRad(fov / 2));
	// 上面的狀態列、下面的說明卡跟切換列會蓋住畫面，QR 只放在中間沒被蓋到的那段
	const QR_TOP = 72;
	const QR_BOTTOM = 170;
	/** 從正上方看，底板剛好塞進沒被蓋到的範圍時的半高 */
	const qrHalf = () => {
		const need = S / 2 + 0.35;
		const free = Math.max(0.4, (height - QR_TOP - QR_BOTTOM) / height);
		return Math.max(need / free, (need * height) / width) * 1.04;
	};

	function applyCamera(t: number) {
		const e = smooth(q);
		const idle = !reduced && t - lastInput > 5 ? Math.sin(t * 0.18) * 0.06 : 0;
		const yaw = (cam.yaw + user.yaw + idle) * (1 - e);
		const pitch = lerp(clamp(cam.pitch + user.pitch, 0.18, 1.25), Math.PI / 2 - 0.0005, e);
		const fov = lerp(BASE_FOV, QR_FOV, e);
		const half = lerp(cam.dist * user.zoom * tanHalf(BASE_FOV), qrHalf(), e);
		const r = half / tanHalf(fov);
		if (camera.fov !== fov) {
			camera.fov = fov;
			camera.near = Math.max(0.5, r - 40);
			camera.far = r + 80;
			camera.updateProjectionMatrix();
		}
		lookTarget.lerpVectors(cam.target, qrTarget, e);
		camera.position.set(
			lookTarget.x + Math.sin(yaw) * Math.cos(pitch) * r,
			lookTarget.y + Math.sin(pitch) * r,
			lookTarget.z + Math.cos(yaw) * Math.cos(pitch) * r
		);
		camera.lookAt(lookTarget);
	}

	// ---- 畫質 ----
	function applyTier() {
		renderer.setPixelRatio(Math.min(dpr, tier === 2 ? 1.75 : 1.25));
		renderer.setSize(width, height, false);
		const shadows = tier === 2;
		if (renderer.shadowMap.enabled !== shadows) {
			renderer.shadowMap.enabled = shadows;
			sun.castShadow = shadows;
			scene.traverse((o) => {
				const m = (o as THREE.Mesh).material as THREE.Material | undefined;
				if (m) m.needsUpdate = true;
			});
		}
	}
	function resize(w: number, h: number, r: number) {
		width = w;
		height = h;
		dpr = r;
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
		applyTier();
		goal = ladderGoal();
	}
	resize(width, height, dpr);

	// ---- 互動 ----
	const ray = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	const pick = (x: number, y: number): string | null => {
		if (q > 0.3) return null;
		ndc.set(x, y);
		ray.setFromCamera(ndc, camera);
		const hit = ray.intersectObjects(hits, false)[0];
		return (hit?.object.userData.key as string) ?? null;
	};
	let hovered: string | null = null;
	let selected: string | null = null;

	// ---- 動畫迴圈 ----
	let running = true;
	let disposed = false;
	let rafId = 0;
	let last = performance.now();
	const start = last;
	let introDone = reduced;
	let ledTimer = 0;
	let frames = 0;
	let loops = 0;
	let worst = 0;
	let statsAt = last;
	let sentReady = false;

	function frame(now: number) {
		if (!running) return;
		rafId = raf(frame);
		const dt = Math.min(0.05, (now - last) / 1000);
		const ms = now - last;
		last = now;
		const t = (now - start) / 1000;
		loops++;
		worst = Math.max(worst, ms);

		// 出場
		if (!introDone) {
			let all = true;
			for (const [obj, delay] of pops) {
				const k = clamp((t - delay) / 0.75, 0, 1);
				const s = popEase(k);
				obj.scale.setScalar(Math.max(0.0001, s));
				if (k < 1) all = false;
			}
			setBars(t);
			if (all && t > 1.0 + weeks * 0.018 + 0.8) {
				introDone = true;
				setBars(99);
			}
		}

		// 往下拉：拉的量會慢慢彈回去，拉夠了才變身；拉的過程鏡頭先往上轉一點當提示
		if (introDone) {
			pull = damp(pull, 0, 0.9, dt);
			if (!qrOn && pull >= 1) toggleQr(true);
			else if (qrOn && pull <= -1) toggleQr(false);
			const qGoal = qrOn ? 1 - Math.max(0, -pull) * 0.2 : Math.max(0, pull) * 0.2;
			q = Math.abs(q - qGoal) < 0.0005 ? qGoal : damp(q, qGoal, 2.2, dt);
			if (Math.abs(pull - sentPull) > 0.04 || (pull === 0) !== (sentPull === 0)) {
				sentPull = Math.abs(pull) < 0.02 ? 0 : pull;
				pull = sentPull === 0 ? 0 : pull;
				emit({ type: 'qr', on: qrOn, pull: Math.round(sentPull * 100) / 100 });
			}
			applyQr();
		}

		// 鏡頭慢慢滑向目標
		const k = 2.6;
		cam.target.x = damp(cam.target.x, goal.target.x, k, dt);
		cam.target.y = damp(cam.target.y, goal.target.y, k, dt);
		cam.target.z = damp(cam.target.z, goal.target.z, k, dt);
		cam.dist = damp(cam.dist, goal.dist, k, dt);
		cam.yaw = damp(cam.yaw, goal.yaw, k, dt);
		cam.pitch = damp(cam.pitch, goal.pitch, k, dt);
		const sg = shiftGoal();
		shift.x = damp(shift.x, sg.x, k, dt);
		shift.y = damp(shift.y, sg.y, k, dt);
		if (Math.abs(shift.x) + Math.abs(shift.y) > 0.5) camera.setViewOffset(width, height, shift.x, shift.y, width, height);
		else if (camera.view?.enabled) camera.clearViewOffset();
		applyCamera(t);

		// 管理員
		for (const dv of desks) {
			dv.rig.update(t, dt, { asleep: dv.desk.asleep, jump: t - dv.jumpAt, lookAt: -0.95 });
			const on = dv.desk.key === selected ? 0.95 : dv.desk.key === hovered ? 0.55 : 0;
			dv.ringMat.opacity = damp(dv.ringMat.opacity, on, 10, dt);
			dv.ring.visible = dv.ringMat.opacity > 0.01;
			if (dv.desk.asleep) {
				dv.alarm.color.setRGB(0.4 + 0.6 * Math.max(0, Math.sin(t * 4)), 0.1, 0.15);
				// Zzz 從頭頂往上飄、慢慢變大、淡出
				for (const z of dv.zzz) {
					const p = (t * 0.35 + z.offset) % 1;
					z.sprite.position.set(0.98 + 0.15 + p * 0.35, 1.05 + p * 0.9, 0.12 + p * 0.1);
					z.sprite.scale.setScalar(0.12 + p * 0.22);
					z.mat.opacity = Math.sin(p * Math.PI);
				}
			} else {
				dv.alarm.color.set(dv.desk.unchecked ? '#3a3f55' : '#2fbf7c');
			}
		}

		ledTimer += dt;
		if (ledTimer > 0.35) {
			ledTimer = 0;
			blinkLeds();
		}

		renderer.render(scene, camera);
		frames++;

		if (!sentReady) {
			sentReady = true;
			emit({ type: 'ready', gpu: gpuName() });
		}
		if (now - statsAt >= 1000) {
			const secs = (now - statsAt) / 1000;
			const stats: SceneStats = {
				fps: Math.round(frames / secs),
				loopFps: Math.round(loops / secs),
				worstMs: Math.round(worst),
				drawCalls: renderer.info.render.calls,
				triangles: renderer.info.render.triangles,
				tier
			};
			emit({ type: 'stats', stats });
			frames = loops = worst = 0;
			statsAt = now;
		}
	}

	function gpuName() {
		const gl = renderer.getContext();
		const ext = gl.getExtension('WEBGL_debug_renderer_info');
		return String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
	}

	function toggleQr(on: boolean) {
		qrOn = on;
		pull = sentPull = 0;
		user.yaw = user.pitch = 0;
		user.zoom = 1;
		// 剛切換完，手指或滾輪通常還在動，先忽略一下，不然一變回房間就被拉近
		lockUntil = performance.now() + 800;
		emit({ type: 'qr', on, pull: 0 });
	}
	let lockUntil = 0;

	rafId = raf(frame);

	// 截圖一張一張載，載好就換掉螢幕上的文字版；失敗就維持文字版
	(async () => {
		for (const [desk, mat] of shotQueue) {
			if (disposed) return;
			try {
				const res = await fetch(new URL(desk.shot!, globalThis.location.href));
				if (!res.ok) continue;
				const img = await createImageBitmap(await res.blob());
				if (disposed) return;
				const old = mat.map;
				mat.map = keep(shotTexture(desk, img));
				mat.needsUpdate = true;
				img.close();
				old?.dispose();
			} catch {
				// 網路斷了或圖壞了，就讓螢幕顯示文字版
			}
		}
	})();

	const PITCH_MAX = 0.5;
	// 全景再往外一點（ZOOM_OUT_ALL）之後繼續滾，才開始算「往下拉」，拉夠了變 QR
	const ZOOM_OUT_ALL = 1.12;
	// 滾輪一格大約退 0.4 站，從桌子退到全景大概 7～8 格
	const NOTCH = Math.log(1.127);
	const PER_NOTCH = 0.4;

	/** 沿著路線往後退（d > 0）或往回走（d < 0）；退到底就是全景，通知介面收起資訊卡 */
	function walk(d: number) {
		const end = ladder.length - 1;
		u = clamp(u + d, 0, end);
		goal = ladderGoal();
		if (u >= end && focus !== 'all') {
			focus = 'all';
			selected = null;
			panel = false;
			ladder = ['all'];
			u = 0;
			goal = stopFor('all');
			// 剛退到全景，先停一下，接下來的滾動才開始算「往下拉」
			lockUntil = performance.now() + 300;
			emit({ type: 'select', key: 'all' });
		}
	}
	const atStart = () => u <= 0;
	const atEnd = () => u >= ladder.length - 1;

	return {
		resize,
		orbit(dx: number, dy: number) {
			lastInput = (performance.now() - start) / 1000;
			if (performance.now() < lockUntil) return;
			if (qrOn) {
				// QR 模式：往上推變回房間
				if (dy < 0) pull += dy * 3.5;
				return;
			}
			user.yaw = clamp(user.yaw - dx * 2.2, -0.9, 0.9);
			// 視角往下轉到底還繼續拉：還沒到全景就沿路線往後退，到了全景才算「往下拉」
			const next = user.pitch + dy * 1.6;
			if (next > PITCH_MAX && introDone) {
				const over = next - Math.max(user.pitch, PITCH_MAX);
				if (!atEnd()) walk(over * 4.5);
				else pull += over * 2.4;
			}
			user.pitch = clamp(next, -0.35, PITCH_MAX);
		},
		zoom(factor: number) {
			lastInput = (performance.now() - start) / 1000;
			if (performance.now() < lockUntil) return;
			if (qrOn) {
				if (factor < 1) pull += Math.log(factor) * 3.5;
				return;
			}
			const notches = Math.log(factor) / NOTCH;
			if (notches > 0) {
				// 往下滾：先把剛剛拉近的部分退回來，再沿路線往後退，到全景後才累積「往下拉」
				if (user.zoom < 1) user.zoom = Math.min(1, user.zoom * factor);
				else if (!atEnd()) walk(notches * PER_NOTCH);
				else {
					const next = user.zoom * factor;
					if (next > ZOOM_OUT_ALL && introDone) pull += Math.log(next / Math.max(user.zoom, ZOOM_OUT_ALL)) * 4.5;
					user.zoom = Math.min(next, ZOOM_OUT_ALL);
				}
			} else {
				// 往上滾：反過來，先收掉全景多拉的那一點，再沿路線走回去，走到起點才繼續拉近
				if (user.zoom > 1) user.zoom = Math.max(1, user.zoom * factor);
				else if (!atStart()) walk(notches * PER_NOTCH);
				else user.zoom = Math.max(0.5, user.zoom * factor);
			}
		},
		hover(x: number, y: number) {
			const key = pick(x, y);
			const desk = key && desks.some((d) => d.desk.key === key) ? key : null;
			if (desk !== hovered) {
				hovered = desk;
				emit({ type: 'hover', key: hovered });
			}
		},
		click(x: number, y: number) {
			const key = pick(x, y);
			if (!key) return;
			const dv = desks.find((d) => d.desk.key === key);
			if (dv) dv.jumpAt = (performance.now() - start) / 1000;
			emit({ type: 'select', key });
		},
		focus(f: Focus, panelOpen: boolean) {
			focus = f;
			panel = panelOpen;
			selected = desks.some((d) => d.desk.key === f) ? f : null;
			// 介面因為「退到全景」回報 'all' 時路線已經重設過，不用再動鏡頭
			if (f === 'all' && ladder.length === 1) {
				goal = stopFor('all');
				return;
			}
			ladder = ladderFor(f);
			u = 0;
			goal = stopFor(f);
			// 換停靠點時，把使用者自己轉的角度慢慢歸零
			user.yaw *= 0.3;
			user.pitch *= 0.3;
			user.zoom = 1;
		},
		setQr(on: boolean) {
			if (introDone && on !== qrOn) toggleQr(on);
		},
		setTier(next: Tier) {
			tier = next;
			applyTier();
		},
		setVisible(visible: boolean) {
			if (visible === running) return;
			running = visible;
			if (visible) {
				last = performance.now();
				statsAt = last;
				frames = loops = worst = 0;
				rafId = raf(frame);
			} else caf(rafId);
		},
		dispose() {
			disposed = true;
			running = false;
			caf(rafId);
			for (const d of desks) d.rig.dispose();
			for (const d of disposables) d.dispose();
			renderer.dispose();
		}
	};
}
