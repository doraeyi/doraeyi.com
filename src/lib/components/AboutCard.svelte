<script lang="ts">
	import type { Profile } from '#lib/types.js';

	let { profile, domains }: { profile: Profile; domains: string[] } = $props();
</script>

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
