<script lang="ts">
	// ?debug=perf 才會出現的量測面板：在使用者自己的電腦上看真實數字
	import { onMount } from 'svelte';
	import { sceneInfo } from '#lib/scene/stats.svelte.js';

	const MODE_LABEL = { pending: '載入中', worker: 'WebGL（Worker）', main: 'WebGL（主執行緒）', lite: 'CSS 球' } as const;

	let pageFps = $state(0);
	let pageWorst = $state(0);
	let longTasks = $state(0);
	let longTaskMs = $state(0);
	let copied = $state(false);

	onMount(() => {
		// 頁面本身（主執行緒）的幀率：捲動順不順看這個
		let frames = 0;
		let worst = 0;
		let last = performance.now();
		let at = last;
		let raf = requestAnimationFrame(function loop(t) {
			frames++;
			worst = Math.max(worst, t - last);
			last = t;
			if (t - at >= 1000) {
				pageFps = Math.round((frames * 1000) / (t - at));
				pageWorst = Math.round(worst);
				frames = worst = 0;
				at = t;
			}
			raf = requestAnimationFrame(loop);
		});

		// 主執行緒被卡住超過 50ms 的次數
		let po: PerformanceObserver | null = null;
		try {
			po = new PerformanceObserver((list) => {
				for (const e of list.getEntries()) {
					longTasks++;
					longTaskMs += Math.round(e.duration);
				}
			});
			po.observe({ type: 'longtask', buffered: true });
		} catch {
			// Safari、Firefox 不支援 longtask
		}

		return () => {
			cancelAnimationFrame(raf);
			po?.disconnect();
		};
	});

	const link = (scene: string) => {
		const url = new URL(location.href);
		url.searchParams.set('scene', scene);
		return url.pathname + url.search;
	};

	async function copy() {
		const s = sceneInfo.stats;
		const text = [
			`模式：${MODE_LABEL[sceneInfo.mode]}（${sceneInfo.reason}）`,
			`GPU：${sceneInfo.gpu || '—'}`,
			`解析度倍率：${sceneInfo.dpr}`,
			`頁面 FPS：${pageFps}（最慢 ${pageWorst}ms）`,
			s ? `3D FPS：${s.fps}／迴圈 ${s.loopFps}（最慢 ${s.worstMs}ms）` : '3D FPS：—',
			`主執行緒卡住：${longTasks} 次，共 ${longTaskMs}ms`,
			`3D 首幀：${sceneInfo.readyMs ? sceneInfo.readyMs + 'ms' : '—'}`,
			`視窗：${innerWidth}×${innerHeight} @${devicePixelRatio}x`,
			`瀏覽器：${navigator.userAgent}`
		].join('\n');
		await navigator.clipboard.writeText(text);
		copied = true;
		setTimeout(() => (copied = false), 1500);
	}

	const tone = (fps: number) => (fps >= 50 ? 'good' : fps >= 30 ? 'warn' : 'bad');
</script>

<aside class="perf" aria-label="效能量測">
	<header>
		<b>效能量測</b>
		<button onclick={copy}>{copied ? '已複製' : '複製結果'}</button>
	</header>
	<dl>
		<dt>模式</dt>
		<dd>{MODE_LABEL[sceneInfo.mode]}<small>{sceneInfo.reason}</small></dd>
		<dt>頁面</dt>
		<dd class={tone(pageFps)}>{pageFps} FPS<small>最慢 {pageWorst}ms</small></dd>
		<dt>3D</dt>
		<dd class={sceneInfo.stats ? tone(sceneInfo.stats.loopFps) : ''}>
			{#if sceneInfo.stats}{sceneInfo.stats.fps} FPS<small>迴圈 {sceneInfo.stats.loopFps}・最慢 {sceneInfo.stats.worstMs}ms</small>{:else}—{/if}
		</dd>
		<dt>卡住</dt>
		<dd class={longTasks ? 'warn' : 'good'}>{longTasks} 次<small>共 {longTaskMs}ms</small></dd>
		<dt>GPU</dt>
		<dd class="gpu">{sceneInfo.gpu || '—'}</dd>
	</dl>
	<nav>
		切換：
		<a href={link('worker')} data-sveltekit-reload>Worker</a>
		<a href={link('main')} data-sveltekit-reload>主執行緒</a>
		<a href={link('lite')} data-sveltekit-reload>CSS</a>
	</nav>
</aside>

<style>
	.perf {
		position: fixed;
		right: 16px;
		bottom: 16px;
		z-index: 90;
		width: 290px;
		padding: 14px 16px;
		border-radius: var(--r-md);
		background: rgb(12 12 16 / 0.92);
		border: 1px solid var(--line);
		font: 500 12px/1.5 var(--font-mono);
		color: var(--text-soft);
	}
	header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 10px;
		color: var(--text);
	}
	button {
		padding: 4px 10px;
		border-radius: var(--r-pill);
		border: 1px solid var(--line);
		background: none;
		color: inherit;
		font: inherit;
		cursor: pointer;
	}
	dl {
		display: grid;
		grid-template-columns: 44px 1fr;
		gap: 6px 10px;
		margin: 0;
	}
	dt {
		color: var(--muted);
	}
	dd {
		margin: 0;
		display: grid;
		color: var(--text);
	}
	small {
		color: var(--muted);
		font-size: 11px;
	}
	.good {
		color: var(--accent-2);
	}
	.warn {
		color: #f5c66b;
	}
	.bad {
		color: #ff8a7a;
	}
	.gpu {
		font-size: 11px;
		word-break: break-word;
		color: var(--text-soft);
	}
	nav {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px solid var(--line);
		color: var(--muted);
	}
	nav a {
		color: var(--text);
		margin-left: 6px;
	}
</style>
