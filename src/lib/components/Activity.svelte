<script lang="ts">
	import type { ActivityDay } from '#lib/types.js';

	let { days }: { days: ActivityDay[] } = $props();

	const CELL = 13;
	const GAP = 4;
	const WEEKS = 53;

	const counts = $derived(new Map(days.map((d) => [d.date, d.count])));

	// 從 52 週前的星期日排到今天，跟 GitHub 一樣
	const grid = $derived.by(() => {
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		const start = new Date(today);
		start.setDate(start.getDate() - (WEEKS - 1) * 7 - start.getDay());
		const cells: { date: string; count: number; w: number; d: number }[] = [];
		for (let cur = new Date(start), i = 0; cur <= today; cur.setDate(cur.getDate() + 1), i++) {
			const date = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}-${String(cur.getDate()).padStart(2, '0')}`;
			cells.push({ date, count: counts.get(date) ?? 0, w: Math.floor(i / 7), d: i % 7 });
		}
		return cells;
	});

	const max = $derived(Math.max(1, ...grid.map((c) => c.count)));

	const stats = $derived.by(() => {
		let best = grid[0];
		let streak = 0;
		let longest = 0;
		let activeDays = 0;
		for (const c of grid) {
			if (c.count > best.count) best = c;
			if (c.count) {
				activeDays++;
				longest = Math.max(longest, ++streak);
			} else streak = 0;
		}
		return { best, longest, activeDays, total: grid.reduce((n, c) => n + c.count, 0) };
	});

	const level = (n: number) => (n === 0 ? 0 : Math.min(4, Math.ceil((n / max) * 4)));
	const height = (n: number) => (n === 0 ? 2 : 8 + Math.sqrt(n / max) * 72);

	let hover = $state<(typeof grid)[number] | null>(null);
	let wrap: HTMLDivElement;
	let stageW = $state(1000);
	let shown = $state(false);

	// 窄螢幕只畫最近幾週，柱子才不會小到看不見
	const weeks = $derived(stageW < 640 ? 18 : stageW < 900 ? 32 : WEEKS);
	const visible = $derived(grid.filter((c) => c.w >= WEEKS - weeks).map((c) => ({ ...c, w: c.w - (WEEKS - weeks) })));
	// rotateZ(-38deg) 之後的實際寬度，大約是 cos38·寬 + sin38·高
	const scale = $derived(Math.min(1, stageW / (weeks * (CELL + GAP) * 0.79 + 7 * (CELL + GAP) * 0.62 + 60)));

	$effect(() => {
		const ro = new ResizeObserver(([e]) => (stageW = e.contentRect.width));
		ro.observe(wrap);
		const io = new IntersectionObserver(([e]) => e.isIntersecting && ((shown = true), io.disconnect()), { threshold: 0.25 });
		io.observe(wrap);
		return () => (ro.disconnect(), io.disconnect());
	});

	const fmt = (date: string) => new Date(date + 'T00:00:00').toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
</script>

<div class="activity">
	<div class="stats">
		<div><b>{stats.total}</b><span>次部署 · 過去一年</span></div>
		<div><b>{stats.activeDays}</b><span>天有在動</span></div>
		<div><b>{stats.longest}</b><span>天最長連續</span></div>
		<div><b>{stats.best.count}</b><span>次，最忙的一天</span></div>
	</div>

	<div class="stage" bind:this={wrap} style:height="{Math.max(260, 420 * scale)}px">
		<div
			class="iso"
			class:shown
			style:--cell="{CELL}px"
			style:--gap="{GAP}px"
			style:width="{weeks * (CELL + GAP)}px"
			style:height="{7 * (CELL + GAP)}px"
			style:--s={scale}
		>
			{#each visible as c (c.date)}
				<div
					class="bar l{level(c.count)}"
					style:left="{c.w * (CELL + GAP)}px"
					style:top="{c.d * (CELL + GAP)}px"
					style:--h="{shown ? height(c.count) : 0}px"
					style:--delay="{(c.w + c.d) * 9}ms"
					onpointerenter={() => (hover = c)}
					onpointerleave={() => (hover = null)}
					role="presentation"
				>
					<i class="top"></i><i class="front"></i><i class="side"></i>
				</div>
			{/each}
		</div>

		<div class="tip" class:on={hover}>
			{#if hover}
				<b>{hover.count} 次部署</b>
				<span>{fmt(hover.date)}</span>
			{/if}
		</div>
	</div>

	<div class="legend">
		<span>少</span>
		{#each [0, 1, 2, 3, 4] as l (l)}<i class="l{l}"></i>{/each}
		<span>多</span>
	</div>
</div>

<style>
	.activity {
		display: grid;
		gap: 28px;
	}
	.stats {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 14px;
	}
	@media (max-width: 760px) {
		.stats {
			grid-template-columns: repeat(2, 1fr);
		}
	}
	.stats div {
		padding: 18px 20px;
		border-radius: 18px;
		background: var(--surface);
		border: 1px solid var(--line);
		display: grid;
		gap: 4px;
	}
	.stats b {
		font: 700 clamp(28px, 3.4vw, 40px) / 1 var(--font-display);
		color: var(--text);
	}
	.stats span {
		color: var(--muted);
		font-size: 13px;
	}

	.stage {
		position: relative;
		display: grid;
		place-items: center;
		overflow: hidden;
		min-height: 220px;
	}
	.iso {
		position: relative;
		transform: scale(var(--s)) rotateX(58deg) rotateZ(-38deg);
		transform-style: preserve-3d;
		flex: none;
	}
	.bar {
		position: absolute;
		width: var(--cell);
		height: var(--cell);
		transform-style: preserve-3d;
		--c: #19191c;
		--h: 0px;
		cursor: default;
	}
	.bar i {
		position: absolute;
		display: block;
		transition: transform 0.9s cubic-bezier(0.2, 0.9, 0.2, 1.15) var(--delay),
			width 0.9s cubic-bezier(0.2, 0.9, 0.2, 1.15) var(--delay),
			height 0.9s cubic-bezier(0.2, 0.9, 0.2, 1.15) var(--delay),
			filter 0.2s;
	}
	.top {
		inset: 0;
		background: var(--c);
		transform: translateZ(var(--h));
		border-radius: 2px;
	}
	/* 正面：沿著下緣立起來 */
	.front {
		left: 0;
		top: 100%;
		width: 100%;
		height: var(--h);
		transform-origin: top;
		transform: rotateX(-90deg);
		background: color-mix(in oklab, var(--c) 62%, #000);
	}
	/* 側面：沿著右緣立起來 */
	.side {
		top: 0;
		left: 100%;
		height: 100%;
		width: var(--h);
		transform-origin: left;
		transform: rotateY(90deg);
		background: color-mix(in oklab, var(--c) 40%, #000);
	}
	.bar:hover i {
		filter: brightness(1.6);
	}
	.l1 {
		--c: #3a3a40;
	}
	.l2 {
		--c: #66666e;
	}
	.l3 {
		--c: #a3a3ab;
	}
	.l4 {
		--c: #ededef;
	}

	.tip {
		position: absolute;
		top: 8px;
		right: 8px;
		padding: 10px 14px;
		border-radius: 14px;
		background: rgb(14 14 16 / 0.85);
		border: 1px solid var(--line);
		backdrop-filter: blur(10px);
		display: grid;
		gap: 2px;
		font-size: 13px;
		opacity: 0;
		transform: translateY(-6px);
		transition: 0.25s;
		pointer-events: none;
	}
	.tip.on {
		opacity: 1;
		transform: none;
	}
	.tip span {
		color: var(--muted);
	}
	.legend {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 6px;
		font-size: 12px;
		color: var(--muted);
	}
	.legend i {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: var(--c, #19191c);
	}
</style>
