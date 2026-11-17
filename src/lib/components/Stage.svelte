<script lang="ts">
	// 3D 房間的總管：選模式、轉送輸入、太卡就降畫質
	//   worker：WebGL 在 Web Worker 跑（OffscreenCanvas），主執行緒只處理版面跟手勢
	//   main：瀏覽器不支援 OffscreenCanvas 時，在主執行緒跑同一份場景
	//   list：沒有 WebGL，或降到最低畫質還是跑不動，改用一般清單
	// 可以用 ?scene=worker|main|list 強制指定，方便測試
	import { onMount } from 'svelte';
	import { sceneInfo, type SceneMode } from '#lib/room/stats.svelte.js';
	import type { Focus, FromScene, SceneOptions, Tier, ToScene } from '#lib/room/protocol.js';
	import type { World } from '#lib/room/world.js';
	import type { LiveData } from '#lib/types.js';

	interface Props {
		world: World;
		focus: Focus;
		panel: boolean;
		/** 要不要顯示 GitHub QR code（切換列上的按鈕） */
		qr: boolean;
		/** 場景回報 QR 狀態：拉到一半、變身完成、變回房間 */
		onqr: (on: boolean, pull: number) => void;
		onselect: (key: string) => void;
		onmode: (mode: SceneMode) => void;
		/** 走進去（第一人稱，WASD／搖桿走） */
		walk: boolean;
		/** 走進去時眼前正對著哪張桌子 */
		onnear: (key: string | null) => void;
		/** 即時狀態：Claude 在做哪些專案、最近的 push */
		live: LiveData | null;
	}
	let { world, focus, panel, qr, onselect, onqr, onmode, walk, onnear, live }: Props = $props();

	let canvas = $state<HTMLCanvasElement>();
	let ready = $state(false);
	let hovering = $state(false);
	let send: (msg: ToScene) => void = () => {};

	function hasWebGL() {
		try {
			const c = document.createElement('canvas');
			return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
		} catch {
			return false;
		}
	}

	function chooseMode(): { mode: SceneMode; reason: string; forced: boolean } {
		const forced = new URLSearchParams(location.search).get('scene');
		if (forced === 'worker' || forced === 'main' || forced === 'list') return { mode: forced, reason: '網址指定', forced: true };
		if (!hasWebGL()) return { mode: 'list', reason: '不支援 WebGL', forced: false };
		const offscreen = 'transferControlToOffscreen' in HTMLCanvasElement.prototype && typeof Worker !== 'undefined';
		return offscreen
			? { mode: 'worker', reason: '支援 OffscreenCanvas', forced: false }
			: { mode: 'main', reason: '不支援 OffscreenCanvas，改在主執行緒', forced: false };
	}

	/** 手機、弱機一開始就關陰影、降解析度，跑得順再說 */
	function startTier(): Tier {
		const nav = navigator as Navigator & { deviceMemory?: number };
		if (matchMedia('(pointer: coarse)').matches) return 1;
		if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return 1;
		if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 4) return 1;
		return 2;
	}

	// 父元件切換停靠點時通知場景
	$effect(() => {
		if (ready) send({ type: 'focus', focus, panel });
	});
	$effect(() => {
		if (ready) send({ type: 'qr', on: qr });
	});
	$effect(() => {
		if (ready && live) send({ type: 'live', live: $state.snapshot(live) as LiveData });
	});
	$effect(() => {
		if (ready) send({ type: 'walk', on: walk });
	});

	// ---- 走路：鍵盤 WASD／方向鍵，手機用左下角的搖桿 ----
	const KEYS: Record<string, [number, number]> = {
		KeyW: [0, 1],
		ArrowUp: [0, 1],
		KeyS: [0, -1],
		ArrowDown: [0, -1],
		KeyA: [-1, 0],
		ArrowLeft: [-1, 0],
		KeyD: [1, 0],
		ArrowRight: [1, 0]
	};
	// 只是按鍵的暫存，不需要觸發畫面更新
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const held = new Set<string>();
	let shift = false;
	function sendKeys() {
		let x = 0;
		let z = 0;
		for (const k of held) {
			x += KEYS[k][0];
			z += KEYS[k][1];
		}
		send({ type: 'move', x, z, run: shift });
	}
	const typing = (e: KeyboardEvent) => e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [contenteditable]');
	function onKeyDown(e: KeyboardEvent) {
		if (!walk || e.ctrlKey || e.metaKey || e.altKey || typing(e)) return;
		if (e.code in KEYS) {
			e.preventDefault();
			held.add(e.code);
		} else if (e.key === 'Shift') shift = true;
		else if (e.code === 'KeyE') return send({ type: 'interact' });
		else return;
		sendKeys();
	}
	function onKeyUp(e: KeyboardEvent) {
		if (e.code in KEYS) held.delete(e.code);
		else if (e.key === 'Shift') shift = false;
		else return;
		if (walk) sendKeys();
	}
	// 視窗失去焦點時放開所有按鍵，不然人會一直往前走
	function releaseAll() {
		held.clear();
		shift = false;
		stick = null;
		send({ type: 'move', x: 0, z: 0, run: false });
	}
	$effect(() => {
		if (!walk) releaseAll();
	});

	/** 搖桿：按下去的地方是中心，手指離中心多遠、往哪邊，就往哪走 */
	const STICK_R = 48;
	let stick = $state<{ id: number; x: number; y: number; dx: number; dy: number } | null>(null);
	function stickDown(e: PointerEvent) {
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		stick = { id: e.pointerId, x: e.clientX, y: e.clientY, dx: 0, dy: 0 };
	}
	function stickMove(e: PointerEvent) {
		if (!stick || e.pointerId !== stick.id) return;
		let dx = e.clientX - stick.x;
		let dy = e.clientY - stick.y;
		const len = Math.hypot(dx, dy);
		if (len > STICK_R) {
			dx = (dx / len) * STICK_R;
			dy = (dy / len) * STICK_R;
		}
		stick = { ...stick, dx, dy };
		// 推到底就是跑
		send({ type: 'move', x: dx / STICK_R, z: -dy / STICK_R, run: len > STICK_R * 1.6 });
	}
	function stickUp(e: PointerEvent) {
		if (!stick || e.pointerId !== stick.id) return;
		stick = null;
		send({ type: 'move', x: 0, z: 0, run: false });
	}

	onMount(() => {
		const started = performance.now();
		const choice = chooseMode();
		sceneInfo.mode = choice.mode;
		sceneInfo.reason = choice.reason;
		sceneInfo.dpr = devicePixelRatio;
		onmode(choice.mode);
		if (choice.mode === 'list' || !canvas) return;

		// 錄影模式（網址加 ?capture）：一律最高畫質、不自動降級，錄 Reels 用
		const capture = new URLSearchParams(location.search).has('capture');
		let tier: Tier = capture ? 2 : startTier();
		let teardown = () => {};
		let slow = 0;
		let verySlow = 0;

		const toList = (reason: string) => {
			teardown();
			ready = false;
			sceneInfo.mode = 'list';
			sceneInfo.reason = reason;
			sceneInfo.stats = null;
			onmode('list');
		};

		const onMessage = (msg: FromScene) => {
			if (msg.type === 'ready') {
				ready = true;
				sceneInfo.gpu = msg.gpu;
				sceneInfo.readyMs = Math.round(performance.now() - started);
				send({ type: 'focus', focus, panel });
				if (walk) send({ type: 'walk', on: true });
				// 軟體繪圖（沒有真的 GPU）先降到低畫質，還是不行再交給下面的降級
				if (/swiftshader|llvmpipe|software/i.test(msg.gpu) && tier === 2 && !capture) {
					tier = 1;
					send({ type: 'tier', tier });
				}
			} else if (msg.type === 'stats') {
				sceneInfo.stats = msg.stats;
				if (document.hidden) return;
				// 高畫質連續 3 秒不到 40 幀 → 關陰影；低畫質連續 5 秒不到 20 幀 → 改清單
				slow = msg.stats.loopFps < 40 ? slow + 1 : 0;
				verySlow = msg.stats.loopFps < 20 ? verySlow + 1 : 0;
				if (capture) return;
				if (tier === 2 && slow >= 3) {
					tier = 1;
					slow = 0;
					send({ type: 'tier', tier });
				} else if (tier === 1 && verySlow >= 5 && !choice.forced) {
					toList(`太卡自動改清單（${msg.stats.loopFps} FPS）`);
				}
			} else if (msg.type === 'hover') {
				hovering = msg.key !== null;
			} else if (msg.type === 'select') {
				onselect(msg.key);
			} else if (msg.type === 'qr') {
				onqr(msg.on, msg.pull);
			} else if (msg.type === 'near') {
				onnear(msg.key);
			} else if (msg.type === 'error') {
				toList(`3D 發生錯誤：${msg.message}`);
			}
		};

		const options = (): SceneOptions => ({
			width: innerWidth,
			height: innerHeight,
			dpr: devicePixelRatio,
			reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
			fullRes: capture,
			tier
		});
		// $state 物件是 Proxy，postMessage 複製不了，先轉成普通物件
		const plainWorld = $state.snapshot(world) as World;

		(async () => {
			if (!canvas) return;
			if (choice.mode === 'worker') {
				const worker = new Worker(new URL('../room/worker.ts', import.meta.url), { type: 'module' });
				worker.onmessage = (e: MessageEvent<FromScene>) => onMessage(e.data);
				worker.onerror = (e) => toList(`Worker 載入失敗：${e.message}`);
				const offscreen = canvas.transferControlToOffscreen();
				worker.postMessage({ type: 'init', canvas: offscreen, options: options(), world: plainWorld } satisfies ToScene, [offscreen]);
				send = (msg) => worker.postMessage(msg);
				teardown = () => worker.terminate();
			} else {
				const [{ createRoom }, { dispatch }] = await Promise.all([import('#lib/room/core.js'), import('#lib/room/dispatch.js')]);
				try {
					const room = createRoom(canvas, options(), plainWorld, onMessage);
					send = (msg) => {
						if (msg.type !== 'init') dispatch(room, msg);
					};
					teardown = () => room.dispose();
				} catch (err) {
					toList(`3D 發生錯誤：${err instanceof Error ? err.message : err}`);
				}
			}
		})();

		// ---- 手勢：拖曳旋轉、滾輪／雙指縮放、點擊選桌子 ----
		// 只是手勢的暫存，不需要觸發畫面更新
		// eslint-disable-next-line svelte/prefer-svelte-reactivity
		const pointers = new Map<number, { x: number; y: number }>();
		let downAt: { x: number; y: number; t: number } | null = null;
		let pinch = 0;
		let raf = 0;
		let hoverAt: [number, number] | null = null;
		const ndc = (x: number, y: number) => [(x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1] as const;

		const onDown = (e: PointerEvent) => {
			canvas!.setPointerCapture(e.pointerId);
			pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pointers.size === 1) downAt = { x: e.clientX, y: e.clientY, t: performance.now() };
			else downAt = null;
		};
		const onMove = (e: PointerEvent) => {
			const prev = pointers.get(e.pointerId);
			if (!prev) {
				// 沒按著：滑鼠滑過，找滑到哪張桌子（每幀最多一次）
				if (e.pointerType === 'mouse') {
					hoverAt = [e.clientX, e.clientY];
					raf ||= requestAnimationFrame(() => {
						raf = 0;
						if (hoverAt) send({ type: 'hover', x: ndc(...hoverAt)[0], y: ndc(...hoverAt)[1] });
					});
				}
				return;
			}
			pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
			if (pointers.size === 2) {
				const [a, b] = [...pointers.values()];
				const d = Math.hypot(a.x - b.x, a.y - b.y);
				if (pinch) send({ type: 'zoom', factor: pinch / d });
				pinch = d;
			} else if (pointers.size === 1) {
				send({ type: 'orbit', dx: (e.clientX - prev.x) / innerWidth, dy: (e.clientY - prev.y) / innerHeight });
			}
		};
		const onUp = (e: PointerEvent) => {
			pointers.delete(e.pointerId);
			if (pointers.size < 2) pinch = 0;
			// 移動很少、按得不久才算點擊，拖曳轉視角不會誤選
			if (downAt && Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y) < 8 && performance.now() - downAt.t < 500) {
				const [x, y] = ndc(e.clientX, e.clientY);
				send({ type: 'click', x, y });
			}
			downAt = null;
		};
		const onWheel = (e: WheelEvent) => {
			e.preventDefault();
			send({ type: 'zoom', factor: Math.exp(e.deltaY * 0.0012) });
		};
		const onResize = () => send({ type: 'resize', width: innerWidth, height: innerHeight, dpr: devicePixelRatio });
		const onVis = () => send({ type: 'visible', visible: !document.hidden });

		const c = canvas;
		c.addEventListener('pointerdown', onDown);
		c.addEventListener('pointermove', onMove);
		c.addEventListener('pointerup', onUp);
		c.addEventListener('pointercancel', onUp);
		c.addEventListener('wheel', onWheel, { passive: false });
		addEventListener('resize', onResize);
		document.addEventListener('visibilitychange', onVis);
		addEventListener('keydown', onKeyDown);
		addEventListener('keyup', onKeyUp);
		addEventListener('blur', releaseAll);

		return () => {
			removeEventListener('keydown', onKeyDown);
			removeEventListener('keyup', onKeyUp);
			removeEventListener('blur', releaseAll);
			cancelAnimationFrame(raf);
			c.removeEventListener('pointerdown', onDown);
			c.removeEventListener('pointermove', onMove);
			c.removeEventListener('pointerup', onUp);
			c.removeEventListener('pointercancel', onUp);
			c.removeEventListener('wheel', onWheel);
			removeEventListener('resize', onResize);
			document.removeEventListener('visibilitychange', onVis);
			teardown();
		};
	});
