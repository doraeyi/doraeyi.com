// 兩間房間的 3D 場景本體。不碰 window / document，同一份程式可以在 Worker 或主執行緒跑
//
// 效能重點：
//   靜態的牆、地板、桌子全部合成一個 mesh；管理員每個部位一個 mesh、共用同一個頂點色材質
//   提交果園 365 棵樹（樹幹、樹冠）各一個 InstancedMesh，一次畫完；假陰影也是 InstancedMesh
//   tier 2 才開即時陰影；太卡時主執行緒會叫這裡降到 tier 1

import * as THREE from 'three';
import { bake, box, buildKeeper, cone, cyl, m4, sphere, type KeeperRig, type Part } from './keepers.js';
import type { Focus, FromScene, SceneOptions, SceneStats, Tier } from './protocol.js';
import { addDetail, PATTERN } from './detail.js';
import type { DeskState, LiveData } from '#lib/types.js';
import {
	blobTexture,
	bubbleTexture,
	carpetLabelTexture,
	codeTexture,
	deskSignTexture,
	nameTexture,
	screenTexture,
	shotTexture,
	toonRamp,
	windowTexture,
	zTexture
} from './textures.js';
import type { Desk, Room, World } from './world.js';

const CELL_X = 2.7;
const CELL_Z = 2.5;
const WALL_H = 2.8;
const GAP = 2.4;
const BAR = 0.26;
/** 管理員坐在桌子右前方（桌子的座標系） */
const SEAT = new THREE.Vector3(0.98, 0.05, 0.12);
const SEAT_YAW = -0.65;
/** 去花園澆水的走路速度（公尺／秒） */
const WALK_SPEED = 1.5;
/** 站在樹旁邊澆多久（秒） */
const WATER_SECS = 3.4;

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
// 花園：外圈矮籬的綠、草叢的綠
const HEDGE = '#5f7f52';
const BUSH = '#6b9a5c';
// 變成 QR 時，房子淡成這個顏色的紙，當 QR 的淺色底
const PAPER = '#f3eee6';

// 提交果園：剛冒芽的淡綠 → 越多越綠越高，跟 GitHub 的綠色格子同一個意思
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
	/** 管理員整組（去花園時搬出去），在桌子的座標系裡 */
	carrier: THREE.Group;
	/** Claude 的狀態 */
	busy: DeskState | null;
	/** Claude 在做事時蓋在螢幕上的程式碼 */
	code: THREE.Mesh;
	bubble: THREE.Sprite;
	bubbleMat: THREE.SpriteMaterial;
	bubbleY: number;
	/** 正在去花園澆水的路上（null = 在位子上） */
	trip: Trip | null;
	/** 從座位走到玄關自動門內側的路線（世界座標）：走道 → 房間側門 → 玄關 → 門口 */
	exit: THREE.Vector3[];
}

/** 去花園澆今天那棵樹：沿著 path（世界座標）走過去、澆水、原路走回來 */
interface Trip {
	path: THREE.Vector3[];
	/** 每一段的長度、全長 */
	lens: number[];
	total: number;
	phase: 'go' | 'water' | 'back';
	/** 走了多遠／澆了幾秒 */
	d: number;
	/** 這次 push 了幾個 commit，樹會長大這麼多 */
	commits: number;
	/** 樹已經長大過了（再收到 push 就直接再長一次） */
	grown: boolean;
	yaw: number;
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
	const bubbleTex = [0, 1, 2].map((f) => keep(bubbleTexture('working', f)));
	const doneTex = keep(bubbleTexture('done'));
	const codeTex = keep(codeTexture());
	codeTex.repeat.set(1, 0.62);
	const codeMat = keep(new THREE.MeshBasicMaterial({ map: codeTex }));
	// 落地玻璃、自動門的玻璃：淡淡的藍，看得到裡面；變成 QR 時整片收掉，鋁框才不會在 QR 上畫出線
	const glassMat = keep(
		new THREE.MeshBasicMaterial({ color: '#d9f1ff', transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide })
	);
	const glassParts: THREE.Object3D[] = [];
	const ALU = '#aeb6bf';

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
	// 房子前面一條木頭露台，再往前是碎石鋪的後花園，種著一叢叢草叢，中間一片提交果園，外圈一圈矮籬。
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

		// 房間跟花園之間一整片落地玻璃，從外面看得到裡面；要出去得走側門、從玄關的自動門出去
		{
			const gz = d / 2 - 0.13;
			const gw = w - 2 * T;
			const pane = new THREE.Mesh(keep(new THREE.PlaneGeometry(gw, WALL_H)), glassMat);
			pane.position.set(0, WALL_H / 2, gz);
			const n = Math.max(2, Math.round(gw / 1.3));
			const frame: Part[] = [
				[box(gw, 0.07, 0.08), ALU, m4(0, 0.035, gz)],
				[box(gw, 0.07, 0.08), ALU, m4(0, WALL_H - 0.035, gz)]
			];
			for (let i = 1; i < n; i++) frame.push([box(0.05, WALL_H, 0.07), ALU, m4(-gw / 2 + (gw * i) / n, WALL_H / 2, gz)]);
			const frameMesh = mesh(bake(frame));
			group.add(pane, frameMesh);
			glassParts.push(pane, frameMesh);
			block(rv.x - w / 2, rv.z + gz - 0.1, rv.x + w / 2, rv.z + gz + 0.1);
		}

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
			// Claude 在做事時，螢幕換成一直往上捲的程式碼
			const code = new THREE.Mesh(screen.geometry, codeMat);
			code.position.copy(screen.position);
			code.rotation.copy(screen.rotation);
			code.translateZ(0.003);
			code.visible = false;
			deskGroup.add(code);

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
			const carrier = new THREE.Group();
			carrier.position.copy(SEAT);
			carrier.rotation.y = SEAT_YAW;
			carrier.add(rig.root);
			deskGroup.add(carrier);
			if (desk.work) {
				// 公司的桌子：桌角一塊三角名牌，管理員胸前掛一張識別證（去花園也戴著）
				const sign = new THREE.Mesh(
					keep(new THREE.PlaneGeometry(0.34, 0.13)),
					keep(new THREE.MeshBasicMaterial({ map: keep(deskSignTexture('公司')), transparent: true }))
				);
				sign.position.set(0.3, top + 0.1, 0.27);
				sign.rotation.set(-0.35, -0.2, 0);
				deskGroup.add(sign);
				deskGroup.add(mesh(bake([[box(0.34, 0.13, 0.01), '#2b2d3a', m4(0.3, top + 0.1, 0.262, -0.35, -0.2, 0)]])));
				const chest = desk.keeper === 'robot' ? [0.42, 0.18] : [0.3, 0.28];
				rig.root.add(
					mesh(
						bake([
							// 掛繩繞過脖子垂下來，卡片是白底、上面一條公司色
							[new THREE.TorusGeometry(0.12, 0.008, 4, 16, Math.PI), '#e2793f', m4(0, chest[0] + 0.12, chest[1] - 0.02, Math.PI, 0, 0, 1, 1.4, 1)],
							[box(0.1, 0.13, 0.012), '#ffffff', m4(0, chest[0] - 0.02, chest[1] + 0.01)],
							[box(0.1, 0.03, 0.014), '#ffc861', m4(0, chest[0] + 0.03, chest[1] + 0.012)],
							[box(0.05, 0.035, 0.014), '#9aa3b8', m4(0, chest[0] - 0.04, chest[1] + 0.012)]
						])
					)
				);
			}
			// 頭上的對話泡泡：Claude 在做事是「…」，做完了在等你是打勾
			const bubbleMat = keep(new THREE.SpriteMaterial({ map: bubbleTex[0], transparent: true, depthWrite: false }));
			const bubble = new THREE.Sprite(bubbleMat);
			const bubbleY = desk.keeper === 'robot' ? 1.62 : 1.3;
			bubble.position.set(0, bubbleY, 0);
			bubble.scale.set(0.42, 0.37, 1);
			bubble.visible = false;
			carrier.add(bubble);

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

