<script lang="ts">
	import { projectStatus } from '#lib/format.js';
	import { domainOf, KEEPER_EMOJI } from '#lib/room/world.js';
	import type { Project } from '#lib/types.js';

	// 桌子清單的一列：房間資訊卡跟清單模式共用
	interface Props {
		project: Project;
		onselect: (key: string) => void;
		/** 清單模式沒有燈號的顏色可看，把狀態也寫成文字 */
		showStatus?: boolean;
	}

	let { project: p, onselect, showStatus = false }: Props = $props();

	const s = $derived(projectStatus(p));
</script>

<button onclick={() => onselect(p.key)}>
	<span class="who" aria-hidden="true">{KEEPER_EMOJI[p.keeper]}</span>
	<span class="what"><b>{p.title}</b><small>{domainOf(p.url) ?? '沒有公開網址'}{showStatus ? `・${s.text}` : ''}</small></span>
	<span class="dot {s.cls}" title={s.text}></span>
</button>

<style>
	button {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 10px 12px;
		border: 1px solid var(--line);
		border-radius: var(--r-md);
		background: rgb(255 255 255 / 0.03);
		font: inherit;
		color: inherit;
		text-align: left;
		cursor: pointer;
		transition: background 0.25s var(--ease);
	}
	button:hover {
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
</style>
