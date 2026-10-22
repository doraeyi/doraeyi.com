<script lang="ts">
	// 不用 WebGL 的 3D 球：手機、弱機、減少動態效果時使用，也是 WebGL 載入前的佔位
	// 只動 transform / opacity，全部交給合成器，主執行緒幾乎不用做事
	import { onMount } from 'svelte';
	import { blobPose, pxPerUnit } from '#lib/scene/pose.js';

	let { hidden = false }: { hidden?: boolean } = $props();

	let root: HTMLDivElement;

	// 固定的星點（決定性亂數，每次載入都一樣，SSR 跟瀏覽器也一致）
	const stars = (() => {
		let seed = 11;
		const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
		return Array.from({ length: 70 }, () => {
			const tint = rand();
			const color = tint > 0.85 ? '139 123 255' : tint > 0.72 ? '76 201 240' : '255 255 255';
			return `${(rand() * 100).toFixed(1)}vw ${(rand() * 100).toFixed(1)}vh 0 ${rand() > 0.8 ? 1 : 0}px rgb(${color} / ${(0.3 + rand() * 0.5).toFixed(2)})`;
		}).join(',');
	})();

	onMount(() => {
		let raf = 0;
		let mx = 0;
		let my = 0;
		const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

		const update = () => {
			raf = 0;
			const w = innerWidth;
			const h = innerHeight;
			const max = Math.max(1, document.documentElement.scrollHeight - h);
			const pose = blobPose({ hero: scrollY / h, progress: scrollY / max }, w < 700);
			const ppu = pxPerUnit(w, h);
			const s = root.style;
			s.setProperty('--ppu', `${ppu}px`);
			s.setProperty('--x', `${pose.x * ppu}px`);
			s.setProperty('--y', `${-pose.y * ppu}px`);
			s.setProperty('--scale', String(pose.scale));
			s.setProperty('--fade', String(pose.fade));
			s.setProperty('--mx', String(mx));
			s.setProperty('--my', String(my));
		};
		const schedule = () => (raf ||= requestAnimationFrame(update));
		const onMove = (e: PointerEvent) => {
			mx = (e.clientX / innerWidth) * 2 - 1;
			my = (e.clientY / innerHeight) * 2 - 1;
			schedule();
		};

		update();
		addEventListener('scroll', schedule, { passive: true });
		addEventListener('resize', schedule);
		if (finePointer) addEventListener('pointermove', onMove, { passive: true });
		return () => {
			cancelAnimationFrame(raf);
			removeEventListener('scroll', schedule);
			removeEventListener('resize', schedule);
			removeEventListener('pointermove', onMove);
		};
	});
</script>

<div class="lite" class:hidden bind:this={root} aria-hidden="true">
	<div class="stars" style:box-shadow={stars}></div>
	<div class="anchor">
		<div class="stage">
			<div class="ring one"><i></i></div>
			<div class="ring two"></div>
			<div class="orb">
				<div class="shape"></div>
				<div class="light"></div>
			</div>
		</div>
	</div>
</div>

