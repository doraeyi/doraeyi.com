<script lang="ts">
	import { onMount } from 'svelte';

	// 房間變成 QR 之後，畫面下方的說明跟存圖／分享／開啟按鈕
	let { url, name }: { url: string; name: string } = $props();

	/** 手機的系統分享面板（LINE、IG 限動…），桌面瀏覽器多半沒有就不顯示按鈕 */
	let canShare = $state(false);
	onMount(() => {
		canShare = typeof navigator.share === 'function';
	});

	function share() {
		navigator.share({ title: `${name} 的 GitHub`, url }).catch(() => {});
	}
</script>

<aside class="qr-card">
	<p>
		<b class="far">掃一下，追蹤我的 GitHub</b>
		<b class="near">在手機上？存下來或直接分享</b>
		<span>拖一下，看它是怎麼拼起來的；往上推回到房間</span>
	</p>
	<a class="btn" href="/qr.png" download="doraeyi-github-qr.png">存圖</a>
	{#if canShare}
		<button class="btn" onclick={share}>分享</button>
	{/if}
	<a class="btn primary" href={url} target="_blank" rel="noreferrer">開啟 ↗</a>
</aside>

<style>
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
		/* 等方塊拼好、掃描框對準之後才出現，不要搶戲 */
		animation: cardIn 0.6s var(--ease) 3.4s both;
	}
	@media (prefers-reduced-motion: reduce) {
		.qr-card {
			animation-delay: 0.5s;
		}
	}
	@keyframes cardIn {
		from {
			opacity: 0;
			translate: -50% 10px;
		}
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
</style>
