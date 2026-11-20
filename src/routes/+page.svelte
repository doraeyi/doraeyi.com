<script lang="ts">
	import { untrack } from 'svelte';
	import { dev } from '$app/env';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
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
	import { buildWorld, domainOf, keeperName } from '#lib/room/world.js';
	import type { Focus } from '#lib/room/protocol.js';
	import type { SceneMode } from '#lib/room/stats.svelte.js';
	import type { Host, LiveData, Watering } from '#lib/types.js';
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
	/** 走進去：第一人稱，WASD／搖桿在房子跟花園裡走；near 是眼前正對著的那台電腦 */
	let walk = $state(false);
	let near = $state<string | null>(null);
	const nearProject = $derived(walk && near ? (data.projects.find((p) => p.key === near) ?? null) : null);

	/**
	 * 管理員現在在做什麼：Claude 正在改哪些專案、哪些 push 正在澆水。頁面本身有快取，這個另外問：
	 * 平常 15 秒一次；有人在澆水時 4 秒一次，部署一完成樹就長大，不用等太久
	 */
	let live = $state<LiveData | null>(null);
	const working = $derived(Object.values(live?.desks ?? {}).filter((s) => s === 'working').length);
	/** 澆水的進度有變化（出發、推上去了、部署完）就在上面跳一行字說明 */
	let toast = $state<string | null>(null);
	/** 每次澆水上次看到的進度；還沒收過即時狀態是 null */
	let phases: Record<number, Watering['phase']> | null = null;
	function waterNote(w: Watering, before: Watering['phase'] | undefined) {
		if (before === w.phase) return null;
		const name = w.repo.split('/')[1];
		const project = data.projects.find((p) => p.key === w.key);
		const who = project ? keeperName(project.key, project.keeper) : '管理員';
		if (w.phase === 'pushing') return `${name} 正在 push，${who}拿起澆水壺去花園了`;
		if (w.phase === 'deploying')
			return before ? `${name} 推上去了（${w.commits} 個 commit），${who}邊澆水邊等部署` : `${name} 推了 ${w.commits} 個 commit，${who}去花園邊澆水邊等部署`;
		if (!before) return null;
		if (!w.commits) return `${name} 沒有推上去，${who}回位子了`;
		return w.ok ? `${name} 部署完成，今天的樹長大了` : `${name} 的 GitHub Actions 沒有過，樹還是長了 ${w.commits} 個 commit 的份`;
	}
	$effect(() => {
		let alive = true;
		let toastTimer: ReturnType<typeof setTimeout> | undefined;
		let pollTimer: ReturnType<typeof setTimeout> | undefined;
		const poll = async () => {
			clearTimeout(pollTimer);
			let busy = false;
			try {
				if (document.hidden) return;
				const res = await fetch('/api/live');
				if (!res.ok || !alive) return;
				const next = (await res.json()) as LiveData;
				const first = phases === null;
				const seen: Record<number, Watering['phase']> = phases ?? {};
				let note: string | null = null;
				for (const w of next.waterings) {
					// 剛打開網頁時，已經澆完的不提
					if (!(first && w.phase === 'done')) note = waterNote(w, seen[w.id]) ?? note;
					seen[w.id] = w.phase;
				}
				phases = seen;
				busy = next.waterings.some((w) => w.phase !== 'done');
				if (note) {
					toast = note;
					clearTimeout(toastTimer);
					toastTimer = setTimeout(() => (toast = null), 9000);
				}
				live = next;
			} catch {
				/* 下一輪再問 */
			} finally {
				if (alive) pollTimer = setTimeout(poll, busy ? 4000 : 15_000);
			}
		};
		void poll();
		const onVisible = () => void (!document.hidden && poll());
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			alive = false;
			clearTimeout(pollTimer);
			clearTimeout(toastTimer);
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	const selected = $derived(data.projects.find((p) => p.key === view) ?? null);
	const roomView = $derived<Host | null>(view === 'vercel' ? 'vercel' : view === 'vm' ? 'vm' : null);
	const stageFocus = $derived<Focus>(view === 'about' ? 'all' : view);
	const showPerf = $derived(page.url.searchParams.get('debug') === 'perf');

	const portrait = () => innerWidth / innerHeight < 0.9;

	$effect(() => {
		// 直式手機放不下兩間房間，一開始先看左邊那間
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
		walk = false;
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

	/** 手機的底部抽屜：卡片捲在最上面時往下滑就關掉 */
	function swipeToClose(el: HTMLElement) {
		const sheet = matchMedia('(max-width: 720px)');
		let y0 = 0;
		let dy = 0;
		let active = false;
		const start = (e: TouchEvent) => {
			active = sheet.matches && el.scrollTop <= 0 && e.touches.length === 1;
			y0 = e.touches[0].clientY;
			dy = 0;
		};
		const move = (e: TouchEvent) => {
			if (!active) return;
			dy = e.touches[0].clientY - y0;
			// 往上滑是要捲內容，交給瀏覽器
			if (dy < 0) {
				active = false;
				el.style.translate = '';
				return;
			}
			e.preventDefault();
			el.style.transition = 'none';
			el.style.translate = `0 ${dy}px`;
		};
		const end = () => {
			if (!active) return;
			active = false;
			el.style.transition = '';
			if (dy > Math.min(120, el.offsetHeight * 0.25)) {
				el.style.translate = '0 100%';
				setTimeout(close, 180);
			} else el.style.translate = '';
		};
		el.addEventListener('touchstart', start, { passive: true });
		el.addEventListener('touchmove', move, { passive: false });
		el.addEventListener('touchend', end);
		el.addEventListener('touchcancel', end);
		return () => {
			el.removeEventListener('touchstart', start);
			el.removeEventListener('touchmove', move);
			el.removeEventListener('touchend', end);
			el.removeEventListener('touchcancel', end);
		};
	}

	function onqr(on: boolean, p: number) {
		qr = on;
		pull = p;
		if (on) {
			panel = false;
			hint = false;
		}
	}

	function toggleWalk() {
		walk = !walk;
		hint = false;
		if (walk) {
			qr = false;
			panel = false;
		}
	}

	function select(key: string) {
		hint = false;
		view = key;
		// 'all'：滾輪拉遠到全景，資訊卡收起來
		if (key === 'all') panel = false;
		else if (key === 'about' || data.projects.some((p) => p.key === key)) {
			remember();
			panel = true;
		}
	}

	/** 睡著的專案；點上面的「睡著了」依序飛過去看 */
	const sleepers = $derived(data.projects.filter((p) => p.asleep));
	function visitSleeper() {
		const i = sleepers.findIndex((p) => p.key === view);
		qr = false;
		walk = false;
		select(sleepers[(i + 1) % sleepers.length].key);
	}

	// 網址的 ?at= 記著開著哪張卡片（例如 ?at=vercel:dinner-vote）：可以直接分享某個專案，
	// 打開卡片會多一筆歷史，手機按返回鍵是先關卡片，不會直接離開網站
	// 淺層導覽只會更新 page.shallow.url，page.url 一直是第一次載入的網址
	const shownUrl = $derived(page.shallow?.url ?? page.url);
	const atParam = $derived(shownUrl.searchParams.get('at'));
	const openAt = $derived(panel && view !== 'all' ? view : null);
	const validAt = (v: string | null): v is Focus | 'about' =>
		v === 'vercel' || v === 'vm' || v === 'about' || (v === 'github' && !!data.github) || data.projects.some((p) => p.key === v);

	// 網址 → 畫面：第一次進來、按返回鍵或下一頁。要放在下面那個前面，第一次進來才是網址說了算
	$effect(() => {
		const at = atParam;
		untrack(() => {
			if (at === openAt) return;
			if (validAt(at)) {
				hint = false;
				qr = false;
				view = at;
				panel = true;
			} else if (at === null && panel) close();
		});
	});

	// 畫面 → 網址
	$effect(() => {
		const at = openAt;
		untrack(() => {
			if (at === atParam) return;
			// 自己組，?capture 這種沒有值的參數才不會變成 capture=，key 裡的冒號也不用編碼
			const rest = [...shownUrl.searchParams].filter(([k]) => k !== 'at').map(([k, v]) => (v ? `${k}=${encodeURIComponent(v)}` : k));
			if (at) rest.push(`at=${at}`);
			const href = rest.length ? resolve(`/?${rest.join('&')}`) : resolve('/');
			if (at && !atParam) goto(href, { shallow: true, state: { card: true } });
			else if (!at && page.state.card) history.back();
			else goto(href, { shallow: true, replace: true, state: page.state });
		});
	});

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

<!-- Esc：先關資訊卡，沒有卡片時再離開走路模式 -->
<svelte:window onkeydown={(e) => e.key === 'Escape' && (panel ? close() : walk && (walk = false))} />

{#if mode !== 'list'}
	<Stage
		{world}
		focus={stageFocus}
		panel={panel && view !== 'all'}
		{qr}
		{onqr}
		{walk}
		{live}
		onnear={(key) => (near = key)}
		onselect={select}
		onmode={(m) => (mode = m)}
	/>
{/if}

<!-- 上方：名字 + 即時狀態 -->
<header class="hud">
	<button class="brand" onclick={() => open('about')} aria-pressed={view === 'about'}>
		<i class="sphere"></i>
		<span><b>{profile.handle}</b><small>{profile.role}</small></span>
	</button>
	<ul class="chips" aria-label="即時狀態">
		<li><i class="dot up"></i>{awake} 位值班中</li>
		{#if working}<li class="busy"><i class="dot busy"></i>{working} 位正在改程式</li>{/if}
		{#if asleep}
			<li class="warn">
				<button onclick={visitSleeper} title="看睡著的是哪個專案"><i class="dot down"></i>{asleep} 位睡著了</button>
			</li>
		{/if}
		{#if data.github}<li class="hide-sm">GitHub 一年 {data.github.total} 次提交</li>{/if}
		<li class="hide-sm">下次巡房 {nextPatrol}</li>
	</ul>
</header>

{#if toast && !qr}<p class="toast" role="status">{toast}</p>{/if}

{#if mode !== 'list' && !qr && pull > 0.05}
	<p class="pull" style:--p={Math.min(1, pull)}>繼續往下拉，變出 GitHub QR code<i></i></p>
{:else if qr && pull < -0.05}
	<p class="pull" style:--p={Math.min(1, -pull)}>繼續往上推，回到房間<i></i></p>
{:else if hint && mode !== 'list'}
	<p class="hint">拖曳旋轉・點桌子看專案・一直往下拉有驚喜</p>
{/if}

{#if walk && mode !== 'list'}
	<p class="walk-hint">
		<span class="far">WASD／方向鍵走・Shift 跑・拖曳轉頭・E 看電腦・Esc 離開</span>
		<span class="near">左下搖桿走・拖曳轉頭・點電腦看專案</span>
	</p>
	{#if nearProject && !panel}
		<button class="near-prompt" onclick={() => select(nearProject.key)}><kbd>E</kbd>看 {nearProject.title}</button>
	{/if}
{/if}

<!-- 下方：切換停靠點 -->
<nav class="dock" aria-label="切換視角">
	<button class:on={view === 'all' && !qr && !walk} onclick={() => ((view = 'all'), (panel = false), (qr = false), (walk = false))}>全景</button>
	<button class:on={view === 'vercel' && !qr && !walk} onclick={() => open('vercel')}>{ROOMS.vercel.name} <small>{byHost('vercel').length}</small></button>
	<button class:on={view === 'vm' && !qr && !walk} onclick={() => open('vm')}>{ROOMS.vm.name} <small>{byHost('vm').length}</small></button>
	{#if data.github}<button class:on={view === 'github' && !qr && !walk} onclick={() => open('github')}>GitHub</button>{/if}
	<button class:on={view === 'about' && !qr && !walk} onclick={() => open('about')}>關於我</button>
	<button class:on={qr} onclick={() => ((qr = !qr), (panel = false), (walk = false))} aria-pressed={qr}>QR</button>
	{#if mode !== 'list'}<button class:on={walk} onclick={toggleWalk} aria-pressed={walk}>走進去</button>{/if}
</nav>

{#if qr}<QrCard url={data.qr.url} name={profile.name} />{/if}

<!-- 資訊卡：桌面版在右邊，手機版從下面滑上來 -->
{#if panel && view !== 'all'}
	{#key view}
		<!-- 打開或換內容時焦點移進卡片，螢幕閱讀器跟鍵盤都從卡片開頭接著走 -->
		<aside class="panel" aria-live="polite" tabindex="-1" {@attach (el) => el.focus({ preventScroll: true })} {@attach swipeToClose}>
			<button class="close" onclick={close} aria-label="關閉">✕</button>

			{#if selected}
				<ProjectCard project={selected} busy={live?.desks[selected.key] ?? null} />
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
		{#if !data.source.github}<p>抓不到 GitHub 資料，花圃不會出現。</p>{/if}
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
		padding: 0;
		color: #ffb3c1;
		border-color: rgb(255 93 122 / 0.35);
		transition: box-shadow 0.2s;
	}
	/* 疊在原本的深色底上，不要換掉它，不然後面是淺色牆時字會看不清楚 */
	.chips li.warn:hover {
		box-shadow: inset 0 0 0 99px rgb(255 93 122 / 0.16);
	}
	.chips li > button {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 7px 14px;
		border: 0;
		border-radius: inherit;
		background: none;
	}

	.toast {
		position: fixed;
		left: 50%;
		top: 76px;
		z-index: 10;
		translate: -50% 0;
		max-width: calc(100vw - 32px);
		margin: 0;
		padding: 8px 16px;
		border: 1px solid rgb(120 200 255 / 0.35);
		border-radius: var(--r-pill);
		background: rgb(14 14 22 / 0.78);
		backdrop-filter: blur(10px);
		color: #bfe6ff;
		font-size: 13px;
		pointer-events: none;
		animation: hintIn 0.5s var(--ease) both;
	}
	.chips li.busy {
		color: #ffc79e;
		border-color: rgb(255 154 77 / 0.35);
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

	/* ---------- 走進去 ---------- */
	.walk-hint {
		position: fixed;
		left: 50%;
		top: 84px;
		z-index: 10;
		translate: -50% 0;
		margin: 0;
		padding: 7px 14px;
		border-radius: var(--r-pill);
		background: rgb(14 14 22 / 0.6);
		backdrop-filter: blur(10px);
		color: var(--text-soft);
		font-size: 12px;
		white-space: nowrap;
		pointer-events: none;
		animation: hintIn 0.5s var(--ease) both;
	}
	.walk-hint .near {
		display: none;
	}
	@media (pointer: coarse) {
		.walk-hint .far {
			display: none;
		}
		.walk-hint .near {
			display: inline;
		}
	}
	.near-prompt {
		position: fixed;
		left: 50%;
		bottom: 96px;
		z-index: 11;
		translate: -50% 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 18px 10px 10px;
		border: 1px solid var(--line);
		border-radius: var(--r-pill);
		background: rgb(14 14 22 / 0.8);
		backdrop-filter: blur(10px);
		font-size: 14px;
		font-weight: 600;
		animation: hintIn 0.3s var(--ease) both;
	}
	.near-prompt kbd {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 7px;
		background: #fff;
		color: #16161c;
		font: 700 13px var(--font-mono);
	}
	@media (pointer: coarse) {
		.near-prompt kbd {
			display: none;
		}
		.near-prompt {
			padding-left: 18px;
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
		/* left: 50% 會讓瀏覽器只給一半的寬度，按鈕一多就被擠到捲動區外面；寬度直接用內容的寬 */
		width: max-content;
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
		.chips li > button {
			padding: 6px 11px;
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
			transition: translate 0.18s var(--ease);
		}
		/* 抽屜的把手：提示可以往下滑關掉 */
		.panel::before {
			content: '';
			display: block;
			width: 40px;
			height: 4px;
			margin: -10px auto 12px;
			border-radius: 2px;
			background: rgb(255 255 255 / 0.22);
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
		.dock small {
			display: none;
		}
	}
</style>
