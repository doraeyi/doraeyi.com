<script lang="ts">
	import { dev } from '$app/env';
	import Scene from '#lib/components/Scene.svelte';
	import ProjectCard from '#lib/components/ProjectCard.svelte';
	import Activity from '#lib/components/Activity.svelte';
	import PerfPanel from '#lib/components/PerfPanel.svelte';
	import { magnetic, reveal, tilt } from '#lib/motion.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const profile = $derived(data.profile);
	const letters = $derived([...profile.name]);
	const liveCount = $derived(data.projects.filter((p) => p.state === 'READY').length);

	const allTags = $derived([...new Set(data.projects.flatMap((p) => p.tags))]);
	let tag = $state<string | null>(null);
	const shown = $derived(tag ? data.projects.filter((p) => p.tags.includes(tag!)) : data.projects);

	const SECTIONS = [
		['work', '作品'],
		['about', '關於'],
		['activity', '動態'],
		['contact', '聯絡']
	] as const;
	let active = $state<string | null>(null);

	$effect(() => {
		const io = new IntersectionObserver(
			(entries) => {
				for (const e of entries) if (e.isIntersecting) active = e.target.id;
			},
			{ rootMargin: '-45% 0px -50% 0px' }
		);
		for (const [id] of SECTIONS) {
			const el = document.getElementById(id);
			if (el) io.observe(el);
		}
		return () => io.disconnect();
	});

	let progress = $state(0);
	let scrolled = $state(false);
	// 網址加 ?debug=perf 才顯示量測面板
	let showPerf = $state(false);
	$effect(() => {
		showPerf = new URLSearchParams(location.search).get('debug') === 'perf';
	});

	const onScroll = () => {
		const max = document.documentElement.scrollHeight - innerHeight;
		progress = max > 0 ? scrollY / max : 0;
		scrolled = scrollY > 40;
		if (scrollY < innerHeight * 0.5) active = null;
	};
</script>

<svelte:head>
	<title>{profile.name} · {profile.role}</title>
	<meta name="description" content={profile.tagline} />
	<meta property="og:title" content="{profile.name} — 作品集" />
	<meta property="og:description" content={profile.tagline} />
</svelte:head>

<svelte:window onscroll={onScroll} />

<div class="intro" aria-hidden="true"><span>{profile.handle}</span></div>
<div class="progress" style:transform="scaleX({progress})"></div>

<Scene />

