<script lang="ts">
	import type { ActivityDay } from '#lib/types.js';

	let { days }: { days: ActivityDay[] } = $props();

	const WEEKS = 53;
	// 跟 app.css 的色階一致：底色 → --accent → --accent-2
	const LEVELS = ['#1c1c24', '#3a3170', '#5f50c9', '#8b7bff', '#4cc9f0'];

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

	type Cell = (typeof grid)[number];

	let stage: HTMLDivElement;
	let canvas: HTMLCanvasElement;
	let stageW = $state(1000);
	let hover = $state<{ cell: Cell; x: number; y: number } | null>(null);

	// 窄螢幕只畫最近幾週，柱子才不會小到看不見
	const weeks = $derived(stageW < 640 ? 18 : stageW < 900 ? 32 : WEEKS);
	const visible = $derived(
		grid
			.filter((c) => c.w >= WEEKS - weeks)
			.map((c) => ({ ...c, w: c.w - (WEEKS - weeks) }))
			// 由後往前畫：畫面上越下面的越靠近觀眾
			.sort((a, b) => a.d - a.w - (b.d - b.w))
	);

	// 壓扁的等角投影（視角比標準等角低一點），週往右上、星期往右下；整張圖才不會比螢幕還高
	const geo = $derived.by(() => {
		const u = Math.min(22, (stageW * 0.94) / ((weeks + 7) * 0.866));
		const cx = u * 0.866;
		const cy = u * 0.3;
		const maxH = u * 4.5;
		const pad = 12;
		const height = Math.ceil((weeks + 7) * cy + maxH + pad * 2);
		const ox = (stageW - (weeks + 7) * cx) / 2;
		const oy = weeks * cy + maxH + pad;
		return { u, cx, cy, maxH, height, ox, oy };
	});

	const project = (gx: number, gy: number) => [geo.ox + (gx + gy) * geo.cx, geo.oy + (gy - gx) * geo.cy] as const;
	const barHeight = (n: number) => (n === 0 ? geo.u * 0.12 : geo.u * 0.5 + Math.sqrt(n / max) * geo.maxH);

	const shade = (hex: string, k: number) => {
		const v = parseInt(hex.slice(1), 16);
		const ch = (s: number) => Math.round(((v >> s) & 255) * k);
		return `rgb(${ch(16)} ${ch(8)} ${ch(0)})`;
	};

	/** 一根柱子的六角形外框（頂面四點 + 底部可見的兩點），畫圖跟滑鼠判斷共用 */
	function outline(c: Cell, h: number) {
		const inset = 0.14;
		const [lx, ly] = project(c.w + inset, c.d + inset); // 左
		const [tx, ty] = project(c.w + 1 - inset, c.d + inset); // 上
		const [rx, ry] = project(c.w + 1 - inset, c.d + 1 - inset); // 右
		const [bx, by] = project(c.w + inset, c.d + 1 - inset); // 下
		return { l: [lx, ly], t: [tx, ty], r: [rx, ry], b: [bx, by], h };
	}

	let progress = 0;
	let started = false;

	function draw() {
		if (!canvas) return;
		const dpr = Math.min(devicePixelRatio, 2);
		const w = stageW;
		const h = geo.height;
		if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
			canvas.width = Math.round(w * dpr);
			canvas.height = Math.round(h * dpr);
		}
		const ctx = canvas.getContext('2d')!;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);

		const span = weeks + 7;
		for (const c of visible) {
			// 從左下往右上依序長出來
			const delay = ((c.w + (7 - c.d)) / span) * 0.45;
			const t = Math.min(1, Math.max(0, (progress - delay) / 0.55));
			const e = 1 - Math.pow(1 - t, 3);
			const { l, t: tp, r, b, h: bh } = outline(c, barHeight(c.count) * e);
			const base = LEVELS[level(c.count)];
			const lit = hover?.cell.date === c.date ? 1.45 : 1;

			const quad = (pts: number[][], color: string) => {
				ctx.beginPath();
				ctx.moveTo(pts[0][0], pts[0][1]);
				for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
				ctx.closePath();
				ctx.fillStyle = color;
				ctx.fill();
			};
			const up = (p: number[]) => [p[0], p[1] - bh];

			if (bh > 0.5) {
				quad([l, b, up(b), up(l)], shade(base, 0.62 * lit)); // 左側面
				quad([b, r, up(r), up(b)], shade(base, 0.42 * lit)); // 右側面
			}
			quad([up(l), up(tp), up(r), up(b)], shade(base, lit)); // 頂面
		}
	}

	// 只在長高動畫期間連續重畫，之後只有 hover 或尺寸改變才重畫
	function animate() {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const t0 = performance.now();
		const step = (now: number) => {
			progress = reduced ? 1 : Math.min(1, (now - t0) / 1400);
			draw();
			if (progress < 1) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
	}

	$effect(() => {
		const ro = new ResizeObserver(([e]) => (stageW = e.contentRect.width));
		ro.observe(stage);
		const io = new IntersectionObserver(
			([e]) => {
				if (e.isIntersecting && !started) {
					started = true;
					animate();
					io.disconnect();
				}
			},
			{ threshold: 0.25 }
		);
		io.observe(stage);
		return () => (ro.disconnect(), io.disconnect());
	});

	// 尺寸、資料或 hover 改變時重畫一次
	$effect(() => {
		void geo;
		void visible;
		void hover;
		draw();
	});

	const inside = (pts: number[][], x: number, y: number) => {
		let sign = 0;
		for (let i = 0; i < pts.length; i++) {
			const [ax, ay] = pts[i];
			const [bx, by] = pts[(i + 1) % pts.length];
			const cross = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
			if (cross !== 0) {
				if (sign === 0) sign = Math.sign(cross);
				else if (Math.sign(cross) !== sign) return false;
			}
		}
		return true;
	};

	function onMove(e: PointerEvent) {
		const rect = canvas.getBoundingClientRect();
		const x = e.clientX - rect.left;
		const y = e.clientY - rect.top;
		// 從最前面的柱子開始找
		for (let i = visible.length - 1; i >= 0; i--) {
			const c = visible[i];
			const { l, t, r, b, h } = outline(c, barHeight(c.count) * progress);
			const hex = [
				[l[0], l[1] - h],
				[t[0], t[1] - h],
				[r[0], r[1] - h],
				r,
				b,
				l
			];
			if (inside(hex, x, y)) {
				if (hover?.cell.date !== c.date || Math.abs(hover.x - x) > 2 || Math.abs(hover.y - y) > 2) hover = { cell: c, x, y };
				return;
			}
		}
		hover = null;
	}

	const fmt = (date: string) => new Date(date + 'T00:00:00').toLocaleDateString('zh-TW', { month: 'long', day: 'numeric', weekday: 'short' });
</script>

<div class="activity">
	<div class="stats">
		<div><b>{stats.total}</b><span>次部署 · 過去一年</span></div>
		<div><b>{stats.activeDays}</b><span>天有在動</span></div>
		<div><b>{stats.longest}</b><span>天最長連續</span></div>
		<div><b>{stats.best.count}</b><span>次，最忙的一天</span></div>
	</div>

	<div class="stage" bind:this={stage}>
		<canvas
			bind:this={canvas}
			style:height="{geo.height}px"
			onpointermove={onMove}
			onpointerleave={() => (hover = null)}
			aria-label="過去一年每天的部署次數，共 {stats.total} 次"
		></canvas>

		{#if hover}
			<div class="tip" style:left="{hover.x}px" style:top="{hover.y}px">
				<b>{hover.cell.count} 次部署</b>
				<span>{fmt(hover.cell.date)}</span>
			</div>
		{/if}
	</div>

	<div class="legend">
		<span>少</span>
		{#each LEVELS as c (c)}<i style:background={c}></i>{/each}
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
		border-radius: var(--r-md);
		background: var(--surface);
		border: 1px solid var(--line);
		display: grid;
		gap: 4px;
	}
	.stats b {
		font: 800 clamp(28px, 3.4vw, 40px) / 1 var(--font-display);
		letter-spacing: -0.03em;
		color: var(--text);
	}
	.stats span {
		color: var(--muted);
		font-size: 13px;
	}

	.stage {
		position: relative;
	}
	canvas {
		display: block;
		width: 100%;
	}

	.tip {
		position: absolute;
		z-index: 2;
		translate: -50% calc(-100% - 14px);
		padding: 10px 14px;
		border-radius: var(--r-sm);
		background: rgb(14 14 18 / 0.92);
		border: 1px solid var(--line);
		display: grid;
		gap: 2px;
		font-size: 13px;
		white-space: nowrap;
		pointer-events: none;
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
	}
</style>
