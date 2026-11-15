<script lang="ts">
	import DeskRow from './DeskRow.svelte';
	import { ROOMS } from '#lib/format.js';
	import type { Host, Project } from '#lib/types.js';

	let { host, projects, onselect }: { host: Host; projects: Project[]; onselect: (key: string) => void } = $props();
</script>

<p class="eyebrow">{projects.length} 張桌子・{projects.filter((p) => p.asleep).length} 位睡著</p>
<h2>{ROOMS[host].name}</h2>
<p class="desc">{ROOMS[host].blurb}</p>
<ul class="desks">
	{#each projects as p (p.key)}
		<li><DeskRow project={p} {onselect} /></li>
	{/each}
</ul>

<style>
	.desks {
		display: grid;
		gap: 6px;
		margin: 18px 0 0;
		padding: 0;
		list-style: none;
	}
</style>
