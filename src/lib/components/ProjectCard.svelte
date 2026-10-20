<script lang="ts">
	import { tilt } from '#lib/motion.js';
	import { frameworkLabel, timeAgo } from '#lib/format.js';
	import type { Project } from '#lib/types.js';

	let { project, index, total }: { project: Project; index: number; total: number } = $props();

	const host = $derived(project.url ? new URL(project.url).host : null);
	// 每張卡的顏色是紫→藍色階上的一個位置，整排看起來是同一組顏色漸變過去
	const tint = $derived(
		project.accent || `color-mix(in oklab, var(--accent-2) ${total > 1 ? Math.round((index / (total - 1)) * 100) : 0}%, var(--accent))`
	);
	const glyph = $derived(project.title.trim().charAt(0).toUpperCase());
	const live = $derived(project.state === 'READY');
</script>

<article class="wrap" class:featured={project.featured} style:--tint={tint} style:--i={index}>
	<div class="card" {@attach tilt(12)}>
		<div class="cover">
			<div class="floor"><i></i></div>
			<div class="orb sphere"></div>
			<div class="orb two sphere"></div>
			<span class="glyph" aria-hidden="true">{glyph}</span>
			<span class="index">{String(index + 1).padStart(2, '0')}</span>
			{#if project.featured}<span class="badge">精選</span>{/if}
		</div>

		<div class="body">
			<div class="meta">
				<span class="status" class:live title={project.state}>
					<i></i>{live ? '上線中' : project.state === 'BUILDING' ? '部署中' : '狀態異常'}
				</span>
				{#if project.framework}<span>{frameworkLabel(project.framework)}</span>{/if}
				{#if project.lastDeployAt}<span>{timeAgo(project.lastDeployAt)}更新</span>{/if}
			</div>

			<h3>{project.title}</h3>
			{#if project.description}<p>{project.description}</p>{/if}

			{#if project.tags.length}
				<ul class="tags">
					{#each project.tags as tag (tag)}<li>{tag}</li>{/each}
				</ul>
			{/if}

			<div class="links">
				{#if project.url}
					<a class="visit" href={project.url} target="_blank" rel="noreferrer">
						<b>前往網站</b><small>{host}</small><span aria-hidden="true">↗</span>
					</a>
				{:else}
					<span class="visit muted">尚未綁定網址</span>
				{/if}
				{#if project.repo}
					<a class="repo" href={project.repo} target="_blank" rel="noreferrer" aria-label="原始碼">
						<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M12 .5a11.5 11.5 0 0 0-3.64 22.41c.58.1.79-.25.79-.56v-2c-3.2.7-3.88-1.37-3.88-1.37-.53-1.33-1.28-1.69-1.28-1.69-1.05-.71.08-.7.08-.7 1.16.08 1.77 1.19 1.77 1.19 1.03 1.77 2.7 1.26 3.36.96.1-.75.4-1.26.73-1.55-2.56-.29-5.25-1.28-5.25-5.68 0-1.26.45-2.28 1.19-3.09-.12-.29-.52-1.46.11-3.05 0 0 .97-.31 3.17 1.18a11 11 0 0 1 5.77 0c2.2-1.49 3.17-1.18 3.17-1.18.63 1.59.23 2.76.11 3.05.74.81 1.19 1.83 1.19 3.09 0 4.41-2.7 5.38-5.26 5.67.41.36.78 1.06.78 2.14v3.17c0 .31.21.67.8.56A11.5 11.5 0 0 0 12 .5Z"/></svg>
					</a>
				{/if}
			</div>
		</div>

		<div class="glare" aria-hidden="true"></div>
		{#if project.url}
			<a class="cover-link" href={project.url} target="_blank" rel="noreferrer" aria-label="開啟 {project.title}"></a>
		{/if}
	</div>
</article>

<style>
	.wrap {
		perspective: 1100px;
		--rx: 0deg;
		--ry: 0deg;
		--mx: 50%;
		--my: 50%;
	}

	.card {
		position: relative;
		height: 100%;
		display: flex;
		flex-direction: column;
		border-radius: var(--r-lg);
		background: var(--surface);
		border: 1px solid var(--line);
		transform: rotateX(var(--rx)) rotateY(var(--ry));
		transform-style: preserve-3d;
		transition:
			transform 0.5s var(--ease),
			box-shadow 0.5s var(--ease),
			border-color 0.4s;
		box-shadow: 0 30px 60px -30px rgb(0 0 0 / 0.8);
	}
	.card:hover {
		transition-duration: 0.12s, 0.5s, 0.4s;
		border-color: color-mix(in oklab, var(--tint) 45%, transparent);
		box-shadow:
			0 50px 80px -30px rgb(0 0 0 / 0.95),
			0 0 50px -24px var(--tint);
	}

	.cover {
		position: relative;
		height: 210px;
		border-radius: calc(var(--r-lg) - 1px) calc(var(--r-lg) - 1px) 0 0;
		overflow: hidden;
		transform-style: preserve-3d;
		background:
			radial-gradient(110% 90% at 80% 0%, color-mix(in oklab, var(--tint) 32%, transparent), transparent 65%),
			#0c0c10;
	}
	.featured .cover {
		height: 260px;
	}
	/* 透視地板：只動 transform，不重繪 */
	.floor {
		position: absolute;
		inset: 45% -50% -60%;
		overflow: hidden;
		transform: perspective(300px) rotateX(62deg);
		opacity: 0.5;
	}
	/* 用漸層蓋住遠處的格線，比 mask-image 省很多（遮罩在 3D 傾斜時每幀都要重算） */
	.floor::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(to bottom, #0c0c10 15%, transparent 85%);
	}
	.floor i {
		position: absolute;
		inset: -38px 0 0;
		background-image:
			linear-gradient(color-mix(in oklab, var(--tint) 55%, transparent) 1px, transparent 1px),
			linear-gradient(90deg, color-mix(in oklab, var(--tint) 55%, transparent) 1px, transparent 1px);
		background-size: 38px 38px;
		/* 平常不動，滑到卡片上才開始往前流動：閒置的卡片不花任何效能 */
		animation: floor 3s linear infinite paused;
	}
	.card:hover .floor i {
		animation-play-state: running;
	}
	@keyframes floor {
		to {
			transform: translateY(38px);
		}
	}
	/* 跟 3D 主視覺同一種球：石墨 + 輪廓光 */
	.orb {
		position: absolute;
		width: 120px;
		aspect-ratio: 1;
		left: 62%;
		top: 16%;
		animation: bob 7s ease-in-out infinite;
		animation-delay: calc(var(--i) * -1.3s);
	}
	.orb.two {
		width: 34px;
		left: 18%;
		top: 58%;
		animation-duration: 5s;
	}
	@keyframes bob {
		50% {
			transform: translate3d(-10px, 12px, 0);
		}
	}
	.glyph {
		position: absolute;
		left: 26px;
		bottom: -26px;
		font: 800 170px/1 var(--font-display);
		color: transparent;
		-webkit-text-stroke: 1.5px rgb(255 255 255 / 0.55);
		transform: translateZ(50px);
		transition: transform 0.5s var(--ease);
	}
	.card:hover .glyph {
		transform: translateZ(80px) translateY(-8px);
	}
	.index {
		position: absolute;
		top: 18px;
		left: 22px;
		font: 500 12px var(--font-mono);
		letter-spacing: 0.1em;
		color: var(--muted);
	}
	.badge {
		position: absolute;
		top: 14px;
		right: 16px;
		padding: 5px 12px;
		border-radius: var(--r-pill);
		font-size: 12px;
		font-weight: 600;
		background: rgb(255 255 255 / 0.08);
		border: 1px solid var(--line);
		transform: translateZ(30px);
	}

	.body {
		position: relative;
		z-index: 2;
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 22px 24px 24px;
		flex: 1;
		transform: translateZ(30px);
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px 14px;
		font: 500 12px var(--font-mono);
		color: var(--muted);
	}
	.status {
		display: inline-flex;
		align-items: center;
		gap: 7px;
	}
	.status i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: currentColor;
	}
	.status.live {
		color: var(--accent-2);
	}
	h3 {
		margin: 0;
		font: 800 clamp(24px, 2.4vw, 30px) / 1.1 var(--font-display);
		letter-spacing: -0.03em;
	}
	p {
		margin: 0;
		color: var(--text-soft);
		line-height: 1.7;
		font-size: 15px;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.tags li {
		padding: 4px 11px;
		border-radius: var(--r-pill);
		font-size: 12px;
		color: var(--text-soft);
		border: 1px solid var(--line);
	}
	.links {
		margin-top: auto;
		padding-top: 8px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
	}
	.links a,
	.links span {
		position: relative;
		z-index: 3;
	}
	.visit {
		flex: 0 1 auto;
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-width: 0;
		padding: 9px 14px 9px 16px;
		border-radius: var(--r-pill);
		background: color-mix(in oklab, var(--tint) 14%, transparent);
		border: 1px solid color-mix(in oklab, var(--tint) 35%, transparent);
		color: var(--text);
		text-decoration: none;
		white-space: nowrap;
		transition: background 0.3s;
	}
	.visit:hover {
		background: color-mix(in oklab, var(--tint) 26%, transparent);
	}
	.visit b {
		font-size: 14px;
		font-weight: 600;
	}
	.visit small {
		font: 500 12px var(--font-mono);
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.visit span {
		transition: transform 0.3s var(--ease);
	}
	.card:hover .visit span {
		transform: translate(3px, -3px);
	}
	.visit.muted {
		color: var(--muted);
		background: none;
		border-color: var(--line);
		font-size: 13px;
	}
	.repo {
		flex: none;
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		border-radius: 50%;
		color: var(--text);
		border: 1px solid var(--line);
		transition:
			background 0.3s,
			color 0.3s;
	}
	.repo:hover {
		background: var(--text);
		color: var(--bg);
	}

	.glare {
		position: absolute;
		inset: 0;
		border-radius: inherit;
		pointer-events: none;
		background: radial-gradient(500px circle at var(--mx) var(--my), rgb(255 255 255 / 0.07), transparent 40%);
		opacity: 0;
		transition: opacity 0.4s;
		z-index: 4;
	}
	.card:hover .glare {
		opacity: 1;
	}
	.cover-link {
		position: absolute;
		inset: 0;
		z-index: 1;
		border-radius: inherit;
	}
</style>
