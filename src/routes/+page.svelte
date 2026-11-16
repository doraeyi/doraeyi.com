<script lang="ts">
	import { dev } from '$app/env';
	import { page } from '$app/state';
	import Stage from '#lib/components/Stage.svelte';
	import PerfPanel from '#lib/components/PerfPanel.svelte';
	import AboutCard from '#lib/components/AboutCard.svelte';
	import DeskRow from '#lib/components/DeskRow.svelte';
	import GithubCard from '#lib/components/GithubCard.svelte';
	import ProjectCard from '#lib/components/ProjectCard.svelte';
	import QrCard from '#lib/components/QrCard.svelte';
	import RoomCard from '#lib/components/RoomCard.svelte';
	import { ROOMS, timeAgo } from '#lib/format.js';
	import { buildWorld, domainOf } from '#lib/room/world.js';
	import type { Focus } from '#lib/room/protocol.js';
	import type { SceneMode } from '#lib/room/stats.svelte.js';
	import type { Host } from '#lib/types.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const profile = $derived(data.profile);
	/** ?night=1 / ?night=0 固定晚上或白天，QR 掃描測試兩種光線都要測 */
	const nightParam = $derived(page.url.searchParams.get('night'));
	const world = $derived(buildWorld(data, nightParam === null ? undefined : nightParam === '1'));
	const byHost = (h: Host) => data.projects.filter((p) => p.host === h);
	const asleep = $derived(data.projects.filter((p) => p.asleep).length);
	const awake = $derived(data.projects.length - asleep);
	// 「我的網域」不放 Vercel 自動產生的團隊網址（xxx-liams-projects-045ae9db.vercel.app），那不是取的名字
	const domains = $derived(
		[...new Set(data.projects.map((p) => domainOf(p.url)).filter(Boolean))].filter((d) => !/-projects(-[a-z0-9]+)?\.vercel\.app$/.test(d!)) as string[]
	);

	/** 畫面焦點：全景、房間、GitHub、某張桌子，或「關於我」 */
	let view = $state<Focus | 'about'>('all');
	/** 資訊卡開著沒；手機上可以只看房間、不開卡片 */
	let panel = $state(false);
	let mode = $state<SceneMode>('pending');
	let hint = $state(true);
	/** 往下拉變出來的 GitHub QR code；pull 是拉到一半的進度 */
	let qr = $state(false);
	let pull = $state(0);

	const selected = $derived(data.projects.find((p) => p.key === view) ?? null);
	const roomView = $derived<Host | null>(view === 'vercel' ? 'vercel' : view === 'vm' ? 'vm' : null);
	const stageFocus = $derived<Focus>(view === 'about' ? 'all' : view);
	const showPerf = $derived(page.url.searchParams.get('debug') === 'perf');

	const portrait = () => innerWidth / innerHeight < 0.9;

	$effect(() => {
		// 直式手機放不下兩間房間，一開始先看 Vercel 房
		if (portrait()) view = 'vercel';
		const t = setTimeout(() => (hint = false), 7000);
		return () => clearTimeout(t);
	});

	/** 資訊卡打開前焦點在哪（例如下方的按鈕），關掉時放回去，鍵盤使用者不用從頭 Tab */
	let returnTo: HTMLElement | null = null;

	function remember() {
		const el = document.activeElement;
		if (el instanceof HTMLElement && el !== document.body && !el.closest('.panel')) returnTo = el;
	}

	function open(v: Focus | 'about') {
		hint = false;
		qr = false;
		if (view === v && panel) return close();
		remember();
		view = v;
		panel = true;
	}

	function close() {
		panel = false;
		if (returnTo?.isConnected) returnTo.focus({ preventScroll: true });
		returnTo = null;
		// 手機上關掉卡片後留在原本的房間，桌面版回到全景
		if (!portrait()) view = 'all';
		else if (selected) view = selected.host;
		else if (view === 'about' || view === 'github') view = 'vercel';
	}

	function onqr(on: boolean, p: number) {
		qr = on;
		pull = p;
		if (on) {
			panel = false;
			hint = false;
		}
	}

	function select(key: string) {
		hint = false;
		view = key;
		// 'all'：滾輪拉遠到全景，資訊卡收起來
		if (key === 'all') panel = false;
		else if (data.projects.some((p) => p.key === key)) {
			remember();
			panel = true;
		}
	}

	const nextPatrol = $derived(data.nextCheckAt <= Date.now() ? '巡房中' : timeAgo(data.nextCheckAt));

	/** 分享預覽圖跟分享連結都用正式網址，不管是從哪個網域進來的 */
	const SITE = 'https://doraeyi.com';
