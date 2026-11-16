// 兩間房間的 3D 場景本體。不碰 window / document，同一份程式可以在 Worker 或主執行緒跑
//
// 效能重點：
//   靜態的牆、地板、桌子全部合成一個 mesh；管理員每個部位一個 mesh、共用同一個頂點色材質
//   提交地毯 365 根柱子用 InstancedMesh，一次畫完；假陰影也是 InstancedMesh
//   tier 2 才開即時陰影；太卡時主執行緒會叫這裡降到 tier 1

import * as THREE from 'three';
import { bake, box, buildKeeper, cone, cyl, m4, sphere, type KeeperRig, type Part } from './keepers.js';
import type { Focus, FromScene, SceneOptions, SceneStats, Tier } from './protocol.js';
import { addDetail, PATTERN } from './detail.js';
import { blobTexture, carpetLabelTexture, nameTexture, screenTexture, shotTexture, signTexture, toonRamp, windowTexture, zTexture } from './textures.js';
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

// 室內：Vercel 是暖白粉刷牆 + 橡木地板的工作室，VM 是深藍機房 + 架高地板，玄關是暖色石地。
// wainscot 是牆下半截的護牆板，rail 是護牆板上緣那條收邊，trim 是踢腳板
interface Interior {
	wall: string;
	wainscot: string;
	rail: string;
	trim: string;
}
const THEME = {
	vercel: { wall: '#f2ebe0', wainscot: '#e3d3bc', rail: '#cdb79a', trim: '#2b2621', desk: '#b8875a', deskPattern: PATTERN.wood, leg: '#2b2621' },
	vm: { wall: '#283850', wainscot: '#1f2c40', rail: '#3a6f93', trim: '#56d4ff', desk: '#9aa7bb', deskPattern: PATTERN.plain, leg: '#1d2533' }
};
const FOYER: Interior = { wall: '#efe6d8', wainscot: '#dccab0', rail: '#b99a74', trim: '#3b302a' };
// 整棟房子外面統一一種牆色、一種牆頂收邊，兩間房間從外面看才是同一棟
const EXTERIOR = '#e6dccb';
const CAP = '#3b302a';
// 花園：外圈矮籬的綠、草叢平常的綠，跟長密之後（變成 QR 的深色格子）的深綠
const HEDGE = '#5f7f52';
const BUSH = '#6b9a5c';
const BUSH_QR = ['#24502d', '#2a5a33', '#1f4628', '#2d5f36'];
// 屋頂：淺色屋瓦要夠白，深色是深灰藍石板瓦，跟花園的深綠草叢對比都夠
const ROOF_LIGHT = '#f3eee6';
const ROOF_DARK = ['#2e3a55', '#33405c', '#29344d', '#36435f'];