</script>

{#if sceneInfo.mode !== 'list'}
	<canvas bind:this={canvas} class:ready class:hovering aria-label="兩間 3D 房間：拖曳旋轉，點桌子看專案"></canvas>
	{#if walk && ready}
		<!-- 手機的搖桿：只有觸控螢幕才顯示（CSS 控制） -->
		<div class="stick" role="presentation" onpointerdown={stickDown} onpointermove={stickMove} onpointerup={stickUp} onpointercancel={stickUp}>
			<i style:translate="{stick?.dx ?? 0}px {stick?.dy ?? 0}px"></i>
		</div>
	{/if}
	{#if !ready}
		<div class="loading" aria-live="polite">
			<div><i></i><i></i><i></i></div>
			<span>管理員們正在就位⋯</span>
		</div>
	{/if}
{/if}

<style>
	canvas {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100dvh;
		z-index: 0;
		touch-action: none;
		cursor: grab;
		opacity: 0;
		transition: opacity 0.6s var(--ease);
	}
	canvas:active {
		cursor: grabbing;
	}
	canvas.hovering {
		cursor: pointer;
	}
	canvas.ready {
		opacity: 1;
	}
	.stick {
		display: none;
		position: fixed;
		left: 24px;
		bottom: calc(108px + env(safe-area-inset-bottom));
		z-index: 12;
		width: 120px;
		height: 120px;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: rgb(14 14 22 / 0.45);
		backdrop-filter: blur(8px);
		touch-action: none;
	}
	.stick i {
		position: absolute;
		inset: 36px;
		border-radius: 50%;
		background: rgb(255 255 255 / 0.85);
		pointer-events: none;
	}
	@media (pointer: coarse) {
		.stick {
			display: block;
		}
	}
	.loading {
		position: fixed;
		inset: 0;
		display: grid;
		place-content: center;
		justify-items: center;
		gap: 14px;
		color: var(--muted);
		font-size: 14px;
		pointer-events: none;
	}
	.loading i {
		display: inline-block;
		width: 12px;
		height: 12px;
		margin: 0 4px;
		border-radius: 3px;
		background: var(--accent);
		animation: hop 0.9s var(--ease) infinite;
	}
	.loading i:nth-child(2) {
		animation-delay: 0.12s;
		background: var(--accent-2);
	}
	.loading i:nth-child(3) {
		animation-delay: 0.24s;
	}
	@keyframes hop {
		50% {
			transform: translateY(-10px) rotate(45deg);
		}
	}
</style>
