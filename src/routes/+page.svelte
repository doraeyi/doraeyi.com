<script lang="ts">
	import { dev } from '$app/env';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import Stage from '#lib/components/Stage.svelte';
	import PerfPanel from '#lib/components/PerfPanel.svelte';
	import { frameworkLabel, timeAgo } from '#lib/format.js';
	import { buildWorld, domainOf, KEEPER_LABEL, keeperName } from '#lib/room/world.js';
	import type { Focus } from '#lib/room/protocol.js';
	import type { SceneMode } from '#lib/room/stats.svelte.js';
	import type { Host, Keeper, Project } from '#lib/types.js';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const profile = $derived(data.profile);
	/** ?night=1 / ?night=0 固定晚上或白天，QR 掃描測試兩種光線都要測 */
	const nightParam = $derived(page.url.searchParams.get('night'));
	const world = $derived(buildWorld(data, nightParam === null ? undefined : nightParam === '1'));
	const byHost = (h: Host) => data.projects.filter((p) => p.host === h);
	const asleep = $derived(data.projects.filter((p) => p.asleep).length);
	const awake = $derived(data.projects.length - asleep);
	const domains = $derived([...new Set(data.projects.map((p) => domainOf(p.url)).filter(Boolean))] as string[]);

	const EMOJI: Record<Keeper, string> = { robot: '🤖', cat: '🐱', dog: '🐶' };
	const ROOMS: Record<Host, { name: string; blurb: string }> = {
		vercel: { name: 'Vercel 房', blurb: '部署在 Vercel 上的專案，清單直接從 Vercel 抓，上線新東西這裡就會多一張桌子。' },
		vm: { name: 'VM 機房', blurb: '跑在同事 VM 上的專案：Docker 容器、Traefik 轉網域，GitHub Actions 推上去自動部署。' }
	};

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

	function open(v: Focus | 'about') {
		hint = false;
		qr = false;
		if (view === v && panel) return close();
		view = v;
		panel = true;
	}

	function close() {
		panel = false;
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
		else if (data.projects.some((p) => p.key === key)) panel = true;
	}

	const status = (p: Project) =>
		p.asleep ? { cls: 'down', text: '睡著了' } : p.health ? { cls: 'up', text: '醒著值班中' } : { cls: 'idle', text: '等第一次巡房' };

	const nextPatrol = $derived(data.nextCheckAt <= Date.now() ? '巡房中' : timeAgo(data.nextCheckAt));

	/** 分享預覽圖跟分享連結都用正式網址，不管是從哪個網域進來的 */
	const SITE = 'https://doraeyi.com';

	/** 手機的系統分享面板（LINE、IG 限動…），桌面瀏覽器多半沒有就不顯示按鈕 */
	let canShare = $state(false);
	onMount(() => {
		canShare = typeof navigator.share === 'function';
	});

	function share() {
		navigator.share({ title: `${profile.name} 的 GitHub`, url: data.qr.url }).catch(() => {});
	}
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
	<button class:on={view === 'vercel' && !qr} onclick={() => open('vercel')}>▲ Vercel <small>{byHost('vercel').length}</small></button>
	<button class:on={view === 'vm' && !qr} onclick={() => open('vm')}>▤ VM <small>{byHost('vm').length}</small></button>
	{#if data.github}<button class:on={view === 'github' && !qr} onclick={() => open('github')}>GitHub</button>{/if}
	<button class:on={view === 'about' && !qr} onclick={() => open('about')}>關於我</button>
	<button class:on={qr} onclick={() => ((qr = !qr), (panel = false))} aria-pressed={qr}>QR</button>
</nav>

{#if qr}
	<aside class="qr-card">
		<p>
			<b class="far">掃一下，追蹤我的 GitHub</b>
			<b class="near">在手機上？存下來或直接分享</b>
			<span>往上推或按「全景」回到房間</span>
		</p>
		<a class="btn" href="/qr.png" download="doraeyi-github-qr.png">存圖</a>
		{#if canShare}
			<button class="btn" onclick={share}>分享</button>
		{/if}
		<a class="btn primary" href={data.qr.url} target="_blank" rel="noreferrer">開啟 ↗</a>
	</aside>
{/if}

<!-- 資訊卡：桌面版在右邊，手機版從下面滑上來 -->
{#if panel && view !== 'all'}
	{#key view}
		<aside class="panel" aria-live="polite">
			<button class="close" onclick={close} aria-label="關閉">✕</button>

			{#if selected}
				{@const s = status(selected)}
				<p class="eyebrow">{selected.host === 'vercel' ? 'Vercel 房' : 'VM 機房'}・{EMOJI[selected.keeper]} {keeperName(selected.key, selected.keeper)}（{KEEPER_LABEL[selected.keeper]}）管理中</p>
				<h2>{selected.title}</h2>
				{#if selected.url}<a class="domain" href={selected.url} target="_blank" rel="noreferrer">{domainOf(selected.url)} ↗</a>{/if}
				{#if selected.shot && !selected.asleep}
					<a class="shot" href={selected.url} target="_blank" rel="noreferrer">
						<img src={selected.shot} alt="{selected.title} 首頁截圖" width="640" height="400" />
					</a>
				{/if}

				<div class="state {s.cls}">
					<b>{s.text}</b>
					{#if selected.asleep}
						<span>管理員上次去看時{selected.health?.note ?? '網站沒有回應'}，累到睡著了。等網站恢復，下一次巡房就會醒來。</span>
					{:else if selected.health}
						<span>網站正常，管理員每 12 小時會再去看一次。</span>
					{:else}
						<span>{selected.url ? '還沒巡過這個專案，下一輪就會去看。' : '這個專案沒有公開網址，管理員只是坐著陪它。'}</span>
					{/if}
				</div>

				{#if selected.health}
					<dl class="facts">
						<div><dt>上次巡房</dt><dd>{timeAgo(selected.health.checkedAt)}</dd></div>
						<div><dt>回應時間</dt><dd>{selected.health.ms !== null ? `${selected.health.ms} ms` : '—'}</dd></div>
						<div><dt>HTTP</dt><dd>{selected.health.status ?? '—'}</dd></div>
						<div><dt>妥善率</dt><dd>{(selected.health.uptime * 100).toFixed(selected.health.uptime === 1 ? 0 : 1)}%</dd></div>
					</dl>
				{/if}

				{#if selected.description}<p class="desc">{selected.description}</p>{/if}
				<ul class="tags">
					{#if selected.framework}<li>{frameworkLabel(selected.framework)}</li>{/if}
					{#each selected.tags as t (t)}<li>{t}</li>{/each}
					{#if selected.lastDeployAt}<li>{timeAgo(selected.lastDeployAt)}部署</li>{/if}
				</ul>
				<div class="actions">
					{#if selected.url}<a class="btn primary" href={selected.url} target="_blank" rel="noreferrer">前往網站 ↗</a>{/if}
					{#if selected.repo}<a class="btn" href={selected.repo} target="_blank" rel="noreferrer">原始碼</a>{/if}
				</div>
			{:else if roomView}
				{@const list = byHost(roomView)}
				<p class="eyebrow">{list.length} 張桌子・{list.filter((p) => p.asleep).length} 位睡著</p>
				<h2>{ROOMS[roomView].name}</h2>
				<p class="desc">{ROOMS[roomView].blurb}</p>
				<ul class="desks">
					{#each list as p (p.key)}
						{@const s = status(p)}
						<li>
							<button onclick={() => select(p.key)}>
								<span class="who">{EMOJI[p.keeper]}</span>
								<span class="what"><b>{p.title}</b><small>{domainOf(p.url) ?? '沒有公開網址'}</small></span>
								<span class="dot {s.cls}" title={s.text}></span>
							</button>
						</li>
					{/each}
				</ul>
			{:else if view === 'github' && data.github}
				{@const gh = data.github}
				<p class="eyebrow">地毯上一根柱子 = 一天</p>
				<h2>GitHub 提交地毯</h2>
				<dl class="facts">
					<div><dt>過去一年</dt><dd>{gh.total} 次</dd></div>
					<div><dt>最多的一天</dt><dd>{Math.max(...gh.days.map((d) => d.count))} 次</dd></div>
					<div><dt>公開 repo</dt><dd>{gh.publicRepos}</dd></div>
					<div><dt>有提交的天數</dt><dd>{gh.days.filter((d) => d.count).length} 天</dd></div>
				</dl>
				{#if gh.recent.length}
					<h3>最近在做</h3>
					<ul class="feed">
						{#each gh.recent as r, i (i)}
							<li><span>{r.kind}</span> <b>{r.repo}</b> <small>{timeAgo(r.at)}</small></li>
						{/each}
					</ul>
				{/if}
				<div class="actions"><a class="btn primary" href={gh.url} target="_blank" rel="noreferrer">@{gh.login} ↗</a></div>
			{:else if view === 'about'}
				<p class="eyebrow">{profile.role}</p>
				<h2>嗨，我是 {profile.name}</h2>
				<p class="desc">{profile.bio}</p>
				<p class="desc">{profile.tagline}</p>
				<h3>技能</h3>
				<ul class="tags">{#each profile.skills as s (s)}<li>{s}</li>{/each}</ul>
				{#if domains.length}
					<h3>我的網域</h3>
					<ul class="tags">{#each domains as d (d)}<li>{d}</li>{/each}</ul>
				{/if}
				<div class="actions">
					{#if profile.email}<a class="btn primary" href="mailto:{profile.email}">寫信給我</a>{/if}
					{#each profile.links as l (l.url)}<a class="btn" href={l.url} target="_blank" rel="noreferrer">{l.label} ↗</a>{/each}
				</div>
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
					{@const s = status(p)}
					<li>
						<button onclick={() => select(p.key)}>
							<span class="who" aria-hidden="true">{EMOJI[p.keeper]}</span>
							<span class="what"><b>{p.title}</b><small>{domainOf(p.url) ?? '沒有公開網址'}・{s.text}</small></span>
							<span class="dot {s.cls}"></span>
						</button>
					</li>
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

	.dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		flex: none;
		background: #9aa0c0;
	}
	.dot.up {
		background: #46e39a;
		box-shadow: 0 0 10px #46e39a;
	}
	.dot.down {
		background: #ff5d7a;
		box-shadow: 0 0 10px #ff5d7a;
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
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

	.qr-card {
		position: fixed;
		left: 50%;
		bottom: 92px;
		z-index: 10;
		translate: -50% 0;
		display: flex;
		align-items: center;
		gap: 16px;
		padding: 10px 10px 10px 20px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: rgb(14 14 22 / 0.8);
		backdrop-filter: blur(12px);
		white-space: nowrap;
		animation: hintIn 0.6s var(--ease) 0.8s both;
	}
	.qr-card p {
		display: grid;
		margin: 0;
		font-size: 14px;
	}
	/* 滑鼠用戶拿手機掃；觸控用戶本來就在手機上，改成存圖／分享的說法 */
	.qr-card .near {
		display: none;
	}
	@media (pointer: coarse) {
		.qr-card .far {
			display: none;
		}
		.qr-card .near {
			display: block;
		}
	}
	/* 直式手機：說明一行、三顆按鈕平分下一行 */
	@media (max-width: 600px) {
		.qr-card {
			flex-wrap: wrap;
			gap: 10px;
			width: calc(100vw - 32px);
			padding: 14px;
			border-radius: var(--r-md);
			white-space: normal;
		}
		.qr-card p {
			flex-basis: 100%;
			padding-left: 4px;
		}
		.qr-card .btn {
			flex: 1;
			text-align: center;
		}
	}
	.qr-card span {
		color: var(--muted);
		font-size: 12px;
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
	.eyebrow {
		margin: 0 40px 6px 0;
		color: var(--muted);
		font-size: 13px;
	}
	.panel h2 {
		margin: 0;
		font-size: clamp(24px, 3vw, 30px);
		font-weight: 800;
		letter-spacing: -0.02em;
		line-height: 1.2;
	}
	.panel h3 {
		margin: 22px 0 8px;
		font-size: 13px;
		font-weight: 600;
		color: var(--muted);
	}
	.domain {
		display: inline-block;
		margin-top: 4px;
		color: var(--accent-2);
		font-family: var(--font-mono);
		font-size: 14px;
		text-decoration: none;
	}
	.shot {
		display: block;
		margin-top: 14px;
		overflow: hidden;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
	}
	.shot img {
		display: block;
		width: 100%;
		height: auto;
		transition: transform 0.5s var(--ease);
	}
	.shot:hover img {
		transform: scale(1.03);
	}
	.state {
		display: grid;
		gap: 4px;
		margin: 18px 0 0;
		padding: 14px 16px;
		border-radius: var(--r-md);
		border: 1px solid;
		font-size: 14px;
	}
	.state b {
		font-size: 15px;
	}
	.state span {
		color: var(--text-soft);
	}
	.state.up {
		border-color: rgb(70 227 154 / 0.35);
		background: rgb(70 227 154 / 0.08);
	}
	.state.up b {
		color: #7ef0b9;
	}
	.state.down {
		border-color: rgb(255 93 122 / 0.4);
		background: rgb(255 93 122 / 0.1);
	}
	.state.down b {
		color: #ff9db0;
	}
	.state.idle {
		border-color: var(--line);
		background: rgb(255 255 255 / 0.03);
	}
	.facts {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 8px;
		margin: 14px 0 0;
	}
	.facts div {
		padding: 10px 12px;
		border-radius: var(--r-sm);
		background: rgb(255 255 255 / 0.04);
	}
	.facts dt {
		color: var(--muted);
		font-size: 12px;
	}
	.facts dd {
		margin: 0;
		font-weight: 700;
		font-family: var(--font-mono);
	}
	.desc {
		margin: 16px 0 0;
		color: var(--text-soft);
		font-size: 15px;
	}
	.tags {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin: 14px 0 0;
		padding: 0;
		list-style: none;
	}
	.tags li {
		padding: 4px 11px;
		border-radius: var(--r-pill);
		border: 1px solid var(--line);
		color: var(--text-soft);
		font-size: 12px;
	}
	.actions {
		display: flex;
		flex-wrap: wrap;
		gap: 8px;
		margin-top: 22px;
	}
	.btn {
		padding: 10px 18px;
		border-radius: var(--r-pill);
		border: 1px solid var(--line);
		color: var(--text);
		font-size: 14px;
		font-weight: 600;
		text-decoration: none;
		transition: background 0.25s var(--ease);
	}
	button.btn {
		background: none;
		font-family: inherit;
		cursor: pointer;
	}
	.btn:hover {
		background: rgb(255 255 255 / 0.06);
	}
	.btn.primary {
		border-color: transparent;
		background: var(--accent-grad);
		color: #0b0b12;
	}
	.feed {
		display: grid;
		gap: 8px;
		margin: 0;
		padding: 0;
		list-style: none;
		font-size: 14px;
	}
	.feed span {
		color: var(--muted);
	}
	.feed b {
		font-family: var(--font-mono);
		font-weight: 500;
		word-break: break-all;
	}
	.feed small {
		color: var(--muted);
	}

	/* 桌子清單（房間資訊卡、清單模式共用） */
	.desks,
	main ul {
		display: grid;
		gap: 6px;
		margin: 18px 0 0;
		padding: 0;
		list-style: none;
	}
	.desks button,
	main li button {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: rgb(255 255 255 / 0.03);
		text-align: left;
		transition: background 0.25s var(--ease);
	}
	.desks button:hover,
	main li button:hover {
		background: rgb(255 255 255 / 0.07);
	}
	.who {
		font-size: 22px;
	}
	.what {
		display: grid;
		flex: 1;
		min-width: 0;
	}
	.what small {
		color: var(--muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
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
	}
</style>