<header class:scrolled>
	<a class="logo" href="#top"><i class="sphere"></i>{profile.handle}</a>
	<nav>
		{#each SECTIONS as [id, label] (id)}
			<a href="#{id}" class:active={active === id} aria-current={active === id ? 'true' : undefined}>{label}</a>
		{/each}
	</nav>
	<span class="live-pill"><i></i>{liveCount} 個專案上線中</span>
</header>

<main id="top">
	<!-- HERO -->
	<section class="hero">
		<p class="kicker">
			<span class="line"></span>
			{profile.role}
		</p>
		<h1 aria-label={profile.name}>
			{#each letters as ch, i (i)}
				<span class="ch" style:--i={i} aria-hidden="true">{ch}</span>
			{/each}
		</h1>
		<p class="tagline">{profile.tagline}</p>
		<div class="cta">
			<a class="btn primary" href="#work" {@attach magnetic(0.25)}>
				看看作品 <span aria-hidden="true">↓</span>
			</a>
			<a class="btn ghost" href="#contact" {@attach magnetic(0.25)}>打聲招呼</a>
		</div>

		<div class="hero-foot">
			<div class="scroll-hint"><span></span></div>
			<dl>
				<div><dt>上線專案</dt><dd>{data.projects.length}</dd></div>
				<div><dt>今年部署</dt><dd>{data.totalDeploys}</dd></div>
				<div><dt>所在地</dt><dd>{profile.location}</dd></div>
			</dl>
		</div>
	</section>

	<!-- 技能跑馬燈 -->
	<div class="marquee" aria-label="技能">
		<div class="ribbon">
			{#each [0, 1] as copy (copy)}
				<div class="track" aria-hidden={copy === 1}>
					{#each profile.skills as s (s)}<span>{s}</span><i>✦</i>{/each}
					{#each profile.skills as s (s)}<span>{s}</span><i>✦</i>{/each}
				</div>
			{/each}
		</div>
	</div>

	<!-- 作品 -->
	<section id="work" class="section">
		<div class="head">
			<p class="eyebrow" {@attach reveal()}>01 — 作品</p>
			<h2 {@attach reveal(80)}>正在線上<br /><em>跑著的東西</em></h2>
			<p class="lede" {@attach reveal(160)}>
				這些專案都部署在 Vercel，清單直接從 Vercel 抓，所以我一上線新東西，這裡就會自己長出來。
			</p>
		</div>

		{#if allTags.length > 1}
			<div class="filters" {@attach reveal()}>
				<button class:on={tag === null} onclick={() => (tag = null)}>全部 <small>{data.projects.length}</small></button>
				{#each allTags as t (t)}
					<button class:on={tag === t} onclick={() => (tag = t)}>{t}</button>
				{/each}
			</div>
		{/if}

		<div class="grid">
			{#each shown as project, i (project.id)}
				<div class="cell" class:wide={project.featured} {@attach reveal((i % 3) * 90)}>
					<ProjectCard {project} index={i} total={shown.length} />
				</div>
			{/each}
		</div>
	</section>

	<!-- 關於 -->
	<section id="about" class="section about">
		<div class="id-card-wrap" {@attach reveal()}>
			<div class="id-card" {@attach tilt(18)}>
								<div class="avatar">
					{#if profile.avatarUrl}
						<img src={profile.avatarUrl} alt={profile.name} />
					{:else}
						<span>{profile.name.charAt(0)}</span>
					{/if}
				</div>
				<div class="id-meta">
					<b>{profile.name}</b>
					<span>@{profile.handle}</span>
				</div>
				<div class="id-row">
					<span>ROLE</span><span>{profile.role}</span>
				</div>
				<div class="id-row">
					<span>BASE</span><span>{profile.location}</span>
				</div>
								<div class="id-glare"></div>
			</div>
		</div>

		<div class="about-text">
			<p class="eyebrow" {@attach reveal()}>02 — 關於我</p>
			<h2 {@attach reveal(80)}>嗨，我是 <em>{profile.name}</em></h2>
			<p class="bio" {@attach reveal(160)}>{profile.bio}</p>
			<ul class="skills" {@attach reveal(240)}>
				{#each profile.skills as s, i (s)}<li style:--i={i}>{s}</li>{/each}
			</ul>
		</div>
	</section>

	<!-- 部署動態 -->
	<section id="activity" class="section">
		<div class="head">
			<p class="eyebrow" {@attach reveal()}>03 — 動態</p>
			<h2 {@attach reveal(80)}>一整年的<br /><em>部署紀錄</em></h2>
			<p class="lede" {@attach reveal(160)}>
				像 GitHub 的綠格子，不過是立體的。每一根柱子是一天，越高代表那天推了越多版本上線。
			</p>
		</div>
		<div {@attach reveal(120)}>
			<Activity days={data.activity} />
		</div>
	</section>

	<!-- 聯絡 -->
	<section id="contact" class="section contact">
		<p class="eyebrow" {@attach reveal()}>04 — 聯絡</p>
		<h2 class="big" {@attach reveal(80)}>一起做<br /><em>點什麼？</em></h2>
		<p class="lede" {@attach reveal(160)}>有想法、有合作，或只是想聊聊，都歡迎找我。</p>
		<div class="contact-links" {@attach reveal(240)}>
			{#if profile.email}
				<a class="btn primary big" href="mailto:{profile.email}" {@attach magnetic(0.3)}>{profile.email}</a>
			{/if}
			{#each profile.links as l (l.url)}
				<a class="btn ghost big" href={l.url} target="_blank" rel="noreferrer" {@attach magnetic(0.3)}>
					{l.label} <span aria-hidden="true">↗</span>
				</a>
			{/each}
		</div>
	</section>
</main>

<footer>
	<span>© {new Date().getFullYear()} {profile.name}</span>
	<span>doraeyi.com · 用 SvelteKit + Three.js 做的</span>
</footer>

{#if showPerf}<PerfPanel />{/if}

{#if dev && (!data.source.vercel || !data.source.database)}
	<aside class="dev-note">
		{#if !data.source.vercel}<p>作品是<b>示範資料</b>：在 <code>.env</code> 設定 <code>VC_TOKEN</code> 就會換成真的。</p>{/if}
		{#if !data.source.database}<p>個人資料用預設值：設定 <code>DATABASE_URL</code> 並跑 <code>db/schema.sql</code>。</p>{/if}
	</aside>
{/if}

<style>
	/* ---------- 全域裝飾 ---------- */
	.intro {
		position: fixed;
		inset: 0;
		z-index: 100;
		display: grid;
		place-items: center;
		background: var(--bg);
		animation: curtain 0.7s cubic-bezier(0.8, 0, 0.2, 1) 0.45s forwards;
		pointer-events: none;
	}
	.intro span {
		font: 800 clamp(28px, 6vw, 64px) var(--font-display);
		letter-spacing: -0.03em;
		color: var(--text);
		animation: introText 0.9s var(--ease) both;
	}
	@keyframes introText {
		from {
			opacity: 0;
			transform: perspective(600px) rotateX(70deg) translateY(30px);
		}
	}
	@keyframes curtain {
		to {
			clip-path: inset(0 0 100% 0);
			visibility: hidden;
		}
	}
	.progress {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 2px;
		z-index: 60;
		transform-origin: left;
		background: var(--accent-grad);
	}

	/* ---------- 導覽列 ---------- */
	header {
		position: fixed;
		top: 14px;
		left: 50%;
		translate: -50% 0;
		z-index: 50;
		width: min(1180px, calc(100% - 32px));
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 16px;
		padding: 10px 12px 10px 20px;
		border-radius: var(--r-pill);
		border: 1px solid transparent;
		transition: 0.4s var(--ease);
	}
	header.scrolled {
		background: rgb(10 10 12 / 0.6);
		backdrop-filter: blur(18px) saturate(1.4);
		border-color: var(--line);
	}
	.logo {
		display: flex;
		align-items: center;
		gap: 10px;
		font: 800 18px var(--font-display);
		letter-spacing: -0.02em;
		text-decoration: none;
	}
	.logo i {
		width: 18px;
		height: 18px;
	}
	nav {
		display: flex;
		gap: 4px;
	}
	nav a {
		padding: 8px 14px;
		border-radius: var(--r-pill);
		text-decoration: none;
		font-size: 14px;
		color: var(--text-soft);
		transition: 0.25s;
	}
	nav a:hover {
		color: var(--text);
		background: rgb(255 255 255 / 0.07);
	}
	nav a.active {
		color: var(--text);
		background: rgb(139 123 255 / 0.16);
		box-shadow: inset 0 0 0 1px rgb(139 123 255 / 0.35);
	}
	.live-pill {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		padding: 8px 14px;
		border-radius: var(--r-pill);
		font: 500 12px var(--font-mono);
		background: rgb(255 255 255 / 0.04);
		color: var(--text-soft);
		border: 1px solid var(--line);
		white-space: nowrap;
	}
	.live-pill i {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--accent-2);
		animation: pulse 2s infinite;
	}
	@keyframes pulse {
		0% {
			box-shadow: 0 0 0 0 rgb(76 201 240 / 0.6);
		}
		70% {
			box-shadow: 0 0 0 8px transparent;
		}
	}
	@media (max-width: 760px) {
		nav {
			display: none;
		}
	}

	/* ---------- 共用 ---------- */
	main {
		position: relative;
		z-index: 3;
	}
	.section {
		padding: clamp(90px, 14vw, 180px) var(--pad);
		max-width: 1320px;
		margin: 0 auto;
	}
	.head {
		max-width: 760px;
		margin-bottom: 56px;
	}
	.eyebrow {
		margin: 0 0 18px;
		font: 500 13px var(--font-mono);
		letter-spacing: 0.12em;
		color: var(--muted);
	}
	h2 {
		margin: 0;
		font: 800 clamp(44px, 7.5vw, 104px) / 1.02 var(--font-display);
		letter-spacing: -0.04em;
	}
	h2 em {
		font-style: normal;
		background: var(--accent-grad);
		background-clip: text;
		color: transparent;
	}
	.lede {
		margin: 24px 0 0;
		max-width: 560px;
		font-size: clamp(16px, 1.4vw, 19px);
		color: var(--text-soft);
		line-height: 1.75;
	}
	.btn {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		padding: 15px 26px;
		border-radius: var(--r-pill);
		font-weight: 600;
		font-size: 15px;
		text-decoration: none;
		transition:
			transform 0.35s var(--ease),
			background 0.3s,
			box-shadow 0.3s;
	}
	.btn.primary {
		color: var(--bg);
		background: var(--text);
	}
	.btn.primary:hover {
		background: #fff;
		box-shadow: 0 12px 40px -12px rgb(255 255 255 / 0.5);
	}
	.btn.ghost {
		border: 1px solid rgb(255 255 255 / 0.2);
		background: rgb(255 255 255 / 0.04);
	}
	.btn.ghost:hover {
		background: rgb(255 255 255 / 0.1);
	}
	.btn.big {
		padding: 20px 32px;
		font-size: 17px;
	}

	/* ---------- Hero ---------- */
	.hero {
		position: relative;
		min-height: 100svh;
		display: flex;
		flex-direction: column;
		justify-content: center;
		padding: 120px var(--pad) 40px;
		max-width: 1320px;
		margin: 0 auto;
	}
	.kicker {
		display: flex;
		align-items: center;
		gap: 14px;
		margin: 0 0 22px;
		font: 500 14px var(--font-mono);
		letter-spacing: 0.06em;
		color: var(--text-soft);
		animation: fadeUp 0.8s var(--ease) 0.6s both;
	}
	.kicker .line {
		width: 48px;
		height: 1px;
		background: linear-gradient(90deg, transparent, var(--muted));
	}
	h1 {
		margin: 0;
		font: 800 clamp(44px, 13.5vw, 220px) / 0.9 var(--font-display);
		letter-spacing: -0.05em;
		perspective: 800px;
		display: flex;
		white-space: nowrap;
	}
	.ch {
		display: inline-block;
		transform-origin: 50% 100%;
		background: linear-gradient(180deg, #fff 35%, #9a9aa2);
		background-clip: text;
		color: transparent;
		animation: flipIn 1.1s cubic-bezier(0.2, 0.9, 0.25, 1.2) both;
		animation-delay: calc(0.55s + var(--i) * 45ms);
		transition: transform 0.5s var(--ease);
	}
	.ch:hover {
		transform: translateY(-14px) rotateX(-20deg) rotateY(14deg);
	}
	@keyframes flipIn {
		from {
			opacity: 0;
			transform: translate3d(0, 0.5em, -200px) rotateX(-100deg);
			filter: blur(10px);
		}
	}
	@keyframes fadeUp {
		from {
			opacity: 0;
			transform: translateY(24px);
		}
	}
	.tagline {
		margin: 30px 0 0;
		max-width: 520px;
		font-size: clamp(18px, 2vw, 24px);
		line-height: 1.55;
		color: var(--text-soft);
		animation: fadeUp 0.8s var(--ease) 0.9s both;
	}
	.cta {
		display: flex;
		flex-wrap: wrap;
		gap: 14px;
		margin-top: 40px;
		animation: fadeUp 0.8s var(--ease) 1s both;
	}
	.hero-foot {
		position: absolute;
		left: var(--pad);
		right: var(--pad);
		bottom: 34px;
		display: flex;
		align-items: flex-end;
		justify-content: space-between;
		animation: fadeUp 0.8s var(--ease) 1.15s both;
	}
	.scroll-hint {
		width: 26px;
		height: 42px;
		border-radius: 20px;
		border: 1.5px solid rgb(255 255 255 / 0.35);
		display: grid;
		justify-items: center;
		padding-top: 8px;
	}
	.scroll-hint span {
		width: 3px;
		height: 8px;
		border-radius: 3px;
		background: #fff;
		animation: wheel 1.8s ease-in-out infinite;
	}
	@keyframes wheel {
		60% {
			transform: translateY(12px);
			opacity: 0;
		}
	}
	dl {
		display: flex;
		gap: clamp(20px, 4vw, 54px);
		margin: 0;
	}
	dt {
		font: 500 11px var(--font-mono);
		letter-spacing: 0.1em;
		color: var(--muted);
	}
	dd {
		margin: 4px 0 0;
		font: 800 22px var(--font-display);
		letter-spacing: -0.02em;
	}
	@media (max-width: 700px) {
		.hero {
			justify-content: flex-end;
			padding-bottom: 150px;
		}
		.hero-foot dl div:last-child {
			display: none;
		}
	}

	/* ---------- 跑馬燈 ---------- */
	.marquee {
		position: relative;
		padding: 40px 0;
		perspective: 900px;
		overflow: hidden;
	}
	.ribbon {
		display: flex;
		width: max-content;
		transform: rotateX(14deg);
		border-block: 1px solid var(--line);
		margin: 0 -40px;
	}
	.track {
		display: flex;
		align-items: center;
		gap: 28px;
		padding: 18px 14px;
		white-space: nowrap;
		animation: marquee 38s linear infinite;
		font: 800 clamp(26px, 3.6vw, 46px) var(--font-display);
		letter-spacing: -0.03em;
		color: var(--text-soft);
	}
	.track i {
		font-style: normal;
		font-size: 0.5em;
		color: var(--accent);
	}
	@keyframes marquee {
		to {
			transform: translateX(-100%);
		}
	}

	/* ---------- 作品 ---------- */
	.filters {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-bottom: 36px;
	}
	.filters button {
		padding: 9px 16px;
		border-radius: var(--r-pill);
		border: 1px solid var(--line);
		background: rgb(255 255 255 / 0.03);
		color: var(--text-soft);
		font: inherit;
		font-size: 14px;
		cursor: pointer;
		transition: 0.25s;
	}
	.filters button:hover {
		color: var(--text);
		border-color: rgb(255 255 255 / 0.25);
	}
	.filters button.on {
		background: var(--text);
		color: var(--bg);
		border-color: var(--text);
	}
	.filters small {
		opacity: 0.6;
		margin-left: 4px;
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		grid-auto-flow: dense;
		gap: 26px;
	}
	.cell.wide {
		grid-column: span 2;
	}
	.cell > :global(.wrap) {
		height: 100%;
	}
	@media (max-width: 1080px) {
		.grid {
			grid-template-columns: repeat(2, minmax(0, 1fr));
		}
	}
	@media (max-width: 680px) {
		.grid {
			grid-template-columns: minmax(0, 1fr);
		}
		.cell.wide {
			grid-column: auto;
		}
	}

	/* ---------- 關於 ---------- */
	.about {
		display: grid;
		grid-template-columns: minmax(280px, 400px) 1fr;
		gap: clamp(40px, 7vw, 110px);
		align-items: center;
	}
	@media (max-width: 860px) {
		.about {
			grid-template-columns: 1fr;
		}
	}
	.id-card-wrap {
		perspective: 1000px;
		width: 100%;
		max-width: 360px;
		margin-inline: auto;
	}
	.id-card {
		--rx: 0deg;
		--ry: 0deg;
		--mx: 50%;
		--my: 50%;
		position: relative;
		aspect-ratio: 0.68;
		border-radius: var(--r-lg);
		padding: 28px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		overflow: hidden;
		background: linear-gradient(150deg, #1a1a1e, #0d0d10 60%);
		border: 1px solid rgb(255 255 255 / 0.12);
		transform: rotateX(var(--rx)) rotateY(var(--ry));
		transform-style: preserve-3d;
		transition: transform 0.6s var(--ease);
		box-shadow: 0 60px 100px -40px rgb(0 0 0 / 0.9);
		animation: float 8s ease-in-out infinite;
	}
	.id-card:hover {
		transition-duration: 0.1s;
		animation-play-state: paused;
	}
	@keyframes float {
		50% {
			translate: 0 -14px;
		}
	}
	.avatar {
		width: 100%;
		flex: 1;
		border-radius: var(--r-md);
		overflow: hidden;
		display: grid;
		place-items: center;
		/* 跟作品卡封面同一種做法：深底 + 色階光暈 */
		background:
			radial-gradient(110% 90% at 80% 0%, color-mix(in oklab, var(--accent) 38%, transparent), transparent 65%),
			radial-gradient(90% 80% at 0% 100%, color-mix(in oklab, var(--accent-2) 22%, transparent), transparent 70%),
			#0c0c10;
		transform: translateZ(40px);
	}
	.avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.avatar span {
		font: 800 150px/1 var(--font-display);
		color: transparent;
		-webkit-text-stroke: 1.5px rgb(255 255 255 / 0.55);
	}
	.id-meta {
		display: grid;
		transform: translateZ(30px);
	}
	.id-meta b {
		font: 800 26px var(--font-display);
		letter-spacing: -0.03em;
	}
	.id-meta span,
	.id-row {
		font: 500 13px var(--font-mono);
		color: var(--muted);
	}
	.id-row {
		display: flex;
		justify-content: space-between;
		gap: 12px;
		padding-top: 10px;
		border-top: 1px dashed rgb(255 255 255 / 0.12);
		transform: translateZ(20px);
	}
	.id-row span:last-child {
		color: var(--text-soft);
		text-align: right;
	}
	.id-glare {
		position: absolute;
		inset: 0;
		pointer-events: none;
		background: radial-gradient(420px circle at var(--mx) var(--my), rgb(255 255 255 / 0.18), transparent 45%);
	}
	.bio {
		margin: 28px 0 0;
		font-size: clamp(18px, 1.8vw, 23px);
		line-height: 1.75;
		max-width: 36em;
		color: var(--text-soft);
	}
	.skills {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		margin: 36px 0 0;
		padding: 0;
		list-style: none;
	}
	.skills li {
		padding: 10px 18px;
		border-radius: var(--r-pill);
		background: var(--surface);
		border: 1px solid var(--line);
		font-weight: 600;
		font-size: 15px;
		transition:
			transform 0.4s var(--ease),
			border-color 0.3s;
	}
	.skills li:hover {
		transform: translateY(-4px);
		border-color: color-mix(in oklab, var(--accent) 55%, transparent);
	}

	/* ---------- 聯絡 ---------- */
	.contact {
		text-align: center;
		display: flex;
		flex-direction: column;
		align-items: center;
		padding-bottom: 120px;
	}
	.contact .lede {
		margin-inline: auto;
	}
	h2.big {
		font-size: clamp(56px, 11vw, 160px);
	}
	.contact-links {
		display: flex;
		flex-wrap: wrap;
		justify-content: center;
		gap: 14px;
		margin-top: 44px;
	}

	footer {
		position: relative;
		z-index: 3;
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		gap: 10px;
		padding: 28px var(--pad);
		border-top: 1px solid var(--line);
		font: 500 13px var(--font-mono);
		color: var(--muted);
		max-width: 1320px;
		margin: 0 auto;
	}

	.dev-note {
		position: fixed;
		left: 16px;
		bottom: 16px;
		z-index: 70;
		max-width: 380px;
		padding: 12px 16px;
		border-radius: var(--r-sm);
		font-size: 13px;
		background: rgb(255 176 32 / 0.12);
		border: 1px solid rgb(255 176 32 / 0.4);
		color: #ffd58a;
		backdrop-filter: blur(10px);
	}
	.dev-note p {
		margin: 2px 0;
	}
	.dev-note code {
		font-family: var(--font-mono);
		font-size: 12px;
	}
</style>