<style>
	.lite {
		--ppu: 100px;
		--x: 0px;
		--y: 0px;
		--scale: 1;
		--fade: 1;
		--mx: 0;
		--my: 0;
		position: fixed;
		inset: 0;
		z-index: 0;
		pointer-events: none;
		overflow: hidden;
		transition: opacity 1.2s var(--ease);
	}
	/* WebGL 接手後淡出，淡完就停掉所有動畫，不再佔合成器 */
	.lite.hidden {
		opacity: 0;
		visibility: hidden;
		transition:
			opacity 1.2s var(--ease),
			visibility 0s 1.2s;
	}
	.lite.hidden * {
		animation-play-state: paused;
	}

	.stars {
		position: absolute;
		top: 0;
		left: 0;
		width: 2px;
		height: 2px;
		border-radius: 50%;
		animation: drift 120s linear infinite alternate;
	}
	@keyframes drift {
		to {
			transform: translate3d(-3vw, -2vh, 0);
		}
	}

	/* 球的中心點，位置跟 WebGL 版用同一套公式算 */
	.anchor {
		position: absolute;
		left: 50%;
		top: 50%;
		width: 0;
		height: 0;
		transform: translate3d(var(--x), var(--y), 0) scale(var(--scale));
		opacity: var(--fade);
		transition:
			transform 0.6s var(--ease),
			opacity 0.6s var(--ease);
	}
	.stage {
		perspective: 900px;
		transform-style: preserve-3d;
		transform: rotateY(calc(var(--mx) * 14deg)) rotateX(calc(var(--my) * -10deg));
		transition: transform 1.2s var(--ease);
	}

	/* 主球：半徑 1.35 個世界單位，跟 three.js 一樣大 */
	.orb {
		position: absolute;
		width: calc(var(--ppu) * 2.7);
		aspect-ratio: 1;
		translate: -50% -50%;
		animation: breathe 7s ease-in-out infinite;
	}
	@keyframes breathe {
		50% {
			transform: scale(1.04, 0.97);
		}
	}
	/* 不規則外形慢慢自轉，看起來像在流動；光源不跟著轉 */
	.shape {
		position: absolute;
		inset: 0;
		border-radius: 46% 54% 52% 48% / 53% 45% 55% 47%;
		background: radial-gradient(circle at 50% 50%, #1d1d26 0%, #0c0c12 62%, #15142a 100%);
		/* 跟 WebGL 版一樣：上緣偏紫、下緣偏藍的亮輪廓 */
		box-shadow:
			inset 0 0 calc(var(--ppu) * 0.12) rgb(230 225 255 / 0.55),
			inset 0 calc(var(--ppu) * 0.1) calc(var(--ppu) * 0.35) rgb(139 123 255 / 0.7),
			inset 0 calc(var(--ppu) * -0.14) calc(var(--ppu) * 0.35) rgb(76 201 240 / 0.6),
			0 0 calc(var(--ppu) * 0.8) calc(var(--ppu) * -0.2) rgb(139 123 255 / 0.4);
		animation: spin 38s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
	.light {
		position: absolute;
		inset: 0;
		border-radius: 50%;
		background:
			radial-gradient(ellipse 14% 9% at 33% 27%, rgb(255 255 255 / 0.75), transparent),
			radial-gradient(circle at 30% 25%, rgb(255 255 255 / 0.12), transparent 45%);
		mix-blend-mode: screen;
	}

	.ring {
		position: absolute;
		aspect-ratio: 1;
		border-radius: 50%;
		translate: -50% -50%;
		transform-style: preserve-3d;
	}
	.ring.one {
		width: calc(var(--ppu) * 4.5);
		border: 2px solid rgb(139 123 255 / 0.75);
		animation: orbit1 20s linear infinite;
	}
	.ring.two {
		width: calc(var(--ppu) * 5.3);
		border: 1.5px solid rgb(76 201 240 / 0.45);
		animation: orbit2 32s linear infinite;
	}
	@keyframes orbit1 {
		from {
			transform: rotateX(70deg) rotateY(-14deg) rotateZ(0deg);
		}
		to {
			transform: rotateX(70deg) rotateY(-14deg) rotateZ(360deg);
		}
	}
	@keyframes orbit2 {
		from {
			transform: rotateX(76deg) rotateY(22deg) rotateZ(360deg);
		}
		to {
			transform: rotateX(76deg) rotateY(22deg) rotateZ(0deg);
		}
	}
	/* 環上的小衛星 */
	.ring.one i {
		position: absolute;
		top: 50%;
		right: 0;
		width: calc(var(--ppu) * 0.14);
		aspect-ratio: 1;
		border-radius: 50%;
		background: #fff;
		translate: 50% -50%;
		box-shadow: 0 0 12px rgb(255 255 255 / 0.8);
	}
</style>