			// 出門：往右踏到兩排桌子中間的直走道，走到側門那條橫走道，穿過側門進玄關，再走到自動門前面
			const floorY = PLINTH + SEAT.y;
			const innerX = rv.x - sideX;
			const toRoom = Math.sign(rv.x - innerX);
			const aisleZ = rv.z + doorZ;
			const lane = wx + 1.55;
			const exit = [
				new THREE.Vector3(wx + SEAT.x, floorY, wz + SEAT.z),
				new THREE.Vector3(lane, floorY, wz + 0.3),
				new THREE.Vector3(lane, floorY, aisleZ),
				new THREE.Vector3(innerX + toRoom * 0.5, floorY, aisleZ),
				new THREE.Vector3(innerX - toRoom * 0.5, floorY, aisleZ),
				new THREE.Vector3(hallX, floorY, aisleZ),
				new THREE.Vector3(hallX, floorY, front - 0.05)
			];

			desks.push({
				desk,
				exit,
				x: wx,
				z: wz,
				rig,
				ring,
				ringMat,
				alarm,
				zzz,
				jumpAt: -10,
				pops: [deskGroup],
				carrier,
				busy: null,
				code,
				bubble,
				bubbleMat,
				bubbleY,
				trip: null
			});
			pops.push([deskGroup, 0.45 + desks.length * 0.07]);
		});

		addHit(kind, rv.x, PLINTH + 0.05, rv.z, w, 0.1, d);
	});

	// ---- 玄關：兩間房間中間，門口上方掛名牌，名牌下面是玻璃自動門 ----
	/** 自動門一扇的寬 */
	const DOOR_LEAF = 0.62;
	const leaves: [THREE.Group, number][] = [];
	let sensorMat: THREE.MeshBasicMaterial | null = null;
	let doorOpen = 0;
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

		// 門口：便利商店那種玻璃自動門，名牌正下方兩扇往兩邊滑開，旁邊是固定的玻璃
		const dz = fz - T / 2;
		const doorH = WALL_H - 0.6;
		const side = fw / 2 - DOOR_LEAF;
		const fixed: Part[] = [[box(0.62, 0.1, 0.14), '#2b2d3a', m4(0, doorH - 0.07, dz + 0.12)]];
		for (const sx of [-1, 1]) {
			const pane = new THREE.Mesh(keep(new THREE.PlaneGeometry(side, doorH)), glassMat);
			pane.position.set(sx * (DOOR_LEAF + side / 2), doorH / 2, dz - 0.03);
			g.add(pane);
			glassParts.push(pane);
			fixed.push(
				[box(side, 0.07, 0.07), ALU, m4(sx * (DOOR_LEAF + side / 2), 0.035, dz - 0.03)],
				[box(0.07, doorH, 0.08), ALU, m4(sx * DOOR_LEAF, doorH / 2, dz - 0.03)]
			);
			block(hallX + sx * DOOR_LEAF, front - 0.3, hallX + sx * fw / 2, front - 0.06);
		}
		const fixedMesh = mesh(bake(fixed));
		g.add(fixedMesh);
		glassParts.push(fixedMesh);
		// 門上的感應器，有人靠近亮綠燈
		sensorMat = keep(new THREE.MeshBasicMaterial({ color: '#3a3f55' }));
		const sensor = new THREE.Mesh(keep(new THREE.BoxGeometry(0.16, 0.035, 0.02)), sensorMat);
		sensor.position.set(0, doorH - 0.07, dz + 0.2);
		g.add(sensor);
		glassParts.push(sensor);
		for (const sx of [-1, 1]) {
			const leaf = new THREE.Group();
			const pane = new THREE.Mesh(keep(new THREE.PlaneGeometry(DOOR_LEAF - 0.04, doorH - 0.08)), glassMat);
			pane.position.y = doorH / 2;
			leaf.add(
				pane,
				mesh(
					bake([
						[box(DOOR_LEAF, 0.08, 0.06), ALU, m4(0, 0.04, 0)],
						[box(DOOR_LEAF, 0.06, 0.06), ALU, m4(0, doorH - 0.03, 0)],
						[box(0.05, doorH, 0.06), ALU, m4((-sx * DOOR_LEAF) / 2, doorH / 2, 0)],
						[box(0.05, doorH, 0.06), ALU, m4((sx * DOOR_LEAF) / 2, doorH / 2, 0)],
						// 門中間的握把條
						[box(0.03, 0.5, 0.05), '#7c858f', m4((-sx * DOOR_LEAF) / 2 + sx * 0.06, 1.05, 0.02)]
					])
				)
			);
			leaf.position.set((sx * DOOR_LEAF) / 2, 0, dz + 0.04);
			g.add(leaf);
			glassParts.push(leaf);
			leaves.push([leaf, sx]);
		}
	}
	// 晚上花園上空一盞暖燈，花園才不會整片灰灰的
	if (night) {
		const gardenLamp = nightLight(new THREE.PointLight('#ffd59a', 30, 16, 1.4));
		gardenLamp.position.set(0, 4.5, (deckFront + S / 2) / 2);
		scene.add(gardenLamp);
	}

	// ---- GitHub 提交果園：一天一棵樹，提交越多長越高、樹冠越大越綠；沒提交的那天只有一小撮草 ----
	// 最後一棵是今天：push 的時候管理員會走過來澆水，樹當場長大
	let trunks: THREE.InstancedMesh | null = null;
	let crowns: THREE.InstancedMesh | null = null;
	const counts = [...world.commits];
	const today = counts.length - 1;
	// 拿今天以前最多的那天當滿分，今天多推幾次可以長得比以前都高（最多 1.4 倍）
	const maxDay = Math.max(1, ...counts.slice(0, -1));
	const treeH = (n: number) => (n === 0 ? 0 : 0.2 + Math.min(1.4, Math.sqrt(n / maxDay)) * 1.0);
	const treeLevel = (n: number) => (n === 0 ? 0 : Math.min(4, 1 + Math.floor(Math.min(1, n / maxDay) * 3.999)));
	/** 今天那棵樹長大的動畫：從 from 長到 to，at 是開始的時間 */
	const grow = { from: 0, to: 0, at: -10 };
	const treeSpot = (i: number) => {
		const col = Math.floor(i / 7);
		return new THREE.Vector3(carpet!.x - carpet!.w / 2 + 0.35 + (col + 0.5) * BAR, 0.12, carpet!.z - carpet!.d / 2 + 0.35 + ((i % 7) + 0.5) * BAR);
	};
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

		trunks = new THREE.InstancedMesh(keep(new THREE.CylinderGeometry(0.5, 0.65, 1, 6).translate(0, 0.5, 0)), toonPlain(), counts.length);
		trunks.castShadow = true;
		// 樹冠是一顆二十面體（detail 0 的法線是一面一面的），卡通光影下像低多邊形的樹
		crowns = new THREE.InstancedMesh(keep(new THREE.IcosahedronGeometry(0.5, 0)), toonPlain(), counts.length);
		crowns.castShadow = true;
		crowns.receiveShadow = true;
		const bark = new THREE.Color('#8a6242');
		counts.forEach((n, i) => {
			trunks!.setColorAt(i, bark);
			crowns!.setColorAt(i, LEVEL_COLORS[treeLevel(n)]);
		});
		scene.add(trunks, crowns);
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
	}
	const treeMatrix = new THREE.Matrix4();
	const treeQuat = new THREE.Quaternion();
	const treeScale = new THREE.Vector3();
	const UP = new THREE.Vector3(0, 1, 0);
	/** 今天那棵樹現在的大小（澆水時從 grow.from 長到 grow.to） */
	const todayH = (t: number) => {
		const k = clamp((t - grow.at) / 1.6, 0, 1);
		return k >= 1 ? treeH(counts[today]) : grow.from + (grow.to - grow.from) * popEase(k);
	};
	/** time：出場動畫的時間，一欄一欄由舊到新長出來；t：場景時間，今天那棵樹長大用 */
	const setTrees = (time: number, t = 0) => {
		if (!trunks || !crowns) return;
		for (let i = 0; i < counts.length; i++) {
			const col = Math.floor(i / 7);
			const k = reduced ? 1 : popEase(clamp((time - 1.0 - col * 0.018) / 0.8, 0, 1));
			const spot = treeSpot(i);
			treeQuat.setFromAxisAngle(UP, (i * 2.39) % (Math.PI * 2));
			const h = (i === today ? todayH(t) : treeH(counts[i])) * k;
			if (h === 0) {
				// 沒提交的那天：地上一小撮草
				treeMatrix.compose(spot.setY(0.14), treeQuat, treeScale.set(0.1 * k + 0.0001, 0.07 * k + 0.0001, 0.1 * k + 0.0001));
				crowns.setMatrixAt(i, treeMatrix);
				trunks.setMatrixAt(i, treeMatrix.makeScale(0, 0, 0));
				continue;
			}
			const level = treeLevel(counts[i]);
			const trunkH = h * 0.38;
			const crownH = h * 0.78;
			const dia = BAR * (0.72 + 0.14 * level) * Math.min(1, h / 0.5 + 0.4);
			trunks.setMatrixAt(i, treeMatrix.compose(spot, treeQuat, treeScale.set(0.05, trunkH, 0.05)));
			crowns.setMatrixAt(i, treeMatrix.compose(spot.setY(0.12 + trunkH + crownH * 0.42), treeQuat, treeScale.set(dia, crownH, dia)));
		}
		trunks.instanceMatrix.needsUpdate = true;
		crowns.instanceMatrix.needsUpdate = true;
	};
	setTrees(reduced ? 99 : 0);
	/** 今天那棵樹的樹冠頂端，水滴往這裡灑 */
	const todayTop = (t: number) => treeSpot(today).setY(0.12 + todayH(t) * 1.1);
	/** 澆完水樹長大：commits 是這次 push 了幾個 */
	const growToday = (commits: number, t: number) => {
		if (!crowns || today < 0) return;
		grow.from = todayH(t);
		counts[today] += commits;
		grow.to = treeH(counts[today]);
		grow.at = t;
		crowns.setColorAt(today, LEVEL_COLORS[treeLevel(counts[today])]);
		crowns.instanceColor!.needsUpdate = true;
	};

	// ---- 管理員去花園澆水 ----
	// 房子裡照固定路線走（DeskView.exit）：走道 → 房間側門 → 玄關 → 自動門。
	// 出了門就在 QR 的格子上找路（BFS），繞過草叢跟花圃，走到今天那棵樹的旁邊
	const V = THREE.Vector3;
	const groundY = (z: number) => (z < front ? PLINTH + SEAT.y : z < deckFront ? 0.1 : 0.05);
	const cellFree = (r: number, c: number) => {
		if (r < buildRows || r >= gridN || c < 0 || c >= gridN) return false;
		const x = -S / 2 + (c + 0.5) * C;
		const z = back + (r + 0.5) * C;
		return !blocks.some(([x0, z0, x1, z1]) => x > x0 - 0.05 && x < x1 + 0.05 && z > z0 - 0.05 && z < z1 + 0.05);
	};
	function tripPath(dv: DeskView): THREE.Vector3[] {
		const spot = treeSpot(today);
		const stand = new V(carpet!.x + carpet!.w / 2 + 0.38, 0.05, spot.z);
		const indoor = dv.exit;

		// 起點：自動門外面第一排格子裡最近的空格；終點：離站的位置最近的空格
		const cellOf = (x: number, z: number) => [Math.floor((z - back) / C), Math.floor((x + S / 2) / C)] as const;
		const nearestFree = (x: number, z: number) => {
			const [r0, c0] = cellOf(x, z);
			for (let rad = 0; rad < 4; rad++)
				for (let dr = -rad; dr <= rad; dr++)
					for (let dc = -rad; dc <= rad; dc++)
						if (Math.max(Math.abs(dr), Math.abs(dc)) === rad && cellFree(r0 + dr, c0 + dc)) return [r0 + dr, c0 + dc] as const;
			return null;
		};
		const from = nearestFree(hallX, front + C / 2);
		const to = nearestFree(stand.x, stand.z);
		const route: THREE.Vector3[] = [];
		if (from && to) {
			const id = (r: number, c: number) => r * gridN + c;
			const goal = id(...to);
			const prev = new Map<number, number>([[id(...from), -1]]);
			const queue = [id(...from)];
			for (let i = 0; i < queue.length && !prev.has(goal); i++) {
				const r = Math.floor(queue[i] / gridN);
				const c = queue[i] % gridN;
				for (const [nr, nc] of [
					[r + 1, c],
					[r - 1, c],
					[r, c + 1],
					[r, c - 1]
				])
					if (cellFree(nr, nc) && !prev.has(id(nr, nc))) {
						prev.set(id(nr, nc), queue[i]);
						queue.push(id(nr, nc));
					}
			}
			for (let k = prev.has(goal) ? goal : -1; k >= 0; k = prev.get(k)!) {
				const x = -S / 2 + ((k % gridN) + 0.5) * C;
				const z = back + (Math.floor(k / gridN) + 0.5) * C;
				route.unshift(new V(x, groundY(z), z));
			}
		}
		// 一直線上中間的點拿掉，走起來才不會一格一格頓
		return [...indoor, ...route, stand].filter((p, i, a) => {
			if (i === 0 || i === a.length - 1) return true;
			const u = p.clone().sub(a[i - 1]);
			const w = a[i + 1].clone().sub(p);
			return Math.abs(u.x * w.z - u.z * w.x) > 1e-4 || u.dot(w) < 0 || Math.abs(u.y) > 0.01;
		});
	}

	function startTrip(dv: DeskView, commits: number, t: number) {
		dv.jumpAt = t;
		if (!carpet || today < 0 || reduced) {
			// 沒有花圃（GitHub 抓不到）就跳一下；減少動態就不走過去，樹直接長大
			if (carpet && today >= 0) growToday(commits, t);
			return;
		}
		if (dv.trip) {
			if (dv.trip.grown) growToday(commits, t);
			else dv.trip.commits += commits;
			return;
		}
		const path = tripPath(dv);
		const lens = path.slice(1).map((p, i) => p.distanceTo(path[i]));
		dv.trip = { path, lens, total: lens.reduce((a, b) => a + b, 0), phase: 'go', d: 0, commits, grown: false, yaw: SEAT_YAW };
	}

	const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
	const tripPos = new THREE.Vector3();
	/** 往前走一幀；回傳管理員這一幀的動作，走回座位了回傳 null */
	function stepTrip(dv: DeskView, t: number, dt: number) {
		const tr = dv.trip!;
		let face: number;
		let water = 0;
		if (tr.phase === 'water') {
			tr.d += dt;
			tripPos.copy(tr.path[tr.path.length - 1]);
			const spot = treeSpot(today);
			face = Math.atan2(spot.x - tripPos.x, spot.z - tripPos.z);
			water = tr.d > 0.4 && tr.d < WATER_SECS - 0.5 ? 1 : 0;
			if (!tr.grown && tr.d > 1.1) {
				growToday(tr.commits, t);
				tr.grown = true;
			}
			if (tr.d >= WATER_SECS) {
				tr.phase = 'back';
				tr.d = tr.total;
			}
		} else {
			const dir = tr.phase === 'go' ? 1 : -1;
			tr.d += dir * WALK_SPEED * dt;
			if (tr.phase === 'go' && tr.d >= tr.total) {
				tr.phase = 'water';
				tr.d = 0;
			} else if (tr.phase === 'back' && tr.d <= 0) {
				dv.trip = null;
				dv.carrier.position.copy(SEAT);
				dv.carrier.rotation.y = SEAT_YAW;
				return null;
			}
			// 找出現在走在哪一段上
			let d = clamp(tr.d, 0, tr.total);
			let i = 0;
			while (i < tr.lens.length - 1 && d > tr.lens[i]) d -= tr.lens[i++];
			const a = tr.path[i];
			const b = tr.path[i + 1];
			const k = tr.lens[i] ? clamp(d / tr.lens[i], 0, 1) : 1;
			tripPos.lerpVectors(a, b, k);
			// 上下台階的那一段跳一下
			if (Math.abs(a.y - b.y) > 0.01) tripPos.y += Math.sin(Math.PI * k) * 0.14;
			face = Math.atan2((b.x - a.x) * dir, (b.z - a.z) * dir);
		}
		tr.yaw += wrapAngle(face - tr.yaw) * (1 - Math.exp(-10 * dt));
		dv.carrier.position.set(tripPos.x - dv.x, tripPos.y - PLINTH, tripPos.z - dv.z);
		dv.carrier.rotation.y = tr.yaw;
		return { walk: tr.phase === 'water' ? 0 : 1, water };
	}

	// 澆水的水滴：最多兩位管理員同時澆，一人 24 滴
	const DROPS = 24;
	const dropMesh = new THREE.InstancedMesh(
		keep(new THREE.SphereGeometry(0.022, 6, 4)),
		keep(new THREE.MeshBasicMaterial({ color: '#8fd3ff', transparent: true, opacity: 0.85 })),
		DROPS * 2
	);
	dropMesh.frustumCulled = false;
	dropMesh.visible = false;
	scene.add(dropMesh);
	const spoutPos = new THREE.Vector3();
	const dropPos = new THREE.Vector3();
	const dropM = new THREE.Matrix4();
	const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
	function setDrops(t: number) {
		let slot = 0;
		for (const dv of desks) {
			const tr = dv.trip;
			if (slot >= 2 || tr?.phase !== 'water' || tr.d < 0.5 || tr.d > WATER_SECS - 0.5) continue;
			dv.rig.spout.getWorldPosition(spoutPos);
			const top = todayTop(t);
			for (let j = 0; j < DROPS; j++) {
				const p = (t * 1.6 + j / DROPS) % 1;
				const spread = ((j * 7) % 5) / 5 - 0.4;
				dropPos.lerpVectors(spoutPos, top, p);
				dropPos.y += Math.sin(Math.PI * p) * 0.12;
				dropPos.x += spread * 0.06 * p;
				dropPos.z += spread * 0.05 * p;
				dropMesh.setMatrixAt(slot * DROPS + j, dropM.makeTranslation(dropPos.x, dropPos.y, dropPos.z));
			}
			slot++;
		}
		for (let j = slot * DROPS; j < DROPS * 2; j++) dropMesh.setMatrixAt(j, ZERO);
		dropMesh.visible = slot > 0;
		if (slot) dropMesh.instanceMatrix.needsUpdate = true;
	}

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

	// ---- 地板跟花園的格子 ----
	// 整塊地切成 QR code 的格子：露台跟花園裡，深色的格子種成草叢，
	// 所以從上面看，花園的草叢本來就排成 QR 的樣子（變身時浮起來的方塊就是從這裡長出去的）
	type Zone = 'vercel' | 'vm' | 'foyer' | 'deck' | 'garden';
	const zoneAt = (x: number, z: number): Zone => {
		if (z < front) return x < foyer.x0 ? 'vercel' : x > foyer.x1 ? 'vm' : 'foyer';
		return z < deckFront ? 'deck' : 'garden';
	};
	// light：地板的顏色；inlay：房子裡屬於 QR 深色格子的那幾格，用同一種材質深一階的顏色拼花，
	// 平常看就是地板上一片 QR 的馬賽克，變身時飛上去的就是這幾格；pattern：紋路；gap：格子之間留縫（木地板、碎石是一整片，不留）
	const ZONE: Record<Zone, { light: string[]; inlay?: string[]; pattern: number; gap: boolean }> = {
		// 木地板的深淺交給每片木板自己變（detail.ts），格子本身只差一點點，不然會看到一塊塊方格
		vercel: { light: ['#e0c59c', '#dec39a', '#e2c79f'], inlay: ['#b88b58', '#b48754', '#bb8f5c'], pattern: PATTERN.planks, gap: false },
		vm: { light: ['#7f8ca1', '#7a879c', '#8491a5'], inlay: ['#56627a', '#525e75', '#5a667e'], pattern: PATTERN.panel, gap: true },
		foyer: { light: ['#d9cfc0', '#d4c9b9', '#ddd4c6'], inlay: ['#a8998a', '#a49585', '#ac9d8e'], pattern: PATTERN.stone, gap: true },
		deck: { light: ['#d2b48c', '#cdae86', '#d6b992'], pattern: PATTERN.planks, gap: false },
		garden: { light: ['#e9e3d6', '#e4ddcf', '#eee8dc'], pattern: PATTERN.gravel, gap: false }
	};
	const qrDark = (r: number, c: number) => world.qr.bits[r * qrN + c] === '1';
	const tiles: { x: number; z: number; h: number; color: THREE.Color; gap: boolean; pattern: number }[] = [];
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
				const dark = qr >= 0 && qc >= 0 && qr < qrN && qc < qrN && qrDark(qr, qc);
				const x = -S / 2 + (c + 0.5) * C;
				const z = back + (r + 0.5) * C;
				const zone = zoneAt(x, z);
				const theme = ZONE[zone];
				if (r < buildRows) {
					const color = new THREE.Color(pick(dark && theme.inlay ? theme.inlay : theme.light));
					tiles.push({ x, z, h: PLINTH + 0.05, color, gap: theme.gap, pattern: theme.pattern });
					continue;
				}
				// 花圃底下的深色格子平平的藏在土下面，其他深色格子長成高低不一的草叢
				const bush = dark && !inCarpet(x, z);
				const h = bush ? 0.16 + 0.22 * (Math.sin(c * 0.7 + 0.4) * Math.cos(r * 0.55) + 1) + rand() * 0.12 : zone === 'deck' ? 0.1 : 0.05;
				const color = new THREE.Color(dark ? BUSH : pick(theme.light));
				if (bush) {
					color.offsetHSL(0, 0, (rand() - 0.5) * 0.08);
					// 草叢走不過去，花園就像一座小迷宮；碰撞範圍比草叢小一圈，隔一格的草叢之間才鑽得過去
					block(x - C / 2 + 0.14, z - C / 2 + 0.14, x + C / 2 - 0.14, z + C / 2 - 0.14);
				}
				tiles.push({ x, z, h, color, gap: theme.gap && !dark, pattern: bush ? PATTERN.hedge : theme.pattern });
			}
	}
	const tileGeo = keep(new THREE.BoxGeometry(1, 1, 1));
	tileGeo.setAttribute('pattern', new THREE.InstancedBufferAttribute(Float32Array.from(tiles, (tl) => tl.pattern), 1));
	const tileMat = toonPlain();
	addDetail(tileMat);
	const tileMesh = new THREE.InstancedMesh(tileGeo, tileMat, tiles.length);
	tileMesh.receiveShadow = false;
	tiles.forEach((tl, i) => {
		const w = C * (tl.gap ? 0.94 : 1);
		tileMesh.setMatrixAt(i, new THREE.Matrix4().makeScale(w, tl.h, w).setPosition(tl.x, tl.h / 2, tl.z));
		tileMesh.setColorAt(i, tl.color);
	});
	board.add(tileMesh);
	const smooth = (k: number) => k * k * (3 - 2 * k);
	const WHITE = new THREE.Color('#ffffff');
	const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

	// 走進去時房子要有天花板，不然抬頭就是夜空；從上面看的時候拿掉
	// 素面就好：牆面的紋路是沿著牆的方向算的，放在水平的天花板上會變成一條條波紋
	const ceiling = mesh(bake([[box(S, 0.04, buildD), '#efe8dc', m4(0, PLINTH + WALL_H + 0.02, back + buildD / 2)]]));
	ceiling.visible = false;
	scene.add(ceiling);

	// ---- 視角錯覺：QR code 拆成一塊塊，浮在房子上空 ----
	// QR 的深色格子拆成大大小小的方塊，散在房子上空不同的高度。
	// 每一塊都擺在「從 P 這個位置看過去」的視線上，離 P 越近就縮得越小，側面也順著視線收斜，
	// 所以只有鏡頭剛好站在 P 的時候，所有方塊才會在畫面上拼成一個平平的 QR code；
	// 換個角度看，它們就散開成一堆漂浮的方塊（像街頭的錯覺藝術）
	// 方塊從底板上的格子沿著視線往 P 拉上去，所以從 P 看，QR 剛好疊在底板上，花園的草叢也剛好藏在方塊後面
	const GROUND_Y = 0.1;
	const QR_Y = PLINTH + WALL_H + 0.4; // 方塊最低浮到這裡：比牆頂高一點，房子裡的東西不會擋到
	const QR_YAW = -0.26;
	const QR_PITCH = 0.98;
	// 底板外面再留一圈淺色，連花園外圈的矮籬一起框進來，掃描器才找得到邊界
	const QR_EDGE = RIM + 0.15;
	/** 定位角在 QR 裡的左上角格子 */
	const FINDERS = [
		[0, 0],
		[0, qrN - 7],
		[qrN - 7, 0]
	] as const;
	interface Piece {
		/** QR 裡的格子範圍：r0～r1 列、c0～c1 欄（不含 r1、c1） */
		r0: number;
		c0: number;
		r1: number;
		c1: number;
		/** 頂面離 QR 平面多高、方塊多厚（公尺） */
		top: number;
		thick: number;
		/** 飛的時候是原本地板的顏色跟紋路；對準時燒成同一個材質的深色版，掃描器才讀得到 */
		floor: THREE.Color;
		deep: THREE.Color;
		pattern: number;
		/** 什麼時候從地板拔起來（q） */
		delay: number;
		/** 飛上去的途中轉多少 */
		spin: number;
		/** 離最近的定位角多遠（0～0.7）：地板凸起、拔起來、對準時的青光，都從定位角往外擴散 */
		wave: number;
		/** 這塊是哪幾格地磚（tiles 的 index）、那幾格地磚最高多高 */
		cells: number[];
		ground: number;
	}
	const pieces: Piece[] = [];
	{
		let seed = 71;
		const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
		const used = new Uint8Array(qrN * qrN);
		const hsl = { h: 0, s: 0, l: 0 };
		const add = (r0: number, c0: number, r1: number, c1: number, top: number, thick: number) => {
			const cr = (r0 + r1) / 2;
			const cc = (c0 + c1) / 2;
			const wave = Math.min(...FINDERS.map(([fr, fc]) => Math.hypot(cr - fr - 3.5, cc - fc - 3.5))) / qrN;
			const cells: number[] = [];
			for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) cells.push((QUIET + r) * gridN + QUIET + c);
			const ground = Math.max(...cells.map((i) => tiles[i].h));
			const tl = tiles[cells[0]];
			tl.color.getHSL(hsl);
			// 深色版：同一個色相、稍微飽和一點、壓到很暗（木地板變深咖啡、草叢變深綠）；
			// 白天太陽把頂面照得很亮，要壓到這麼暗，跟淺色紙的對比才有 6:1 左右
			const deep = new THREE.Color().setHSL(hsl.h, Math.min(1, hsl.s * 1.15 + 0.05), 0.05);
			pieces.push({ r0, c0, r1, c1, top, thick, floor: tl.color, deep, pattern: tl.pattern, delay: 0.18 + wave * 0.3 + rand() * 0.08, spin: (rand() - 0.5) * 5, wave, cells, ground });
		};
		// 三個定位角：外框四條同一個高度，像一個浮在空中的相框，中間那塊浮在另一個高度
		for (const [fr, fc] of FINDERS) {
			for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) used[(fr + r) * qrN + fc + c] = 1;
			const ring = 1.4 + rand() * 3.6;
			add(fr, fc, fr + 1, fc + 7, ring, 0.3);
			add(fr + 6, fc, fr + 7, fc + 7, ring, 0.3);
			add(fr + 1, fc, fr + 6, fc + 1, ring, 0.3);
			add(fr + 1, fc + 6, fr + 6, fc + 7, ring, 0.3);
			add(fr + 2, fc + 2, fr + 5, fc + 5, Math.max(1, ring + (rand() < 0.5 ? -1 : 1) * (0.9 + rand())), 0.8);
		}
		// 其他深色格子：相鄰的併成 1～3 格寬、1～3 格高的長方塊，大小不一才像散落的碎片
		const free = (r: number, c: number) => r < qrN && c < qrN && qrDark(r, c) && !used[r * qrN + c];
		for (let r = 0; r < qrN; r++)
			for (let c = 0; c < qrN; c++) {
				if (!free(r, c)) continue;
				let w = 1;
				const maxW = 1 + Math.floor(rand() * 3);
				while (w < maxW && free(r, c + w)) w++;
				let h = 1;
				const maxH = 1 + Math.floor(rand() * 3);
				while (h < maxH && Array.from({ length: w }, (_, i) => free(r + h, c + i)).every(Boolean)) h++;
				for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) used[(r + i) * qrN + c + j] = 1;
				// 高度一半跟著一個起伏的波，一半亂數：遠看有高低的層次，近看又是散的
				const wave = 0.5 + 0.5 * Math.sin(c * 0.5 + r * 0.23 + 1.3) * Math.cos(r * 0.41 - c * 0.17);
				add(r, c, r + h, c + w, 0.6 + 6.2 * clamp(0.55 * wave + 0.45 * rand(), 0, 1), 0.2 + rand() * 0.5);
			}
	}
	/** P：鏡頭要站的那個位置；fitQr 依畫面大小算出來 */
	const qrEye = new THREE.Vector3();
	const qrCenter = new THREE.Vector3(0, GROUND_Y, 0);
	/** P 離 QR 中心多遠，跟 QR 在畫面上偏離中心多少（NDC） */
	const qrCam = { r: 30, cx: 0, cy: 0 };
	const PV = 24; // 每塊 6 面 × 4 個頂點，每一面各自的頂點，光影才是一面一面的
	/** 方塊的 6 面（頂、底、四個側面），每一面的頂點順序都是從外面看逆時針，法線才朝外 */
	const boxFaces = (T: number[][], B: number[][]) =>
		[
			[T[0], T[3], T[2], T[1]],
			[B[0], B[1], B[2], B[3]],
			[B[0], T[0], T[1], B[1]],
			[B[2], T[2], T[3], B[3]],
			[B[3], T[3], T[0], B[0]],
			[B[1], T[1], T[2], B[2]]
		].flat();
	/** 地板上的格子先凸起來多高，讓人看到 QR 的圖案藏在地板裡 */
	const BUMP = 0.12;
	/** 每塊外擴一點點，相鄰兩塊在畫面上才不會露出一條細縫 */
	const PAD = C * 0.02;
	const rectOf = (pc: Piece) => [
		-S / 2 + (QUIET + pc.c0) * C - PAD,
		back + (QUIET + pc.r0) * C - PAD,
		-S / 2 + (QUIET + pc.c1) * C + PAD,
		back + (QUIET + pc.r1) * C + PAD
	];
	// 拔起來之前的樣子：跟凸起來的那幾格地磚一模一樣，拔起來的瞬間地磚藏起來、換成方塊，看起來就是地磚本身飛上去
	const pieceGround = new Float32Array(pieces.length * PV * 3);
	const groundMid = new Float32Array(pieces.length * 3);
	pieces.forEach((pc, i) => {
		const [x0, z0, x1, z1] = rectOf(pc);
		const corners = [
			[x0 + PAD, z0 + PAD],
			[x1 - PAD, z0 + PAD],
			[x1 - PAD, z1 - PAD],
			[x0 + PAD, z1 - PAD]
		];
		boxFaces(
			corners.map(([x, z]) => [x, pc.ground + BUMP, z]),
			corners.map(([x, z]) => [x, 0, z])
		).forEach((p, v) => pieceGround.set(p, (i * PV + v) * 3));
		groundMid.set([(x0 + x1) / 2, (pc.ground + BUMP) / 2, (z0 + z1) / 2], i * 3);
	});
	const pieceFinal = new Float32Array(pieces.length * PV * 3);
	const pieceMid = new Float32Array(pieces.length * 3);
	const pieceGeo = keep(new THREE.BufferGeometry());
	const piecePos = new THREE.BufferAttribute(new Float32Array(pieces.length * PV * 3), 3).setUsage(THREE.DynamicDrawUsage);
	const pieceCol = new THREE.BufferAttribute(new Float32Array(pieces.length * PV * 3), 3).setUsage(THREE.DynamicDrawUsage);
	pieceGeo.setAttribute('position', piecePos);
	pieceGeo.setAttribute('color', pieceCol);
	// 紋路用還在地上時的位置算，飛起來之後木紋、石磚的倒角都黏在方塊上
	pieceGeo.setAttribute('rest', new THREE.BufferAttribute(pieceGround, 3));
	pieceGeo.setAttribute('pattern', new THREE.BufferAttribute(Float32Array.from({ length: pieces.length * PV }, (_, v) => pieces[Math.floor(v / PV)].pattern), 1));
	pieceGeo.setIndex(Array.from({ length: pieces.length * 6 }, (_, f) => [0, 1, 2, 0, 2, 3].map((v) => f * 4 + v)).flat());
	const pieceMat = keep(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: ramp }));
	addDetail(pieceMat, { cell: C, origin: -S / 2 });
	const pieceMesh = new THREE.Mesh(pieceGeo, pieceMat);
	pieceMesh.castShadow = true;
	pieceMesh.frustumCulled = false;
	pieceMesh.visible = false;
	scene.add(pieceMesh);

	/** 底板上 (x, z) 那一點，沿著往 P 的視線拉到離 QR_Y 高 y 的地方 */
	const toEye = (x: number, z: number, y: number) => {
		const s = (qrEye.y - QR_Y - y) / (qrEye.y - GROUND_Y);
		return [qrEye.x + (x - qrEye.x) * s, QR_Y + y, qrEye.z + (z - qrEye.z) * s];
	};
	/** 在 QR_Y 這個高度上，東西要縮多少，從 P 看才跟底板上一樣大 */
	const eyeScale = () => (qrEye.y - QR_Y) / (qrEye.y - GROUND_Y);
	/** 依 P 算出每一塊最後的形狀：底板上的那幾格，沿著往 P 的視線拉到 top 那個高度 */
	function buildPieces() {
		const at = toEye;
		pieces.forEach((pc, i) => {
			const [x0, z0, x1, z1] = rectOf(pc);
			const yb = Math.max(0.05, pc.top - pc.thick);
			const T = [at(x0, z0, pc.top), at(x1, z0, pc.top), at(x1, z1, pc.top), at(x0, z1, pc.top)];
			const B = [at(x0, z0, yb), at(x1, z0, yb), at(x1, z1, yb), at(x0, z1, yb)];
			boxFaces(T, B).forEach((p, v) => pieceFinal.set(p, (i * PV + v) * 3));
			pieceMid.set(at((x0 + x1) / 2, (z0 + z1) / 2, (pc.top + yb) / 2), i * 3);
		});
		pieceQ = -1;
		// 淺色的紙也一樣，從 P 看剛好蓋住底板加外圈
		const [wx, , wz] = toEye(0, 0, 0.01);
		wash.position.set(wx, QR_Y + 0.01, wz);
		wash.scale.setScalar(eyeScale());
		for (const m of finders) {
			const [x, , z] = toEye(m.userData.home[0], m.userData.home[1], 0.02);
			m.position.set(x, QR_Y + 0.02, z);
		}
	}
	/** 稍微衝過頭再回來的曲線 */
	const backOut = (k: number) => 1 + 2.2 * Math.pow(k - 1, 3) + 1.2 * Math.pow(k - 1, 2);
	const RISE = 0.24; // 每一塊浮上來花多少 q
	let pieceQ = -1;
	const CYAN = new THREE.Color('#22d3ee');
	const pieceColor = new THREE.Color();
	const tileMatrix = new THREE.Matrix4();
	const tileColor = new THREE.Color();
	const HIDDEN = new THREE.Matrix4().makeScale(0, 0, 0);
	/**
	 * 變身分兩步，讓人看得出方塊是從哪來的：
	 *   1. 地板上屬於 QR 深色格子的地磚、草叢先凸起來，從三個定位角往外擴散，QR 的圖案先出現在房子的地上
	 *   2. 一塊塊從地上拔起來（地上留下一個洞），帶著原本的顏色跟紋路，邊飛邊轉、拉長變形，飛到天上自己的位置
	 * 快對準時燒成深色；拖開（off）就變回地板的顏色。lockAge：對準後過了幾秒，青光從定位角擴散出去
	 */
	function setPieces(qq: number, lockAge: number, off: number) {
		if (qq !== pieceQ) {
			pieceQ = qq;
			const pos = piecePos.array as Float32Array;
			for (let i = 0; i < pieces.length; i++) {
				const pc = pieces[i];
				const bump = reduced ? 0 : smooth(clamp((qq - 0.02 - pc.wave * 0.14) / 0.06, 0, 1));
				const k = reduced ? (qq > 0.005 ? 1 : 0) : clamp((qq - pc.delay) / RISE, 0, 1);
				for (const ti of pc.cells) {
					const tl = tiles[ti];
					const w = C * (tl.gap ? 0.94 : 1);
					const h = tl.h + BUMP * bump;
					tileMesh.setMatrixAt(ti, k > 0 ? HIDDEN : tileMatrix.makeScale(w, h, w).setPosition(tl.x, h / 2, tl.z));
					tileMesh.setColorAt(ti, tileColor.copy(tl.color).lerp(WHITE, 0.12 * bump));
				}
				const o3 = i * 3;
				if (k <= 0) {
					for (let v = 0; v < PV * 3; v++) pos[i * PV * 3 + v] = v % 3 === 1 ? -50 : 0;
					continue;
				}
				// 水平位置跟形狀照著 ease 走；高度多衝過頭一點點再停住
				const ease = 1 - Math.pow(1 - k, 3);
				const mx = lerp(groundMid[o3], pieceMid[o3], ease);
				const my = lerp(groundMid[o3 + 1], pieceMid[o3 + 1], backOut(k));
				const mz = lerp(groundMid[o3 + 2], pieceMid[o3 + 2], ease);
				const a = pc.spin * 0.35 * Math.sin(Math.PI * ease);
				const cos = Math.cos(a);
				const sin = Math.sin(a);
				for (let v = 0; v < PV; v++) {
					const o = (i * PV + v) * 3;
					const dx = lerp(pieceGround[o] - groundMid[o3], pieceFinal[o] - pieceMid[o3], ease);
					const dy = lerp(pieceGround[o + 1] - groundMid[o3 + 1], pieceFinal[o + 1] - pieceMid[o3 + 1], ease);
					const dz = lerp(pieceGround[o + 2] - groundMid[o3 + 2], pieceFinal[o + 2] - pieceMid[o3 + 2], ease);
					pos[o] = mx + dx * cos + dz * sin;
					pos[o + 1] = my + dy;
					pos[o + 2] = mz - dx * sin + dz * cos;
				}
			}
			tileMesh.instanceMatrix.needsUpdate = true;
			tileMesh.instanceColor!.needsUpdate = true;
			piecePos.needsUpdate = true;
			pieceGeo.computeVertexNormals();
		}
		pieceMesh.visible = qq > 0.005;
		if (!pieceMesh.visible) return;
		// 顏色每一格都算：燒深的程度跟著 q 跟拖開的角度，對準後還有青光
		const burn = smooth(clamp((qq - 0.74) / 0.2, 0, 1)) * (1 - clamp(off * 5, 0, 1));
		const col = pieceCol.array as Float32Array;
		for (let i = 0; i < pieces.length; i++) {
			const pc = pieces[i];
			const a = lockAge - pc.wave * 0.7;
			const glow = !reduced && lockAge >= 0 && a > 0 ? 0.75 * Math.exp(-a * 5) : 0;
			pieceColor.copy(pc.floor).lerp(pc.deep, burn).lerp(CYAN, glow);
			for (let v = 0; v < PV; v++) pieceColor.toArray(col, (i * PV + v) * 3);
		}
		pieceCol.needsUpdate = true;
	}

	// 對準之後，房子淡成一張淺色的紙，只剩浮在上面的方塊是深色的，掃描器才讀得到；
	// 房子還是隱約看得到，提醒人這個 QR 是從房子拼出來的
	const washMat = keep(new THREE.MeshBasicMaterial({ color: PAPER, transparent: true, opacity: 0, depthWrite: false }));
	const wash = new THREE.Mesh(keep(new THREE.PlaneGeometry(S + QR_EDGE * 2, S + QR_EDGE * 2)), washMat);
	wash.rotation.x = -Math.PI / 2;
	wash.visible = false;
	scene.add(wash);

	// ---- 對準的瞬間：定位角亮一下、掃描框對焦 ----
	// 都畫在 QR 平面上：從 P 看，它們剛好貼著 QR 的邊
	const fx = new THREE.Group();
	scene.add(fx);
	const glowMat = (color: string, opacity = 1) => keep(new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
	const finderMat = glowMat('#22d3ee', 0);
	const ringGeo = (() => {
		const sq = 7 * C;
		const t = C * 0.9;
		const parts: Part[] = [
			[box(sq + t, 0.02, t), '#fff', m4(0, 0, -sq / 2)],
			[box(sq + t, 0.02, t), '#fff', m4(0, 0, sq / 2)],
			[box(t, 0.02, sq - t), '#fff', m4(-sq / 2, 0, 0)],
			[box(t, 0.02, sq - t), '#fff', m4(sq / 2, 0, 0)]
		];
		return keep(bake(parts));
	})();
	const finders = FINDERS.map(([r, c]) => {
		const m = new THREE.Mesh(ringGeo, finderMat);
		m.userData.home = [-S / 2 + (QUIET + c + 3.5) * C, back + (QUIET + r + 3.5) * C];
		m.visible = false;
		fx.add(m);
		return m;
	});
	// 四個角的掃描框，像手機相機對焦時的框；擺在底板外面那一圈，不壓到 QR
	const bracketMat = glowMat('#22d3ee', 0);
	const brackets = [-1, 1].flatMap((sx) =>
		[-1, 1].map((sz) => {
			const L = 2.0;
			const t = 0.18;
			const g = keep(
				bake([
					[box(L, 0.02, t), '#fff', m4((-sx * L) / 2, 0, 0)],
					[box(t, 0.02, L), '#fff', m4(0, 0, (-sz * L) / 2)]
				])
			);
			const m = new THREE.Mesh(g, bracketMat);
			m.userData.home = [sx * (S / 2 + 0.3), sz * (S / 2 + 0.3)];
			m.visible = false;
			fx.add(m);
			return m;
		})
	);
	let lockedAt = -1; // 最近一次對準的時間（秒）：變身完成，或拖開之後彈回來
	let framedAt = -1; // 變身完成的時間，掃描框只在這時收進來一次
	/** 定位角、掃描框跟著對準後的時間走；回傳對準後過了幾秒（還沒對準是 -1） */
	function setFx(qq: number, t: number) {
		const a = qrOn && qq >= 1 ? t - lockedAt : -1;
		const on = a >= 0;
		for (const m of finders) {
			m.visible = on && !reduced && a < 2.5;
			if (!m.visible) continue;
			// 亮起來時從大一圈縮回定位角上，接著慢慢淡掉
			const s = 1 + 0.45 * Math.exp(-a * 7);
			m.scale.set(s * eyeScale(), 1, s * eyeScale());
			finderMat.opacity = a < 0.12 ? a / 0.12 : Math.exp(-(a - 0.12) * 2.4);
		}
		const fa = t - framedAt;
		for (const m of brackets) {
			m.visible = on;
			if (!on) continue;
			// 從外面收進來對準，最後留著淡淡的框
			const k = reduced ? 1 : 1 - Math.pow(1 - clamp(fa / 0.45, 0, 1), 3);
			const s = 1 + (1 - k) * 0.18;
			const [x, , z] = toEye(m.userData.home[0] * s, m.userData.home[1] * s, 0.02);
			m.position.set(x, QR_Y + 0.02, z);
			m.scale.set(eyeScale(), 1, eyeScale());
			bracketMat.opacity = 0.85 * k;
		}
		return a;
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
		// 房間照常亮著，方塊浮上來時還看得到房子；晚上的暖燈在對準前關掉，
		// 不然花園上空那盞燈會把附近的方塊照亮，深淺的對比不夠
		const lightsOn = 1 - smooth(clamp((q - 0.6) / 0.35, 0, 1));
		for (const [l, base] of nightLights) l.intensity = base * lightsOn;
		if (ledMesh) ledMesh.visible = q < 0.9;
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
			? { x: (qrCam.cx * width) / 2, y: (QR_BOTTOM - QR_TOP) / 2 - (qrCam.cy * height) / 2 }
			: panel
				? portrait()
					? { x: 0, y: height * 0.24 }
					: { x: panelW() / 2, y: 0 }
				: portrait() && (focus === 'vercel' || focus === 'vm') && u < 0.5
					? { x: 0, y: height * 0.1 }
					: { x: 0, y: 0 };
	let lastInput = -10;

	const BASE_FOV = camera.fov;
	const lookTarget = new THREE.Vector3();
	// 上面的狀態列、下面的說明卡跟切換列會蓋住畫面，QR 只放在中間沒被蓋到的那段
	const QR_TOP = 72;
	const QR_BOTTOM = 170;
	const probe = new THREE.PerspectiveCamera();
	const probeV = new THREE.Vector3();
	const qrCorners = [-1, 1].flatMap((sx) => [-1, 1].map((sz) => new THREE.Vector3(sx * (S / 2 + QR_EDGE), GROUND_Y, sz * (S / 2 + QR_EDGE))));
	/** 從 QR 中心往 (yaw, pitch) 方向的單位向量 */
	const dirOf = (yaw: number, pitch: number, out: THREE.Vector3) =>
		out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
	/** 找 P：沿著 QR_YAW、QR_PITCH 的方向退到整塊 QR 剛好塞進沒被蓋到的範圍，再依 P 重排方塊 */
	function fitQr() {
		probe.fov = BASE_FOV;
		probe.aspect = width / height;
		probe.updateProjectionMatrix();
		const dir = dirOf(QR_YAW, QR_PITCH, new THREE.Vector3());
		const measure = (r: number) => {
			probe.position.copy(dir).multiplyScalar(r).add(qrCenter);
			probe.lookAt(qrCenter);
			probe.updateMatrixWorld();
			const box = [Infinity, -Infinity, Infinity, -Infinity];
			for (const c of qrCorners) {
				probeV.copy(c).project(probe);
				box[0] = Math.min(box[0], probeV.x);
				box[1] = Math.max(box[1], probeV.x);
				box[2] = Math.min(box[2], probeV.y);
				box[3] = Math.max(box[3], probeV.y);
			}
			return box;
		};
		// NDC 的寬高是 2；左右各留 16px，上下扣掉狀態列跟說明卡，再多留一點邊
		const maxW = ((width - 32) / width) * 2 * 0.96;
		const maxH = Math.max(0.4, (height - QR_TOP - QR_BOTTOM) / height) * 2 * 0.96;
		let lo = (S / 2 + QR_EDGE) * 1.5;
		let hi = 600;
		for (let i = 0; i < 40; i++) {
			const mid = (lo + hi) / 2;
			const [x0, x1, y0, y1] = measure(mid);
			if (x1 - x0 <= maxW && y1 - y0 <= maxH) hi = mid;
			else lo = mid;
		}
		const [x0, x1, y0, y1] = measure(hi);
		Object.assign(qrCam, { r: hi, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });
		qrEye.copy(dir).multiplyScalar(hi).add(qrCenter);
		buildPieces();
	}

	/**
	 * 從側邊滑到 P 的進度：先在側邊停久一點讓人看清楚一堆浮著的方塊，接著越滑越快，
	 * 在最後一刻衝進 P、衝過頭一點點再彈回來，方塊「喀」一聲拼起來
	 */
	const arrive = (qq: number) => {
		const k = clamp((qq - 0.4) / 0.48, 0, 1);
		if (qq < 0.88) return Math.pow(k, 1.8);
		const m = clamp((qq - 0.88) / 0.12, 0, 1);
		return 1 + 0.035 * Math.sin(m * Math.PI * 2) * (1 - m) * (1 - m);
	};
	// 使用者在 QR 模式拖曳時偏離 P 多少；放開就彈回去
	const peek = { yaw: 0, pitch: 0, max: 0 };
	const side = new THREE.Vector3();
	const dirNow = new THREE.Vector3();
	/** lockAge：對準後過了幾秒（還沒對準是 -1），用來讓畫面最後往前頓一下 */
	function applyCamera(t: number, lockAge = -1) {
		const idle = !reduced && t - lastInput > 5 ? Math.sin(t * 0.18) * 0.06 : 0;
		let yaw = cam.yaw + user.yaw + idle;
		let pitch = clamp(cam.pitch + user.pitch, 0.18, 1.25);
		let r = cam.dist * user.zoom;
		lookTarget.copy(cam.target);
		// 變身的運鏡：先繞到側邊、壓低（看得到一堆方塊從房子裡浮上來），再滑到 P，方塊在最後一刻拼成 QR
		// 一開始鏡頭先不動，讓人看到地板上的 QR 圖案浮現、地磚開始被拔起來
		const a = reduced ? 0 : smooth(clamp((q - 0.1) / 0.4, 0, 1));
		const b = reduced ? smooth(q) : arrive(q);
		if (a > 0) {
			side.set(0, QR_Y + 1.2, 0);
			yaw = lerp(yaw, QR_YAW + 1.6, a);
			pitch = lerp(pitch, 0.32, a);
			r = lerp(r, qrCam.r * 0.8, a);
			lookTarget.lerp(side, a);
		}
		if (b !== 0) {
			yaw = lerp(yaw, QR_YAW + peek.yaw, b);
			pitch = lerp(pitch, QR_PITCH + peek.pitch, b);
			r = lerp(r, qrCam.r, b);
			lookTarget.lerp(qrCenter, b);
		}
		// 對焦鎖定：用視角往前頓一下（鏡頭位置不動，方塊才不會又錯開）
		const punch = lockAge >= 0 && !reduced ? 1 - 0.05 * Math.exp(-lockAge * 4) * Math.sin(lockAge * 11) : 1;
		// 走進去：從空中的位置平滑移到人的眼睛，視角放寬成一般人眼的範圍
		const wk = smooth(clamp(wv, 0, 1));
		const fovNow = lerp(BASE_FOV * punch, WALK_FOV, wk);
		const near = wk > 0.01 ? 0.05 : Math.max(0.5, r - 50);
		if (camera.fov !== fovNow || camera.near !== near) {
			camera.fov = fovNow;
			camera.near = near;
			camera.far = r + 80;
			camera.updateProjectionMatrix();
		}
		camera.position.copy(lookTarget).addScaledVector(dirOf(yaw, pitch, dirNow), r);
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
		// P 跟畫面大小有關：畫面變了，P 跟方塊的位置都要重算
		fitQr();
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
	/** 演過的 push 裡最大的 id；-1 是還沒收過即時狀態 */
	let seenPush = -1;
	/** push 對到哪位管理員：網站上有那個專案就是它，沒有就依 repo 名稱固定挑一位 */
	function deskForPush(key: string | null, repo: string) {
		const hit = key ? desks.find((d) => d.desk.key === key) : undefined;
		if (hit || !desks.length) return hit ?? null;
		let h = 0;
		for (const ch of repo) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
		return desks[h % desks.length];
	}
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
			setTrees(t);
			if (all && t > 1.0 + weeks * 0.018 + 0.8) finishIntro();
		}

		// 往下拉：拉的量會慢慢彈回去，拉夠了才變身；拉的過程鏡頭先往上轉一點當提示
		if (introDone) {
			pull = damp(pull, 0, 0.9, dt);
			if (!qrOn && pull >= 1) toggleQr(true);
			else if (qrOn && pull <= -1) toggleQr(false);
			const qGoal = qrOn ? 1 - Math.max(0, -pull) * 0.2 : Math.max(0, pull) * 0.2;
			// 變身是一段固定長度的動畫（約 3.4 秒，變回去 1.6 秒），等速往前走，每一段效果自己決定快慢；
			// 往下拉一半的預覽也走同一條時間軸，所以拉的時候就看得到方塊開始浮上來
			const rate = reduced ? 1 / 0.6 : qGoal > q ? 1 / 3.4 : 1 / 1.6;
			// 用實際經過的時間走（一格最多 0.25 秒），不用 dt：算圖很慢的機器（或 CI 的軟體算圖）一秒只有幾格，
			// dt 被壓在 0.05 秒的話變身會拖上好幾十秒；寧可跳格，也要在 3.4 秒左右拼好
			const qStep = rate * Math.min(0.25, ms / 1000);
			const wasDone = q >= 1;
			q = Math.abs(qGoal - q) <= qStep ? qGoal : q + Math.sign(qGoal - q) * qStep;
			if (q >= 1 && !wasDone) lockedAt = framedAt = t;
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
		// QR 模式拖開之後放手：彈回 P，對準的那一刻再亮一次
		if (t - lastInput > 0.12) {
			peek.yaw = damp(peek.yaw, 0, 7, dt);
			peek.pitch = damp(peek.pitch, 0, 7, dt);
		}
		const off = Math.hypot(peek.yaw, peek.pitch);
		peek.max = Math.max(peek.max, off);
		if (off < 0.008 && peek.max > 0.12) {
			peek.max = 0;
			if (qrOn && q >= 1) lockedAt = t;
		}
		const lockAge = setFx(q, t);
		setPieces(q, off < 0.008 ? lockAge : -1, off);
		// 拖開的時候房子淡回來一點，看得出這些方塊是浮在房子上面的
		washMat.opacity = 0.8 * smooth(clamp((q - 0.8) / 0.2, 0, 1)) * (1 - 0.6 * clamp(off * 4, 0, 1));
		wash.visible = washMat.opacity > 0.005;
		applyCamera(t, off < 0.008 ? lockAge : -1);

		// 今天那棵樹正在長大
		if (t - grow.at < 1.7) setTrees(99, t);
		// Claude 在做事的螢幕：程式碼一直往上捲
		codeTex.offset.y = (-t * 0.08) % 1;

		// 管理員
		for (const dv of desks) {
			const act = dv.trip && introDone ? stepTrip(dv, t, dt) : null;
			dv.rig.update(t, dt, {
				asleep: dv.desk.asleep,
				jump: t - dv.jumpAt,
				lookAt: -0.95,
				busy: dv.busy,
				walk: act?.walk ?? 0,
				carry: dv.trip !== null,
				water: act?.water ?? 0
			});
			dv.code.visible = dv.busy === 'working';
			// 泡泡：在位子上才冒，一上一下輕輕飄
			dv.bubble.visible = dv.busy !== null && !dv.trip;
			if (dv.bubble.visible) {
				dv.bubbleMat.map = dv.busy === 'working' ? bubbleTex[Math.floor(t * 3) % 3] : doneTex;
				dv.bubble.position.y = dv.bubbleY + Math.sin(t * 2.2 + dv.x) * 0.03;
			}
			const on = dv.desk.key === selected ? 0.95 : dv.desk.key === hovered ? 0.55 : 0;
			dv.ringMat.opacity = damp(dv.ringMat.opacity, on, 10, dt);
			dv.ring.visible = dv.ringMat.opacity > 0.01;
			for (const z of dv.zzz) z.sprite.visible = !dv.trip;
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

		setDrops(t);

		// 自動門：管理員或走進去的自己靠近門口就打開，走遠了慢慢關上
		{
			const doorZ = front - 0.2;
			let someone = walkOn && Math.hypot(me.x - hallX, me.z - doorZ) < 1.8;
			for (const dv of desks)
				if (dv.trip && Math.hypot(dv.carrier.position.x + dv.x - hallX, dv.carrier.position.z + dv.z - doorZ) < 1.6) someone = true;
			doorOpen = damp(doorOpen, someone ? 1 : 0, someone ? 7 : 2.5, dt);
			for (const [leaf, sx] of leaves) leaf.position.x = sx * (DOOR_LEAF / 2 + doorOpen * DOOR_LEAF * 0.92);
			sensorMat?.color.set(someone ? '#46e39a' : '#3a3f55');
			const showGlass = q < 0.15;
			for (const gp of glassParts) gp.visible = showGlass;
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
		setTrees(99);
		introDone = true;
	}

	function toggleQr(on: boolean) {
		qrOn = on;
		pull = sentPull = 0;
		user.yaw = user.pitch = 0;
		user.zoom = 1;
		peek.yaw = peek.pitch = peek.max = 0;
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
				// QR 模式：左右拖、往下拖會離開 P，方塊散開、看得出是立體的，放手就彈回來；往上推變回房間
				peek.yaw = clamp(peek.yaw - dx * 2.2, -0.9, 0.9);
				if (dy > 0) peek.pitch = clamp(peek.pitch - dy * 1.6, -0.6, 0);
				else pull += dy * 3.5;
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
		/** 即時狀態：Claude 在做哪些專案、有沒有新的 push */
		setLive(live: LiveData) {
			for (const dv of desks) dv.busy = live.desks[dv.desk.key] ?? null;
			const t = (performance.now() - start) / 1000;
			const first = seenPush < 0;
			const went = new Set<DeskView>();
			for (const p of live.pushes) {
				if (p.id <= seenPush) continue;
				seenPush = p.id;
				// 剛打開網頁時只補演五分鐘內的 push，一位管理員走一趟就好
				if (first && live.at - p.at > 5 * 60 * 1000) continue;
				const dv = deskForPush(p.key, p.repo);
				if (!dv || (first && went.has(dv))) continue;
				went.add(dv);
				startTrip(dv, p.commits, t);
			}
			if (first) seenPush = Math.max(seenPush, 0);
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
