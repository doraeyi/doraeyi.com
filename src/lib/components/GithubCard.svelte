<script lang="ts">
	import { timeAgo } from '#lib/format.js';
	import type { GithubData } from '#lib/types.js';

	let { github: gh }: { github: GithubData } = $props();
</script>

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

<style>
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
</style>
