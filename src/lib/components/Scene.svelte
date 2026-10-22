<script lang="ts">
	// 背景 3D 的總管：決定用哪種模式、延後載入、把輸入轉給場景、太卡就自動降級
	//   worker：WebGL 在 Web Worker 跑（OffscreenCanvas），主執行緒完全不碰 3D
	//   main：瀏覽器不支援 OffscreenCanvas 時，在主執行緒跑同一份場景
	//   lite：手機、弱機、減少動態效果、沒有 WebGL 時，改用 CSS 做的 3D 球
	// 可以用 ?scene=worker|main|lite 強制指定，方便測試
	import { onMount } from 'svelte';
	import LiteOrb from './LiteOrb.svelte';
	import { sceneInfo, type SceneMode } from '#lib/scene/stats.svelte.js';
	import type { FromScene, SceneOptions, ToScene } from '#lib/scene/protocol.js';
	import type { SceneHandle } from '#lib/scene/core.js';

	let canvas = $state<HTMLCanvasElement>();
	let mode = $state<SceneMode>('pending');
	let ready = $state(false);

	function hasWebGL() {
		try {
			const c = document.createElement('canvas');
			return Boolean(c.getContext('webgl2') ?? c.getContext('webgl'));
		} catch {
			return false;
		}
	}

	function chooseMode(): { mode: SceneMode; reason: string } {
		const forced = new URLSearchParams(location.search).get('scene');
		if (forced === 'worker' || forced === 'main' || forced === 'lite') return { mode: forced, reason: '網址指定' };

		const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
		if (matchMedia('(prefers-reduced-motion: reduce)').matches) return { mode: 'lite', reason: '系統開了減少動態效果' };
		if (nav.connection?.saveData) return { mode: 'lite', reason: '數據節省模式' };
		if (matchMedia('(pointer: coarse)').matches && innerWidth < 900) return { mode: 'lite', reason: '手機' };
		if (nav.deviceMemory !== undefined && nav.deviceMemory < 4) return { mode: 'lite', reason: `記憶體 ${nav.deviceMemory}GB` };
		if (nav.hardwareConcurrency !== undefined && nav.hardwareConcurrency <= 2) return { mode: 'lite', reason: `${nav.hardwareConcurrency} 核心` };
		if (!hasWebGL()) return { mode: 'lite', reason: '不支援 WebGL' };

		const offscreen = 'transferControlToOffscreen' in HTMLCanvasElement.prototype && typeof Worker !== 'undefined';
		return offscreen ? { mode: 'worker', reason: '支援 OffscreenCanvas' } : { mode: 'main', reason: '不支援 OffscreenCanvas，改在主執行緒' };
	}

	/** 等首屏動畫跑完、瀏覽器有空檔再載入 three.js，不跟開場搶資源 */
	const whenIdle = () =>
		new Promise<void>((resolve) => {
			const go = () =>
				'requestIdleCallback' in window ? requestIdleCallback(() => resolve(), { timeout: 1500 }) : setTimeout(resolve, 300);
			if (document.readyState === 'complete') setTimeout(go, 700);
			else addEventListener('load', () => setTimeout(go, 700), { once: true });
		});

	onMount(() => {
		const started = performance.now();
		const choice = chooseMode();
		mode = choice.mode;
		sceneInfo.mode = choice.mode;
		sceneInfo.reason = choice.reason;
		sceneInfo.dpr = Math.min(devicePixelRatio, 1.5);
		if (mode === 'lite') return;

		let disposed = false;
		let send: (msg: ToScene) => void = () => {};
		let teardown = () => {};
		let slowStreak = 0;

		const downgrade = (reason: string) => {
			if (mode === 'lite') return;
			teardown();
			mode = 'lite';
			ready = false;
			sceneInfo.mode = 'lite';
			sceneInfo.reason = reason;
			sceneInfo.stats = null;
		};

		const onMessage = (msg: FromScene) => {
			if (msg.type === 'ready') {
				ready = true;
				sceneInfo.gpu = msg.gpu;
				sceneInfo.readyMs = Math.round(performance.now() - started);
				// 軟體繪圖（沒有真的 GPU）一定很卡，直接改用 CSS 版
				if (/swiftshader|llvmpipe|software/i.test(msg.gpu)) downgrade(`沒有硬體加速（${msg.gpu}）`);
			} else if (msg.type === 'stats') {
				sceneInfo.stats = msg.stats;
				// 連續 3 秒每秒不到 30 幀就降級；分頁在背景時不算
				if (!document.hidden && msg.stats.loopFps < 30) slowStreak++;
				else slowStreak = 0;
				if (slowStreak >= 3) downgrade(`太卡自動降級（${msg.stats.loopFps} FPS）`);
			} else if (msg.type === 'error') {
				downgrade(`3D 發生錯誤：${msg.message}`);
			}
		};

		const options = (): SceneOptions => ({
			width: innerWidth,
			height: innerHeight,
			dpr: devicePixelRatio,
			reduced: matchMedia('(prefers-reduced-motion: reduce)').matches
		});

		// 輸入事件每幀最多送一次
		let raf = 0;
		let pointer: [number, number] | null = null;
		const flush = () => {
			raf = 0;
			const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
			send({ type: 'scroll', state: { hero: scrollY / innerHeight, progress: scrollY / max } });
			if (pointer) send({ type: 'pointer', x: pointer[0], y: pointer[1] }), (pointer = null);
		};
		const schedule = () => (raf ||= requestAnimationFrame(flush));
		const onMove = (e: PointerEvent) => {
			pointer = [(e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1];
			schedule();
		};
		const onResize = () => {
			send({ type: 'resize', width: innerWidth, height: innerHeight, dpr: devicePixelRatio });
			schedule();
		};
		const onVis = () => send({ type: 'visible', visible: !document.hidden });

		(async () => {
			await whenIdle();
			if (disposed || !canvas) return;

			if (mode === 'worker') {
				const worker = new Worker(new URL('../scene/worker.ts', import.meta.url), { type: 'module' });
				worker.onmessage = (e: MessageEvent<FromScene>) => onMessage(e.data);
				worker.onerror = (e) => downgrade(`Worker 載入失敗：${e.message}`);
				const offscreen = canvas.transferControlToOffscreen();
				worker.postMessage({ type: 'init', canvas: offscreen, options: options() } satisfies ToScene, [offscreen]);
				send = (msg) => worker.postMessage(msg);
				teardown = () => worker.terminate();
			} else {
				const { createScene } = await import('#lib/scene/core.js');
				if (disposed) return;
				let handle: SceneHandle;
				try {
					handle = createScene(canvas, options(), onMessage);
				} catch (err) {
					downgrade(`3D 發生錯誤：${err instanceof Error ? err.message : err}`);
					return;
				}
				send = (msg) => {
					if (msg.type === 'resize') handle.resize(msg.width, msg.height, msg.dpr);
					else if (msg.type === 'pointer') handle.pointer(msg.x, msg.y);
					else if (msg.type === 'scroll') handle.scroll(msg.state);
					else if (msg.type === 'visible') handle.setVisible(msg.visible);
				};
				teardown = () => handle.dispose();
			}

			addEventListener('scroll', schedule, { passive: true });
			addEventListener('pointermove', onMove, { passive: true });
			addEventListener('resize', onResize);
			document.addEventListener('visibilitychange', onVis);
			flush();
		})();

		return () => {
			disposed = true;
			cancelAnimationFrame(raf);
			removeEventListener('scroll', schedule);
			removeEventListener('pointermove', onMove);
			removeEventListener('resize', onResize);
			document.removeEventListener('visibilitychange', onVis);
			teardown();
		};
	});
</script>

<!-- CSS 球一直都在：WebGL 還沒好時當佔位，好了就淡出；降級時再淡回來 -->
<LiteOrb hidden={ready} />

{#if mode === 'worker' || mode === 'main' || mode === 'pending'}
	<canvas bind:this={canvas} class:ready aria-hidden="true"></canvas>
{/if}

<style>
	canvas {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		z-index: 0;
		pointer-events: none;
		opacity: 0;
		transition: opacity 1.2s var(--ease);
	}
	canvas.ready {
		opacity: 1;
	}
</style>
