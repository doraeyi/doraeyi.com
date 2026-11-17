<script lang="ts">
	import { frameworkLabel, projectStatus, ROOMS, timeAgo } from '#lib/format.js';
	import { domainOf, KEEPER_EMOJI, KEEPER_LABEL, keeperName } from '#lib/room/world.js';
	import type { DeskState, Project } from '#lib/types.js';

	/** busy：Claude 正在改這個專案（working），或改完了在等回覆（waiting） */
	let { project: p, busy = null }: { project: Project; busy?: DeskState | null } = $props();

	const s = $derived(projectStatus(p));
</script>

<p class="eyebrow">{ROOMS[p.host].name}・{KEEPER_EMOJI[p.keeper]} {keeperName(p.key, p.keeper)}（{KEEPER_LABEL[p.keeper]}）管理中</p>
<h2>{p.title}</h2>
{#if p.url}<a class="domain" href={p.url} target="_blank" rel="noreferrer">{domainOf(p.url)} ↗</a>{/if}
{#if p.shot && !p.asleep}
	<a class="shot" href={p.url} target="_blank" rel="noreferrer">
		<img src={p.shot} alt="{p.title} 首頁截圖" width="640" height="400" />
	</a>
{/if}

<div class="state {s.cls}">
	<b>{s.text}</b>
	{#if p.asleep}
		<span>管理員上次去看時{p.health?.note ?? '網站沒有回應'}，累到睡著了。等網站恢復，下一次巡房就會醒來。</span>
	{:else if p.health}
		<span>網站正常，管理員每 12 小時會再去看一次。</span>
	{:else if p.key.startsWith('work:')}
		<span>公司的專案沒有公開網址，也不會推到 GitHub，所以不巡房、不澆水；我在公司用 Claude 寫程式時，管理員會跟著一起忙。</span>
	{:else}
		<span>{p.url ? '還沒巡過這個專案，下一輪就會去看。' : '這個專案沒有公開網址，管理員只是坐著陪它。'}</span>
	{/if}
</div>

{#if busy}
	<div class="state busy">
		<b>{busy === 'working' ? '正在改程式' : '改完一輪，等回覆中'}</b>
		<span
			>{busy === 'working'
				? p.key.startsWith('work:')
					? '我正在公司用 Claude 寫程式，管理員盯著螢幕一起趕工。'
					: '我正在用 Claude 改這個專案，管理員盯著螢幕一起趕工。推上 GitHub 之後，它會跑去花園幫今天的樹澆水。'
				: 'Claude 做完了一輪，管理員轉過來等下一步指示。'}</span
		>
	</div>
{/if}

{#if p.health}
	<dl class="facts">
		<div><dt>上次巡房</dt><dd>{timeAgo(p.health.checkedAt)}</dd></div>
		<div><dt>回應時間</dt><dd>{p.health.ms !== null ? `${p.health.ms} ms` : '—'}</dd></div>
		<div><dt>HTTP</dt><dd>{p.health.status ?? '—'}</dd></div>
		<div><dt>妥善率</dt><dd>{(p.health.uptime * 100).toFixed(p.health.uptime === 1 ? 0 : 1)}%</dd></div>
	</dl>
{/if}

{#if p.description}<p class="desc">{p.description}</p>{/if}
<ul class="tags">
	{#if p.framework}<li>{frameworkLabel(p.framework)}</li>{/if}
	{#each p.tags as t (t)}<li>{t}</li>{/each}
	{#if p.lastDeployAt}<li>{timeAgo(p.lastDeployAt)}部署</li>{/if}
</ul>
<div class="actions">
	{#if p.url}<a class="btn primary" href={p.url} target="_blank" rel="noreferrer">前往網站 ↗</a>{/if}
	{#if p.repo}<a class="btn" href={p.repo} target="_blank" rel="noreferrer">原始碼</a>{/if}
</div>

<style>
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
	.state.busy {
		border-color: rgb(255 154 77 / 0.4);
		background: rgb(255 154 77 / 0.1);
	}
	.state.busy b {
		color: #ffc79e;
	}
	.state.idle {
		border-color: var(--line);
		background: rgb(255 255 255 / 0.03);
	}
</style>