</script>

<svelte:head>
	<title>{profile.name} · {profile.role}</title>
	<meta name="description" content="{profile.tagline} 兩間 3D 房間，每個上線中的專案都有一位管理員顧著。" />
	<meta property="og:type" content="website" />
	<meta property="og:url" content={SITE} />
	<meta property="og:title" content="{profile.name} — 作品集" />
	<meta property="og:description" content="{profile.tagline} 兩間 3D 房間，一直往下拉會變成我的 GitHub QR code。" />
	<meta property="og:image" content="{SITE}/og.jpg" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="兩間 3D 小房間，每張桌子前都有一隻顧專案的機器人、貓或狗" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<svelte:window onkeydown={(e) => e.key === 'Escape' && panel && close()} />

{#if mode !== 'list'}
	<Stage {world} focus={stageFocus} panel={panel && view !== 'all'} {qr} {onqr} onselect={select} onmode={(m) => (mode = m)} />
{/if}

<!-- 上方：名字 + 即時狀態 -->
<header class="hud">
	<button class="brand" onclick={() => open('about')} aria-pressed={view === 'about'}>
		<i class="sphere"></i>
		<span><b>{profile.handle}</b><small>{profile.role}</small></span>
	</button>
	<ul class="chips" aria-label="即時狀態">
		<li><i class="dot up"></i>{awake} 位值班中</li>
		{#if asleep}<li class="warn"><i class="dot down"></i>{asleep} 位睡著了</li>{/if}
		{#if data.github}<li class="hide-sm">GitHub 一年 {data.github.total} 次提交</li>{/if}
		<li class="hide-sm">下次巡房 {nextPatrol}</li>
	</ul>
</header>

{#if mode !== 'list' && !qr && pull > 0.05}
	<p class="pull" style:--p={Math.min(1, pull)}>繼續往下拉，變出 GitHub QR code<i></i></p>
{:else if qr && pull < -0.05}
	<p class="pull" style:--p={Math.min(1, -pull)}>繼續往上推，回到房間<i></i></p>
{:else if hint && mode !== 'list'}
	<p class="hint">拖曳旋轉・點桌子看專案・一直往下拉有驚喜</p>
{/if}

<!-- 下方：切換停靠點 -->
<nav class="dock" aria-label="切換視角">
	<button class:on={view === 'all' && !qr} onclick={() => ((view = 'all'), (panel = false), (qr = false))}>全景</button>
	<button class:on={view === 'vercel' && !qr} onclick={() => open('vercel')}><i aria-hidden="true">▲ </i>Vercel <small>{byHost('vercel').length}</small></button>
	<button class:on={view === 'vm' && !qr} onclick={() => open('vm')}><i aria-hidden="true">▤ </i>VM <small>{byHost('vm').length}</small></button>
	{#if data.github}<button class:on={view === 'github' && !qr} onclick={() => open('github')}>GitHub</button>{/if}
	<button class:on={view === 'about' && !qr} onclick={() => open('about')}>關於我</button>
	<button class:on={qr} onclick={() => ((qr = !qr), (panel = false))} aria-pressed={qr}>QR</button>
</nav>

{#if qr}<QrCard url={data.qr.url} name={profile.name} />{/if}

<!-- 資訊卡：桌面版在右邊，手機版從下面滑上來 -->
{#if panel && view !== 'all'}
	{#key view}
		<!-- 打開或換內容時焦點移進卡片，螢幕閱讀器跟鍵盤都從卡片開頭接著走 -->
		<aside class="panel" aria-live="polite" tabindex="-1" {@attach (el) => el.focus({ preventScroll: true })}>
			<button class="close" onclick={close} aria-label="關閉">✕</button>

			{#if selected}
				<ProjectCard project={selected} />
			{:else if roomView}
				<RoomCard host={roomView} projects={byHost(roomView)} onselect={select} />
			{:else if view === 'github' && data.github}
				<GithubCard github={data.github} />
			{:else if view === 'about'}
				<AboutCard {profile} {domains} />
			{/if}
		</aside>
	{/key}
{/if}

<!-- 沒有 3D 時的清單；有 3D 時也留著給搜尋引擎跟螢幕閱讀器 -->
<main class:list={mode === 'list'} class:sr-only={mode !== 'list'}>
	<h1>{profile.name}</h1>
	<p>{profile.tagline}</p>
	{#each ['vercel', 'vm'] as const as host (host)}
		<section>
			<h2>{ROOMS[host].name}</h2>
			<p>{ROOMS[host].blurb}</p>
			<ul>
				{#each byHost(host) as p (p.key)}
					<li><DeskRow project={p} onselect={select} showStatus /></li>
				{/each}
			</ul>
		</section>
	{/each}
</main>

{#if showPerf}<PerfPanel />{/if}

{#if dev && (!data.source.vercel || !data.source.database || !data.source.github)}
	<aside class="dev-note">
		{#if !data.source.vercel}<p>Vercel 房是<b>示範資料</b>：在 <code>.env</code> 設定 <code>VC_TOKEN</code> 就會換成真的。</p>{/if}
		{#if !data.source.database}<p>讀不到資料庫：看伺服器 log 的 <code>[site]</code> 錯誤。</p>{/if}
		{#if !data.source.github}<p>抓不到 GitHub 資料，地毯不會出現。</p>{/if}
	</aside>
{/if}

<style>
	:global(body) {
		height: 100dvh;
		overflow: hidden;
		background:
			radial-gradient(ellipse 80% 60% at 50% 40%, #1d1b3a 0%, transparent 70%),
			radial-gradient(ellipse 60% 50% at 80% 100%, #12243a 0%, transparent 70%),
			var(--bg);
	}

	button {
		font: inherit;
		color: inherit;
		cursor: pointer;
	}

	/* ---------- 上方 ---------- */
	.hud {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 10;
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
		padding: 16px var(--pad);
		pointer-events: none;
	}
	.hud > * {
		pointer-events: auto;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 6px 16px 6px 6px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: rgb(14 14 22 / 0.6);
		backdrop-filter: blur(10px);
		text-align: left;
	}
	.brand .sphere {
		width: 34px;
		height: 34px;
		flex: none;
	}
	.brand b {
		display: block;
		font-weight: 800;
		letter-spacing: -0.01em;
	}
	.brand small {
		display: block;
		color: var(--muted);
		font-size: 12px;
		line-height: 1.3;
	}
	.chips {
		display: flex;
		flex-wrap: wrap;
		justify-content: flex-end;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
	}
	.chips li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 14px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: rgb(14 14 22 / 0.6);
		backdrop-filter: blur(10px);
		font-size: 13px;
		color: var(--text-soft);
	}
	.chips li.warn {
		color: #ffb3c1;
		border-color: rgb(255 93 122 / 0.35);
	}

	.hint {
		position: fixed;
		left: 50%;
		bottom: 92px;
		z-index: 10;
		translate: -50% 0;
		margin: 0;
		padding: 8px 16px;
		border-radius: var(--r-pill);
		background: rgb(14 14 22 / 0.7);
		color: var(--text-soft);
		font-size: 13px;
		white-space: nowrap;
		pointer-events: none;
		animation: hintIn 0.6s var(--ease) 2.2s both;
	}
	@keyframes hintIn {
		from {
			opacity: 0;
			translate: -50% 10px;
		}
	}

	.pull {
		position: fixed;
		left: 50%;
		bottom: 92px;
		z-index: 10;
		translate: -50% 0;
		overflow: hidden;
		margin: 0;
		padding: 9px 18px;
		border: 1px solid rgb(139 123 255 / 0.4);
		border-radius: var(--r-pill);
		background: rgb(14 14 22 / 0.8);
		color: var(--text);
		font-size: 13px;
		font-weight: 600;
		white-space: nowrap;
		pointer-events: none;
	}
	.pull i {
		position: absolute;
		left: 0;
		bottom: 0;
		height: 3px;
		width: 100%;
		background: var(--accent-grad);
		transform-origin: left;
		transform: scaleX(var(--p));
	}

	/* ---------- 下方切換列 ---------- */
	.dock {
		position: fixed;
		left: 50%;
		bottom: max(20px, env(safe-area-inset-bottom));
		z-index: 30;
		translate: -50% 0;
		display: flex;
		gap: 4px;
		max-width: calc(100vw - 32px);
		overflow-x: auto;
		padding: 5px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: rgb(14 14 22 / 0.72);
		backdrop-filter: blur(12px);
		scrollbar-width: none;
	}
	.dock button {
		flex: none;
		padding: 9px 16px;
		border: 0;
		border-radius: var(--r-pill);
		background: none;
		color: var(--text-soft);
		font-size: 14px;
		font-weight: 600;
		transition:
			background 0.25s var(--ease),
			color 0.25s var(--ease);
	}
	.dock button:hover {
		color: var(--text);
	}
	.dock button.on {
		background: var(--text);
		color: var(--bg);
	}
	.dock small {
		opacity: 0.6;
		font-weight: 500;
	}
	.dock i {
		margin-right: 5px;
		font-style: normal;
	}

	/* ---------- 資訊卡 ---------- */
	.panel {
		position: fixed;
		top: 84px;
		right: var(--pad);
		bottom: 92px;
		z-index: 20;
		width: min(400px, calc(100vw - 32px));
		overflow-y: auto;
		padding: 26px 24px;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: rgb(16 16 26 / 0.86);
		backdrop-filter: blur(16px);
		box-shadow: 0 30px 80px -20px rgb(0 0 0 / 0.6);
		animation: panelIn 0.45s var(--ease) both;
		overscroll-behavior: contain;
	}
	.panel:focus-visible {
		outline: none;
	}
	@keyframes panelIn {
		from {
			opacity: 0;
			transform: translateX(24px) scale(0.98);
		}
	}
	.close {
		position: absolute;
		top: 14px;
		right: 14px;
		width: 34px;
		height: 34px;
		border: 1px solid var(--line);
		border-radius: 50%;
		background: none;
		color: var(--muted);
	}
	.close:hover {
		color: var(--text);
	}
	/* 四種資訊卡（components/*Card.svelte）共用的排版 */
	.panel :global(.eyebrow) {
		margin: 0 40px 6px 0;
		color: var(--muted);
		font-size: 13px;
	}
	.panel :global(h2) {
		margin: 0;
		font-size: clamp(24px, 3vw, 30px);
		font-weight: 800;
		letter-spacing: -0.02em;
		line-height: 1.2;
	}
	.panel :global(h3) {
		margin: 22px 0 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}
	.panel :global(.facts) {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin: 14px 0 0;
	}
	.panel :global(.facts div) {
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: rgb(255 255 255 / 0.04);
	}
	.panel :global(.facts dt) {
		color: var(--muted);
		font-size: 12px;
	}
	.panel :global(.facts dd) {
		margin: 0;
		font-weight: 700;
		font-family: var(--font-mono);
	}
	.panel :global(.desc) {
		margin: 16px 0 0;
		color: var(--text-soft);
		font-size: 15px;
	}
	.panel :global(.tags) {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 14px 0 0;
		padding: 0;
		list-style: none;
	}
	.panel :global(.tags li) {
		padding: 4px 11px;
		border-radius: var(--r-pill);
		border: 1px solid var(--line);
		color: var(--text-soft);
		font-size: 12px;
	}
	.panel :global(.actions) {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 22px;
	}

	/* 清單模式的桌子清單 */
	main ul {
		display: grid;
		gap: 6px;
		margin: 18px 0 0;
		padding: 0;
		list-style: none;
	}

	/* ---------- 清單模式 ---------- */
	main.list {
		position: fixed;
		inset: 0;
		overflow-y: auto;
		padding: 96px var(--pad) 120px;
	}
	main.list h1 {
		margin: 0;
		font-size: clamp(36px, 8vw, 64px);
		letter-spacing: -0.03em;
	}
	main.list section {
		margin-top: 40px;
		max-width: 720px;
	}
	main.list p {
		color: var(--text-soft);
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		overflow: hidden;
		clip-path: inset(50%);
		white-space: nowrap;
	}
	/* 有 3D 時清單藏起來給螢幕閱讀器用；用 Tab 走進來就浮出來，鍵盤也能選桌子 */
	main.sr-only:focus-within {
		position: fixed;
		top: 84px;
		left: var(--pad);
		z-index: 25;
		width: min(360px, calc(100vw - 32px));
		height: auto;
		max-height: calc(100dvh - 190px);
		overflow-y: auto;
		padding: 20px;
		border: 1px solid var(--line);
		border-radius: var(--r-lg);
		background: rgb(16 16 26 / 0.92);
		backdrop-filter: blur(16px);
		clip-path: none;
		white-space: normal;
		overscroll-behavior: contain;
	}
	main.sr-only:focus-within h1,
	main.sr-only:focus-within > p {
		display: none;
	}
	main.sr-only:focus-within section + section {
		margin-top: 20px;
	}
	main.sr-only:focus-within h2 {
		margin: 0;
		font-size: 15px;
	}
	main.sr-only:focus-within section p {
		margin: 4px 0 0;
		color: var(--muted);
		font-size: 13px;
	}
	main.sr-only:focus-within ul {
		margin-top: 10px;
	}

	.dev-note {
		position: fixed;
		left: 16px;
		bottom: 88px;
		z-index: 30;
		max-width: 340px;
		padding: 10px 14px;
		border-radius: var(--r-sm);
		background: rgb(60 40 10 / 0.9);
		color: #ffe2a8;
		font-size: 12px;
	}
	.dev-note p {
		margin: 4px 0;
	}

	@media (max-width: 720px) {
		.hide-sm {
			display: none !important;
		}
		.hud {
			padding: 12px 16px;
		}
		.brand small {
			display: none;
		}
		.chips li {
			padding: 6px 11px;
			font-size: 12px;
		}
		/* 手機：資訊卡變成底部抽屜，上半部還看得到 3D */
		.panel {
			top: auto;
			left: 0;
			right: 0;
			bottom: 0;
			width: auto;
			max-height: 58dvh;
			padding: 22px 20px calc(96px + env(safe-area-inset-bottom));
			border-radius: var(--r-lg) var(--r-lg) 0 0;
			animation-name: sheetIn;
		}
		@keyframes sheetIn {
			from {
				transform: translateY(40%);
				opacity: 0;
			}
		}
		.hint {
			bottom: 84px;
			font-size: 12px;
		}
		/* 六顆按鈕要一次放得下，最右邊的 QR 不能被擠到要滑才看得到 */
		.dock {
			left: 16px;
			right: 16px;
			translate: none;
			max-width: none;
			gap: 0;
			padding: 4px;
		}
		.dock button {
			flex: 1 1 auto;
			padding: 9px 6px;
			font-size: 13px;
		}
		.dock i,
		.dock small {
			display: none;
		}
	}
</style>