// 提交花圃：剛冒芽的淡綠 → 越多越綠越高，跟 GitHub 的綠色格子同一個意思
const LEVEL_COLORS = ['#b9c79d', '#93c46f', '#62a650', '#3e8744', '#2a6633'].map((c) => new THREE.Color(c));

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
	const { reduced, fullRes = false } = options;

	const renderer = new THREE.WebGLRenderer({
		canvas: canvas as HTMLCanvasElement,
		antialias: true,
		alpha: true,
		powerPreference: 'high-performance'
	});
	renderer.setClearColor(0x000000, 0);
	renderer.shadowMap.type = THREE.PCFShadowMap; // r186 拿掉了 PCFSoftShadowMap，用了也會自動換成這個，還多一行警告

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(30, 1, 0.5, 120);
	const disposables: { dispose(): void }[] = [];
	const keep = <T extends { dispose(): void }>(x: T) => (disposables.push(x), x);

	// ---- 材質：靜態物件跟管理員都用頂點色 + 卡通三階光影 ----
	const ramp = keep(toonRamp());
	const toon = keep(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
	addDetail(toon);
	const eyeDark = keep(new THREE.MeshBasicMaterial({ color: '#1b1b26' }));
	const eyeGlow = keep(new THREE.MeshBasicMaterial({ color: '#6ff3ff' }));
	const eyeDim = keep(new THREE.MeshBasicMaterial({ color: '#3a4766' }));
	const zTex = keep(zTexture());

	// ---- 燈光：白天亮、晚上換成月光 + 房間裡的暖燈 ----
	const night = world.night;
	const hemi = new THREE.HemisphereLight(night ? '#c3cbff' : '#e4ecff', night ? '#4a3a4f' : '#3b3550', night ? 0.85 : 1.5);
	const sun = new THREE.DirectionalLight(night ? '#a9b8ff' : '#fff1dc', night ? 1.0 : 2.4);
	sun.position.set(-6, 12, 9);
	sun.shadow.mapSize.set(2048, 2048);
	sun.shadow.bias = -0.0006;
	sun.shadow.normalBias = 0.02;
	scene.add(hemi, sun, sun.target);
	// 晚上的暖燈：變成 QR 時關掉，不然燈下那一塊會被照亮，深色格子的對比不夠
	const nightLights: [THREE.PointLight, number][] = [];
	const nightLight = (l: THREE.PointLight) => (nightLights.push([l, l.intensity]), l);

	// ---- 版面：一棟有後花園的小工作室 ----
	// 後排是一棟房子：左邊 Vercel 工作室、右邊 VM 機房、中間玄關，整棟墊高一階；
	// 房子前面一條木頭露台，再往前是碎石鋪的後花園，種著一叢叢草叢，中間一塊提交花圃，外圈一圈矮籬。
	// 整塊地切成 QR code 的格子：變身時屋頂蓋回去、草叢長密，
	// 從正上方看，屋頂的深淺屋瓦加上花園裡的草叢，剛好拼成 GitHub 的 QR code
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
	const qrN = world.qr.size;
	const QUIET = 2; // 四周留兩格淺色，掃描器才找得到邊界
	const gridN = qrN + QUIET * 2;
	// 正方形邊長：寬要放得下兩間房間 + 玄關，深要放得下房子 + 露台 + 花圃
	const S = Math.max(sa.w + sb.w + GAP, dMax + carpetD + 4.4);
	const C = S / gridN;
	const back = -S / 2;
	// 房子的深度對齊格線：屋頂剛好蓋滿整數格，房子跟花園的交界才不會從一格 QR 中間切過去
	const buildRows = Math.ceil(dMax / C);
	const buildD = buildRows * C;
	const front = back + buildD;
	const deckFront = front + 2 * C; // 露台兩格寬
	const PLINTH = 0.18; // 房子墊高一階
	const rooms: RoomView[] = [
		{ room: ra, x: -S / 2 + sa.w / 2, z: back + buildD / 2, w: sa.w, d: buildD },
		{ room: rb, x: S / 2 - sb.w / 2, z: back + buildD / 2, w: sb.w, d: buildD }
	];
	const foyer = { x0: -S / 2 + sa.w, x1: S / 2 - sb.w };
	const hallX = (foyer.x0 + foyer.x1) / 2;
	const carpet = weeks ? { x: 0, z: deckFront + 0.9 + carpetD / 2, w: weeks * BAR + 0.7, d: carpetD } : null;

	// 出場動畫的物件：[物件, 延遲秒數]
	const pops: [THREE.Object3D, number][] = [];
	// 變 QR 時會壓扁收進土裡的東西（花圃跟說明牌）；房子裡的東西不用動，屋頂會蓋住
	const sinkers: [THREE.Object3D, number][] = [];
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
	// 走進去時穿不過的東西：俯視的長方形（世界座標）
	const blocks: [number, number, number, number][] = [];
	const block = (x0: number, z0: number, x1: number, z1: number) => blocks.push([Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1)]);

	// ---- 底板 ----
	const board = new THREE.Group();
	scene.add(board);
	pops.push([board, 0]);
	const RIM = 0.5; // 底板外圈留給矮籬的寬度
	const sideLen = S / 2 + RIM - front;
	board.add(
		mesh(
			bake([
				[box(S + RIM * 2, 0.3, S + RIM * 2), '#d9ccb2', m4(0, -0.15, 0)],
				[box(S + RIM * 2 + 0.3, 0.26, S + RIM * 2 + 0.3), '#5b4a3a', m4(0, -0.42, 0)],
				// 花園外圈的矮籬，把整塊地收起來；房子那一段由牆自己圍
				[box(S + RIM * 2 - 0.1, 0.36, 0.34), HEDGE, m4(0, 0.18, S / 2 + RIM / 2), PATTERN.hedge],
				[box(0.34, 0.36, sideLen), HEDGE, m4(-S / 2 - RIM / 2, 0.18, front + sideLen / 2), PATTERN.hedge],
				[box(0.34, 0.36, sideLen), HEDGE, m4(S / 2 + RIM / 2, 0.18, front + sideLen / 2), PATTERN.hedge]
			])
		)
	);

	// ---- 房子 ----
	const desks: DeskView[] = [];
	// 有首頁截圖的螢幕，場景跑起來後再一張一張換上去
	const shotQueue: [Desk, THREE.MeshBasicMaterial][] = [];
	const leds: THREE.Vector3[] = [];
	const WAIN = 0.95; // 護牆板高度
	const T = 0.2; // 牆厚
	/**
	 * 一面牆，牆腳中心在 (cx, cz)。牆有裡外兩層皮：朝房間那面是房間自己的顏色（加護牆板跟踢腳板），
	 * 另一面統一用外牆色，兩間房間從外面看才是同一棟房子。inner 是房間在哪一側（+1／-1）；
	 * origin 是牆所在群組的世界座標，用來登記走路時穿不過的範圍
	 */
	function wall(origin: [number, number], cx: number, cz: number, len: number, along: 'x' | 'z', inner: number, inside: Interior, outside = EXTERIOR): Part[] {
		const [ox, oz] = [origin[0] + cx, origin[1] + cz];
		if (along === 'x') block(ox - len / 2, oz - T / 2, ox + len / 2, oz + T / 2);
		else block(ox - T / 2, oz - len / 2, ox + T / 2, oz + len / 2);
		const at = (a: number, y: number, n: number) => (along === 'x' ? m4(cx + a, y, cz + n) : m4(cx + n, y, cz + a));
		const b = (l: number, h: number, t: number) => (along === 'x' ? box(l, h, t) : box(t, h, l));
		return [
			[b(len, WALL_H, T / 2), outside, at(0, WALL_H / 2, (-inner * T) / 4), PATTERN.plaster],
			[b(len, WALL_H, T / 2), inside.wall, at(0, WALL_H / 2, (inner * T) / 4), PATTERN.plaster],
			[b(len - 0.04, WAIN, 0.03), inside.wainscot, at(0, WAIN / 2, inner * (T / 2 + 0.015)), PATTERN.plaster],
			[b(len - 0.04, 0.05, 0.06), inside.rail, at(0, WAIN, inner * (T / 2 + 0.03))],
			[b(len - 0.04, 0.12, 0.04), inside.trim, at(0, 0.06, inner * (T / 2 + 0.02))],
			// 牆頂收邊只往兩側凸出，不往牆的兩端凸，房子前緣才不會多出一截露在屋頂外面
			[b(len, 0.08, T + 0.06), CAP, at(0, WALL_H + 0.04, 0)]
		];
	}
	/** 沿著牆腳排一列假陰影（假的環境光遮蔽）：圓形影子的中心擺在牆面上，露出來的半邊就是從牆腳往外淡掉的一條 */
	function wallShade(x0: number, z0: number, x1: number, z1: number) {
		const len = Math.hypot(x1 - x0, z1 - z0);
		for (let s = 0.3; s < len - 0.2; s += 0.55) addBlob(x0 + ((x1 - x0) * s) / len, z0 + ((z1 - z0) * s) / len, 1.1, PLINTH + 0.06);
	}

	rooms.forEach((rv, ri) => {
		const kind = rv.room.host;
		const t = THEME[kind];
		const group = new THREE.Group();
		group.position.set(rv.x, PLINTH, rv.z);
		scene.add(group);
		pops.push([group, 0.1 + ri * 0.15]);

		const { w, d } = rv;
		const outer = ri === 0 ? -1 : 1; // 外側牆在哪一邊
		const inward = -outer;

		// 後牆、外側牆，跟隔開玄關的那面牆
		const sideX = outer * (w / 2 - T / 2);
		const winZ = -d / 2 + Math.min(1.8, d / 2);
		const o: [number, number] = [rv.x, rv.z];
		const { cols, rows } = ri === 0 ? sa : sb;
		// 房子兩邊一樣深，桌子少的那間（通常是機房）桌子往前排，後面空出來的地方擺機櫃
		const spare = d - (rows * CELL_Z + 1.5);
		const deskZ0 = -d / 2 + 1.15 + (kind === 'vm' ? spare : 0);
		// 隔開玄關的那面牆開一道門，走進去時可以從玄關直接進房間。門要開在走道上，不能對著桌子：
		// 好幾排桌子就開在最後兩排中間；只有一排（機房）就開在桌子後面、機櫃前面
		const DOOR = 1.0;
		const doorZ = rows > 1 ? deskZ0 + CELL_Z * (rows - 1) : deskZ0 + CELL_Z * 0.5 - 1.3;
		const segA = doorZ - DOOR / 2 - (-d / 2 + T);
		const segB = d / 2 - (doorZ + DOOR / 2);
		const parts: Part[] = [
			...wall(o, 0, -d / 2 + T / 2, w, 'x', 1, t),
			...wall(o, sideX, T / 2, d - T, 'z', inward, t),
			...wall(o, -sideX, -d / 2 + T + segA / 2, segA, 'z', outer, t, FOYER.wall),
			...wall(o, -sideX, d / 2 - segB / 2, segB, 'z', outer, t, FOYER.wall),
			// 門楣
			[box(T, WALL_H - 2.1, DOOR), FOYER.wall, m4(-sideX, (WALL_H + 2.1) / 2, doorZ), PATTERN.plaster],
			[box(T + 0.06, 0.08, DOOR), CAP, m4(-sideX, WALL_H + 0.04, doorZ)],
			// 外側牆上的窗框
			[box(0.06, 1.1, 1.3), t.trim, m4(sideX + inward * 0.13, 1.65, winZ)]
		];
		// 機房天花板上的線槽掛在後牆上
		if (kind === 'vm') parts.push([box(w - 0.4, 0.08, 0.3), '#56d4ff', m4(0, WALL_H - 0.15, -d / 2 + 0.5)]);
		const sign = new THREE.Mesh(
			keep(new THREE.PlaneGeometry(2.6, 0.81)),
			keep(new THREE.MeshBasicMaterial({ map: keep(signTexture(rv.room.label, rv.room.sub, kind)), transparent: true }))
		);
		sign.position.set(0, WALL_H - 0.75, -d / 2 + T + 0.005);
		group.add(sign);
		const win = new THREE.Mesh(keep(new THREE.PlaneGeometry(1.1, 0.9)), keep(new THREE.MeshBasicMaterial({ map: keep(windowTexture(night)) })));
		win.position.set(sideX + inward * 0.115, 1.65, winZ);
		win.rotation.y = inward * (Math.PI / 2);
		group.add(win);
		wallShade(rv.x - w / 2, back + T + 0.02, rv.x + w / 2, back + T + 0.02);
		wallShade(rv.x + sideX + inward * 0.12, back + T, rv.x + sideX + inward * 0.12, front);
		wallShade(rv.x - sideX + outer * 0.12, back + T, rv.x - sideX + outer * 0.12, front);

		// 家具擺設
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
			parts.push([box(0.9, 1.5, 0.36), '#5a3f2c', m4(bx, 0.75, -d / 2 + 0.38), PATTERN.wood]);
			const books = ['#ff7a7a', '#ffd166', '#6b7cff', '#4cc9f0', '#f4f1ea', '#8b7bff'];
			for (let shelf = 0; shelf < 3; shelf++)
				for (let b = 0; b < 5; b++)
					parts.push([
						box(0.12, 0.3 + ((b * 7 + shelf) % 3) * 0.04, 0.26),
						books[(b + shelf * 2) % books.length],
						m4(bx - 0.3 + b * 0.15, 0.32 + shelf * 0.46, -d / 2 + 0.4)
					]);
			addBlob(rv.x + px, rv.z - d / 2 + 0.5, 0.9, PLINTH + 0.06);
			block(rv.x + px - 0.3, rv.z - d / 2, rv.x + px + 0.3, rv.z - d / 2 + 0.8);
			block(rv.x + bx - 0.45, rv.z - d / 2, rv.x + bx + 0.45, rv.z - d / 2 + 0.58);
		} else {
			// 機房：後面一排排機櫃，正面的燈會閃
			const rackRows = clamp(Math.floor((spare + 0.4) / 1.8), 1, 2);
			// 兩頭各留一條走道，走進去時才繞得到機櫃之間
			const perRow = Math.max(2, Math.floor((w - 2.0) / 0.8));
			for (let r = 0; r < rackRows; r++) {
				const rz = -d / 2 + 0.55 + r * 1.8;
				for (let i = 0; i < perRow; i++) {
					const rx = (i - (perRow - 1) / 2) * 0.8;
					parts.push([box(0.72, 1.9, 0.6), '#1b2330', m4(rx, 0.95, rz)], [box(0.62, 1.7, 0.02), '#2a3546', m4(rx, 0.95, rz + 0.31)]);
					for (let row = 0; row < 7; row++)
						for (let col = 0; col < 3; col++) leds.push(new THREE.Vector3(rv.x + rx - 0.2 + col * 0.09, PLINTH + 0.3 + row * 0.22, rv.z + rz + 0.33));
				}
				addBlob(rv.x, rv.z + rz, perRow * 0.8, PLINTH + 0.06);
				block(rv.x - perRow * 0.4, rv.z + rz - 0.32, rv.x + perRow * 0.4, rv.z + rz + 0.34);
			}
		}
		group.add(mesh(bake(parts)));

		// 晚上每間房間點一盞暖燈
		if (night) {
			const lamp = nightLight(new THREE.PointLight(kind === 'vm' ? '#9fdcff' : '#ffcf8a', 10, 10, 1.6));
			lamp.position.set(0, WALL_H - 0.3, kind === 'vm' ? d / 2 - 2 : 0);
			group.add(lamp);
		}

		// 桌子：每張桌子 = 一個專案
		rv.room.desks.forEach((desk, i) => {
			const c = i % cols;
			const r = Math.floor(i / cols);
			const x = -w / 2 + 0.3 + CELL_X * (c + 0.5) - 0.35;
			const z = deskZ0 + CELL_Z * (r + 0.5);
			const deskGroup = new THREE.Group();
			deskGroup.position.set(x, 0, z);
			group.add(deskGroup);

			const top = 0.74;
			const deskParts: Part[] = [
				[box(1.4, 0.07, 0.72), t.desk, m4(0, top, 0), t.deskPattern],
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
			addBlob(wx, wz, 1.7, PLINTH + 0.06);
			addBlob(wx + 0.98, wz + 0.12, 0.75, PLINTH + 0.065);
			addHit(desk.key, wx + 0.35, PLINTH + 0.7, wz + 0.05, 2.2, 1.6, 1.5);
			// 桌子（以桌腳為準）跟坐在旁邊的管理員；抓得剛好就好，桌子之間才留得出走道
			block(wx - 0.66, wz - 0.34, wx + 0.66, wz + 0.34);
			block(wx + 0.78, wz - 0.1, wx + 1.18, wz + 0.36);

			desks.push({ desk, x: wx, z: wz, rig, ring, ringMat, alarm, zzz, jumpAt: -10, pops: [deskGroup] });
			pops.push([deskGroup, 0.45 + desks.length * 0.07]);
		});

		addHit(kind, rv.x, PLINTH + 0.05, rv.z, w, 0.1, d);
	});

	// ---- 玄關：兩間房間中間，門口上方掛名牌 ----
	{
		const fw = foyer.x1 - foyer.x0;
		const g = new THREE.Group();
		g.position.set(hallX, PLINTH, back + buildD / 2);
		scene.add(g);
		pops.push([g, 0.3]);
		// 門口的橫樑跟名牌往裡面縮一點，整個收在屋頂底下；凸出去的話變成 QR 時從上面會看到一條深色的邊
		const fz = buildD / 2 - 0.08;
		const potX = fw / 2 - 0.45;
		g.add(
			mesh(
				bake([
					...wall([hallX, back + buildD / 2], 0, -buildD / 2 + T / 2, fw, 'x', 1, FOYER),
					// 門口上方的橫樑，兩間房間的外牆在這裡連成一片
					[box(fw, 0.6, T), EXTERIOR, m4(0, WALL_H - 0.3, fz - T / 2), PATTERN.plaster],
					[box(fw, 0.08, T), CAP, m4(0, WALL_H + 0.04, fz - T / 2)],
					[box(1.9, 0.44, 0.04), '#2b2621', m4(0, WALL_H - 0.32, fz + 0.02)],
					// 門口的地墊、兩邊各一盆植物
					[box(Math.min(1.4, fw - 0.6), 0.02, 0.7), '#9a5b44', m4(0, 0.01, fz - 0.6)],
					[cyl(0.2, 0.15, 0.36), '#d9d2c5', m4(-potX, 0.18, fz - 0.45)],
					[sphere(0.3, 10, 8), '#4caf7a', m4(-potX, 0.62, fz - 0.45)],
					[cyl(0.2, 0.15, 0.36), '#d9d2c5', m4(potX, 0.18, fz - 0.45)],
					[sphere(0.3, 10, 8), '#5cc48a', m4(potX, 0.62, fz - 0.45)]
				])
			)
		);
		const plate = new THREE.Mesh(
			keep(new THREE.PlaneGeometry(1.8, 0.45)),
			keep(new THREE.MeshBasicMaterial({ map: keep(nameTexture(world.handle)), transparent: true, depthWrite: false }))
		);
		plate.position.set(0, WALL_H - 0.32, fz + 0.045);
		g.add(plate);
		wallShade(foyer.x0, back + T + 0.02, foyer.x1, back + T + 0.02);
		addBlob(hallX - potX, back + buildD - 0.45, 0.7, PLINTH + 0.06);
		addBlob(hallX + potX, back + buildD - 0.45, 0.7, PLINTH + 0.06);
		for (const s of [-1, 1]) block(hallX + s * potX - 0.25, back + buildD - 0.8, hallX + s * potX + 0.25, back + buildD - 0.25);
	}
	// 晚上花園上空一盞暖燈，花園才不會整片灰灰的
	if (night) {
		const gardenLamp = nightLight(new THREE.PointLight('#ffd59a', 30, 16, 1.4));
		gardenLamp.position.set(0, 4.5, (deckFront + S / 2) / 2);
		scene.add(gardenLamp);
	}

	// ---- GitHub 提交花圃：一年 365 株，提交越多長越高、顏色越深 ----
	let bars: THREE.InstancedMesh | null = null;
	const barHeights: number[] = [];
	if (carpet) {
		const fx = carpet.w / 2 + 0.05;
		const fz = carpet.d / 2 + 0.05;
		const base = mesh(
			bake([
				[box(carpet.w, 0.12, carpet.d), '#6b5443', m4(0, 0.06, 0)],
				// 木頭框
				[box(carpet.w + 0.2, 0.2, 0.1), '#9a7350', m4(0, 0.1, -fz), PATTERN.wood],
				[box(carpet.w + 0.2, 0.2, 0.1), '#9a7350', m4(0, 0.1, fz), PATTERN.wood],
				[box(0.1, 0.2, carpet.d), '#9a7350', m4(-fx, 0.1, 0), PATTERN.wood],
				[box(0.1, 0.2, carpet.d), '#9a7350', m4(fx, 0.1, 0), PATTERN.wood]
			])
		);
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
		block(carpet.x - fx - 0.05, carpet.z - fz - 0.05, carpet.x + fx + 0.05, carpet.z + fz + 0.05);

		// 右上角立一塊說明牌，不然看不出這片是什麼
		const label = new THREE.Group();
		label.position.set(carpet.x + carpet.w / 2 - 1.75, 0, carpet.z - carpet.d / 2 - 0.3);
		for (const s of [-1, 1]) block(label.position.x + s * 1.1 - 0.1, label.position.z - 0.13, label.position.x + s * 1.1 + 0.1, label.position.z + 0.07);
		label.add(mesh(bake([[cyl(0.04, 0.04, 0.6, 8), '#9a7350', m4(-1.1, 0.3, -0.03)], [cyl(0.04, 0.04, 0.6, 8), '#9a7350', m4(1.1, 0.3, -0.03)]])));
		const plate = new THREE.Mesh(
			keep(new THREE.PlaneGeometry(3.3, 1.03)),
			keep(new THREE.MeshBasicMaterial({ map: keep(carpetLabelTexture(world.commits.reduce((n, c) => n + c, 0))), transparent: true }))
		);
		plate.position.set(0, 0.85, 0);
		plate.rotation.x = -0.2;
		label.add(plate);
		scene.add(label);
		pops.push([label, 0.9]);
		sinkers.push([label, 0.15]);
	}
	const barMatrix = new THREE.Matrix4();
	/** mult：變成 QR code 時花縮回土裡 */
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
	// 出場時家具一件件彈出來，影子跟著慢慢浮現，不要桌子還沒出來地上就先有黑影
	const blobMat = blobMesh.material as THREE.MeshBasicMaterial;
	blobMat.opacity = reduced ? 1 : 0;
	const lastPop = Math.max(...pops.map(([, delay]) => delay));

	// ---- QR 格子：地板、屋頂、花園 ----
	// 整塊地切成 QR 的格子（ICQR 的做法）。
	//   房子裡：地板就只是地板；變身時屋頂一排排蓋回去，屋瓦的深淺就是 QR 的格子
	//   露台跟花園：淺色格子是木板跟碎石，深色格子長成草叢，變身時長密變深綠、長到一樣高
	type Zone = 'vercel' | 'vm' | 'foyer' | 'deck' | 'garden';
	const zoneAt = (x: number, z: number): Zone => {
		if (z < front) return x < foyer.x0 ? 'vercel' : x > foyer.x1 ? 'vm' : 'foyer';
		return z < deckFront ? 'deck' : 'garden';
	};
	// light：地板或淺色格子；qr：變身後深色格子的顏色（房子裡是屋瓦，花園裡是長密的草叢），
	// 亮度要壓得夠低，跟淺色格子的對比夠大，掃描器才讀得到；
	// pattern：紋路；gap：格子之間留縫（木地板、碎石是一整片，不留）；lift：花園淺色格子變身時往白色提亮多少
	const ZONE: Record<Zone, { light: string[]; qr: string[]; pattern: number; gap: boolean; lift: number }> = {
		// 木地板的深淺交給每片木板自己變（detail.ts），格子本身只差一點點，不然會看到一塊塊方格
		vercel: { light: ['#e0c59c', '#dec39a', '#e2c79f'], qr: ROOF_DARK, pattern: PATTERN.planks, gap: false, lift: 0 },
		vm: { light: ['#7f8ca1', '#7a879c', '#8491a5'], qr: ROOF_DARK, pattern: PATTERN.panel, gap: true, lift: 0 },
		foyer: { light: ['#d9cfc0', '#d4c9b9', '#ddd4c6'], qr: ROOF_DARK, pattern: PATTERN.stone, gap: true, lift: 0 },
		deck: { light: ['#d2b48c', '#cdae86', '#d6b992'], qr: BUSH_QR, pattern: PATTERN.planks, gap: false, lift: 0.7 },
		garden: { light: ['#e9e3d6', '#e4ddcf', '#eee8dc'], qr: BUSH_QR, pattern: PATTERN.gravel, gap: false, lift: 0.6 }
	};
	const QR_H = 0.42;
	const WHITE = new THREE.Color('#ffffff');
	interface Tile {
		x: number;
		z: number;
		/** 變身時要升起來的深色格子（只有花園裡的） */
		dark: boolean;
		h0: number;
		c0: THREE.Color;
		c1: THREE.Color;
		delay: number;
		gap: boolean;
		pattern: number;
	}
	const tiles: Tile[] = [];
	/** 屋瓦：row 是從後面數來第幾排，屋頂從後面往前一排排蓋 */
	const shingles: { x: number; z: number; row: number; color: THREE.Color }[] = [];
	{
		let seed = 23;
		const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
		const pick = (a: string[]) => a[Math.floor(rand() * a.length)];
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
				const delay = (Math.hypot(x, z) / (S * 0.71)) * 0.25;
				if (r < buildRows) {
					// 房子裡：地板不帶 QR，QR 交給屋頂
					const c0 = new THREE.Color(pick(theme.light));
					tiles.push({ x, z, dark: false, h0: PLINTH + 0.05, c0, c1: c0, delay, gap: theme.gap, pattern: theme.pattern });
					shingles.push({ x, z, row: r, color: new THREE.Color(dark ? pick(theme.qr) : ROOF_LIGHT) });
					continue;
				}
				// 花圃底下的深色格子平平的藏在土下面，其他深色格子長成高低不一的草叢
				const bush = dark && !inCarpet(x, z);
				const h0 = bush ? 0.16 + 0.22 * (Math.sin(c * 0.7 + 0.4) * Math.cos(r * 0.55) + 1) + rand() * 0.12 : zone === 'deck' ? 0.1 : 0.05;
				const c0 = new THREE.Color(dark ? BUSH : pick(theme.light));
				if (bush) {
					c0.offsetHSL(0, 0, (rand() - 0.5) * 0.08);
					// 草叢走不過去，花園就像一座小迷宮；碰撞範圍比草叢小一圈，隔一格的草叢之間才鑽得過去
					block(x - C / 2 + 0.14, z - C / 2 + 0.14, x + C / 2 - 0.14, z + C / 2 - 0.14);
				}
				tiles.push({
					x,
					z,
					dark,
					h0,
					c0,
					// 淺色格子變身時往白色提亮，晚上燈光偏暗也有足夠對比
					c1: dark ? new THREE.Color(pick(theme.qr)) : c0.clone().lerp(WHITE, theme.lift),
					// 從中間往外一圈一圈升起
					delay,
					gap: theme.gap && !dark,
					pattern: bush ? PATTERN.hedge : theme.pattern
				});
			}
	}
	const tileGeo = keep(new THREE.BoxGeometry(1, 1, 1));
	tileGeo.setAttribute('pattern', new THREE.InstancedBufferAttribute(Float32Array.from(tiles, (tl) => tl.pattern), 1));
	const tileMat = toonPlain();
	const tileDetail = addDetail(tileMat);
	const tileMesh = new THREE.InstancedMesh(tileGeo, tileMat, tiles.length);
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
			// 有留縫的地磚變成 QR 時把縫合起來，掃描器比較好讀
			const w = C * (tl.gap ? 0.94 + 0.06 * k : 1);
			tileMatrix.makeScale(w, h, w).setPosition(tl.x, h / 2, tl.z);
			tileMesh.setMatrixAt(i, tileMatrix);
			tileMesh.setColorAt(i, tileColor.copy(tl.c0).lerp(tl.c1, k));
		}
		tileMesh.instanceMatrix.needsUpdate = true;
		tileMesh.instanceColor!.needsUpdate = true;
		// 紋路在格子升起之前就淡掉，變成 QR 時每一格都是乾淨的純色
		tileDetail.uDetail.value = 1 - smooth(clamp((qq - 0.15) / 0.35, 0, 1));
	}
	setTiles(0);
	board.add(tileMesh);

	// 屋頂：平常拿掉（像掀開屋頂的娃娃屋），變身時從後面往前一排排蓋回去
	const ROOF_T = 0.12;
	const ROOF_Y = PLINTH + WALL_H + 0.08 + ROOF_T / 2;
	const roofMesh = new THREE.InstancedMesh(keep(new THREE.BoxGeometry(1, 1, 1)), toonPlain(), shingles.length);
	shingles.forEach((sh, i) => roofMesh.setColorAt(i, sh.color));
	roofMesh.visible = false;
	scene.add(roofMesh);
	const roofMatrix = new THREE.Matrix4();
	// 走進去時房子要有天花板，不然抬頭就是夜空；從上面看的時候拿掉
	// 素面就好：牆面的紋路是沿著牆的方向算的，放在水平的天花板上會變成一條條波紋
	const ceiling = mesh(bake([[box(S, 0.04, buildD), '#efe8dc', m4(0, PLINTH + WALL_H + 0.02, back + buildD / 2)]]));
	ceiling.visible = false;
	scene.add(ceiling);
	function setRoof(qq: number) {
		roofMesh.visible = qq > 0.02;
		if (!roofMesh.visible) return;
		// 鏡頭在正上方，屋頂比花園的格子高，透視會讓它看起來大一點點；
		// 以畫面中心為準按比例縮回去，從上面看屋瓦跟花園的格子才對得齊
		const r = qrHalf() / tanHalf(QR_FOV);
		const f = (r - (ROOF_Y + ROOF_T / 2 - QR_H)) / r;
		for (let i = 0; i < shingles.length; i++) {
			const sh = shingles[i];
			// 鏡頭還斜斜的時候就開始蓋（往下拉一半就看得到屋瓦落下來），轉到正上方之前蓋好
			const k = smooth(clamp((qq - 0.02 - (sh.row / buildRows) * 0.22) / 0.22, 0, 1));
			if (k <= 0) roofMatrix.makeScale(0, 0, 0);
			else roofMatrix.makeScale(C * f, ROOF_T, C * f).setPosition(sh.x * f, ROOF_Y + (1 - k) * 4, sh.z * f);
			roofMesh.setMatrixAt(i, roofMatrix);
		}
		roofMesh.instanceMatrix.needsUpdate = true;
	}

	// ---- 走進去：第一人稱，WASD／搖桿走、拖曳轉頭 ----
	const EYE = 1.5; // 眼睛離地多高
	const WALK_FOV = 68;
	const R = 0.2; // 人的半徑，離牆、桌子至少這麼遠
	// 穿不過的範圍畫成 10 公分一格的地圖，走路時查表就好
	const GRID = 0.1;
	const gN = Math.ceil(S / GRID);
	let occ: Uint8Array | null = null;
	function occupancy() {
		const g = new Uint8Array(gN * gN);
		// 只標真的蓋到的格子（結尾用 ceil - 1），不然每個東西兩邊都會多胖一格，走道就被吃掉了
		const lo = (v: number) => clamp(Math.floor((v + S / 2) / GRID), 0, gN - 1);
		const hi = (v: number) => clamp(Math.ceil((v + S / 2) / GRID) - 1, 0, gN - 1);
		for (const [x0, z0, x1, z1] of blocks)
			for (let j = lo(z0 - R); j <= hi(z1 + R); j++) for (let i = lo(x0 - R); i <= hi(x1 + R); i++) g[j * gN + i] = 1;
		return g;
	}
	const walkable = (x: number, z: number) => {
		if (x < -S / 2 + R || x > S / 2 - R || z < back + R || z > S / 2 - R) return false;
		occ ??= occupancy();
		return !occ[Math.floor((z + S / 2) / GRID) * gN + Math.floor((x + S / 2) / GRID)];
	};
	/** 從 (x, z) 開始一圈圈往外找，第一個站得下的位置 */
	function freeNear(x: number, z: number) {
		for (let ring = 0; ring < 40; ring++)
			for (let a = 0; a < 16; a++) {
				const px = x + Math.cos((a / 16) * Math.PI * 2) * ring * 0.1;
				const pz = z + Math.sin((a / 16) * Math.PI * 2) * ring * 0.1;
				if (walkable(px, pz)) return { x: px, z: pz };
			}
		return { x, z };
	}
	const floorAt = (z: number) => (z < front ? PLINTH : z < deckFront ? 0.1 : 0.05);
	let walkOn = false;
	let wv = 0; // 0 = 空中的鏡頭，1 = 人的眼睛，進出時平滑過去
	/** yaw 0 是面向房子（-z），pitch 正的是抬頭 */
	const me = { x: 0, z: 0, yaw: 0, pitch: 0, eye: EYE };
	const move = { x: 0, z: 0, run: false };
	let nearKey: string | null = null;
	const eyePos = new THREE.Vector3();
	const eyeLook = new THREE.Vector3();

	function updateWalk(dt: number) {
		const len = Math.hypot(move.x, move.z);
		if (len > 0.01 && wv > 0.6) {
			const step = ((move.run ? 3.6 : 1.9) * Math.min(1, len) * dt) / len;
			const sin = Math.sin(me.yaw);
			const cos = Math.cos(me.yaw);
			const dx = (-sin * move.z + cos * move.x) * step;
			const dz = (-cos * move.z - sin * move.x) * step;
			// 撞到東西就沿著它滑過去，不要整個卡住
			if (walkable(me.x + dx, me.z + dz)) {
				me.x += dx;
				me.z += dz;
			} else if (walkable(me.x + dx, me.z)) me.x += dx;
			else if (walkable(me.x, me.z + dz)) me.z += dz;
		}
		// 跨上房子那一階時眼睛高度順順地跟上去
		me.eye = damp(me.eye, floorAt(me.z) + EYE, 10, dt);

		// 眼前兩公尺內、大致正對著的那台電腦
		let best: string | null = null;
		let bestD = 2.2;
		for (const dv of desks) {
			const vx = dv.x - 0.1 - me.x;
			const vz = dv.z - 0.2 - me.z;
			const dist = Math.hypot(vx, vz);
			// 螢幕朝 +z，人要站在螢幕前面才算，從桌子後面經過不要跳提示
			if (dist > bestD || dist < 0.01 || me.z < dv.z - 0.1) continue;
			if ((vx * -Math.sin(me.yaw) + vz * -Math.cos(me.yaw)) / dist > 0.6) {
				best = dv.desk.key;
				bestD = dist;
			}
		}
		if (best !== nearKey) {
			nearKey = best;
			emit({ type: 'near', key: nearKey });
		}
	}

	let q = 0; // 0 = 平常的房間，1 = 正上方看 QR code
	let lastQ = 0;

	function applyQr() {
		if (Math.abs(q - lastQ) < 1e-4) return;
		lastQ = q;
		// 花圃跟說明牌收進土裡；房子裡的東西不用動，屋頂會蓋住
		for (const [obj, delay] of sinkers) {
			const k = smooth(clamp((q - delay) / 0.4, 0, 1));
			obj.scale.set(1 + k * 0.15, Math.max(1e-4, 1 - k), 1 + k * 0.15);
			obj.visible = k < 0.999;
		}
		setRoof(q);
		setBars(99, 1 - smooth(clamp(q / 0.35, 0, 1)));
		if (bars) bars.visible = q < 0.35;
		if (ledMesh) ledMesh.visible = q < 0.1;
		blobMesh.visible = q < 0.1;
		const lightsOn = 1 - smooth(clamp(q / 0.4, 0, 1));
		for (const [l, base] of nightLights) l.intensity = base * lightsOn;
		// 燈關掉後晚上的 QR 偏暗，用天光補回來，淺色格子才夠白
		if (night) hemi.intensity = 0.85 + 0.9 * (1 - lightsOn);
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
		// 底板斜著看，左右實際佔的寬度比 S 大（轉了 yaw 再加上前緣離鏡頭比較近）；
		// 橫的螢幕是高度先頂到所以看不出來，直式手機會被切掉左右兩邊
		const spread = (yaw: number) => (Math.cos(yaw) + Math.abs(Math.sin(yaw))) * (portrait() ? 1.08 : 1);
		if (focus === 'top') {
			return { target: new THREE.Vector3(0, 0.9, back + buildD / 2 + 0.3), dist: fitDist((S / 2 + 0.3) * spread(-0.1), buildD / 2 + 0.8), yaw: -0.1, pitch: 0.6 };
		}

		return {
			target: new THREE.Vector3(0, 0.4, 0),
			dist: fitDist((S / 2 + 0.3) * spread(-0.14), S / 2 + 0.6),
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
	// 直式手機看房間：房間在後排、上面只有夜空，把房間往上挪一點，下面多露出一些地毯
	const shiftGoal = () =>
		qrOn
			? { x: 0, y: (QR_BOTTOM - QR_TOP) / 2 }
			: panel
				? portrait()
					? { x: 0, y: height * 0.24 }
					: { x: panelW() / 2, y: 0 }
				: portrait() && (focus === 'vercel' || focus === 'vm') && u < 0.5
					? { x: 0, y: height * 0.1 }
					: { x: 0, y: 0 };
	let lastInput = -10;

	// 變成 QR 時鏡頭轉到底板正上方，同時把視角收窄、拉遠（推拉變焦），
	// 畫面大小不變但透視被壓平，升起來的格子從上面看才會剛好對齊
	const BASE_FOV = camera.fov;
	const QR_FOV = 3.5;
	// 底板外面再留一圈，連花園外圈的矮籬一起框進來
	const QR_EDGE = RIM + 0.15;
	const qrTarget = new THREE.Vector3(0, QR_H, 0);
	const lookTarget = new THREE.Vector3();
	const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
	const tanHalf = (fov: number) => Math.tan(THREE.MathUtils.degToRad(fov / 2));
	// 上面的狀態列、下面的說明卡跟切換列會蓋住畫面，QR 只放在中間沒被蓋到的那段
	const QR_TOP = 72;
	const QR_BOTTOM = 170;
	/** 從正上方看，整塊地剛好塞進沒被蓋到的範圍時的半高 */
	const qrHalf = () => {
		const need = S / 2 + QR_EDGE;
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
		// 走進去：從空中的位置平滑移到人的眼睛，視角放寬成一般人眼的範圍
		const wk = smooth(clamp(wv, 0, 1));
		const fovNow = lerp(fov, WALK_FOV, wk);
		const near = wk > 0.01 ? 0.05 : Math.max(0.5, r - 40);
		if (camera.fov !== fovNow || camera.near !== near) {
			camera.fov = fovNow;
			camera.near = near;
			camera.far = r + 80;
			camera.updateProjectionMatrix();
		}
		lookTarget.lerpVectors(cam.target, qrTarget, e);
		camera.position.set(
			lookTarget.x + Math.sin(yaw) * Math.cos(pitch) * r,
			lookTarget.y + Math.sin(pitch) * r,
			lookTarget.z + Math.cos(yaw) * Math.cos(pitch) * r
		);
		if (wk > 0) {
			const cp = Math.cos(me.pitch);
			eyePos.set(me.x, me.eye, me.z);
			eyeLook.set(me.x - Math.sin(me.yaw) * cp, me.eye + Math.sin(me.pitch), me.z - Math.cos(me.yaw) * cp);
			camera.position.lerp(eyePos, wk);
			lookTarget.lerp(eyeLook, wk);
		}
		camera.lookAt(lookTarget);
	}

	// ---- 畫質 ----
	function applyTier() {
		renderer.setPixelRatio(Math.min(dpr, fullRes ? 3 : tier === 2 ? 1.75 : 1.25));
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
		// 屋頂的透視修正跟畫面大小有關
		setRoof(q);
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
			blobMat.opacity = clamp((t - lastPop) / 0.75, 0, 1);
			setBars(t);
			if (all && t > 1.0 + weeks * 0.018 + 0.8) finishIntro();
		}

		// 往下拉：拉的量會慢慢彈回去，拉夠了才變身；拉的過程鏡頭先往上轉一點當提示
		if (introDone) {
			pull = damp(pull, 0, 0.9, dt);
			if (!qrOn && pull >= 1) toggleQr(true);
			else if (qrOn && pull <= -1) toggleQr(false);
			const qGoal = qrOn ? 1 - Math.max(0, -pull) * 0.2 : Math.max(0, pull) * 0.2;
			q = Math.abs(q - qGoal) < 0.0005 ? qGoal : damp(q, qGoal, reduced ? 9 : 2.2, dt);
			if (Math.abs(pull - sentPull) > 0.04 || (pull === 0) !== (sentPull === 0)) {
				sentPull = Math.abs(pull) < 0.02 ? 0 : pull;
				pull = sentPull === 0 ? 0 : pull;
				emit({ type: 'qr', on: qrOn, pull: Math.round(sentPull * 100) / 100 });
			}
			applyQr();
		}

		// 鏡頭慢慢滑向目標；系統設定減少動態時改成很快就到，不要大幅度地飛過去
		const k = reduced ? 12 : 2.6;
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
		wv = damp(wv, walkOn ? 1 : 0, reduced ? 12 : 2.2, dt);
		if (walkOn) updateWalk(dt);
		ceiling.visible = walkOn && wv > 0.85;
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

	/** 出場動畫直接跳到最後：動畫還沒播完就按了 QR 時用 */
	function finishIntro() {
		for (const [obj] of pops) obj.scale.setScalar(1);
		blobMat.opacity = 1;
		setBars(99);
		introDone = true;
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

	/** 走進去／走出來。走進去時站在玄關門口，兩邊各有一道門通往兩間房間 */
	function setWalk(on: boolean) {
		if (on === walkOn) return;
		walkOn = on;
		move.x = move.z = 0;
		if (on) {
			if (qrOn) toggleQr(false);
			if (!introDone) finishIntro();
			const p = freeNear(hallX, front - 0.5);
			// 斜斜看向 Vercel 房那道門，一進來就知道可以往哪走
			Object.assign(me, { x: p.x, z: p.z, yaw: 0.55, pitch: -0.08, eye: floorAt(p.z) + EYE });
		} else {
			if (nearKey) {
				nearKey = null;
				emit({ type: 'near', key: null });
			}
			// 回到空中，接著原本的停靠點
			ladder = ladderFor(focus);
			u = 0;
			goal = stopFor(focus);
		}
	}

	return {
		resize,
		orbit(dx: number, dy: number) {
			lastInput = (performance.now() - start) / 1000;
			if (walkOn) {
				// 走進去時拖曳是轉頭：往右拖，視線往左轉（像把世界抓著往右拉）
				me.yaw += dx * 3.2;
				me.pitch = clamp(me.pitch + dy * 2.2, -1.1, 1.1);
				return;
			}
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
			if (walkOn || performance.now() < lockUntil) return;
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
			// 走進去時只有點到桌子才算，點地板不要跳出房間的資訊卡
			if (walkOn && !dv) return;
			if (dv) dv.jumpAt = (performance.now() - start) / 1000;
			emit({ type: 'select', key });
		},
		setWalk,
		/** 走路的方向：x 往右、z 往前，長度 1 是全速 */
		walkMove(x: number, z: number, run: boolean) {
			Object.assign(move, { x, z, run });
		},
		/** 按 E：看眼前那台電腦 */
		interact() {
			if (!walkOn || !nearKey) return;
			const dv = desks.find((d) => d.desk.key === nearKey);
			if (dv) dv.jumpAt = (performance.now() - start) / 1000;
			emit({ type: 'select', key: nearKey });
		},
		focus(f: Focus, panelOpen: boolean) {
			focus = f;
			panel = panelOpen;
			selected = desks.some((d) => d.desk.key === f) ? f : null;
			// 走進去時資訊卡開開關關都不動鏡頭，鏡頭是人的眼睛
			if (walkOn) return;
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
			if (on === qrOn) return;
			// 出場動畫還在播就按了 QR：直接播完再變身，不要把這次點擊吃掉
			if (!introDone) finishIntro();
			if (on) setWalk(false);
			toggleQr(on);
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
