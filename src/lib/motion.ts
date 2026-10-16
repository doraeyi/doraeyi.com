import type { Attachment } from 'svelte/attachments';

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** 進入畫面時加上 .in，配合 CSS 做出場動畫 */
export const reveal =
	(delay = 0): Attachment<HTMLElement> =>
	(el) => {
		el.classList.add('reveal');
		el.style.setProperty('--delay', `${delay}ms`);
		const io = new IntersectionObserver(
			([e]) => {
				if (e.isIntersecting) {
					el.classList.add('in');
					io.disconnect();
				}
			},
			{ threshold: 0.15, rootMargin: '0px 0px -8% 0px' }
		);
		io.observe(el);
		return () => io.disconnect();
	};

/** 滑鼠跟隨的 3D 傾斜，並把游標位置寫進 --mx/--my 給反光用 */
export const tilt =
	(max = 14): Attachment<HTMLElement> =>
	(el) => {
		if (reduced() || matchMedia('(hover: none)').matches) return;
		let raf = 0;
		const move = (e: PointerEvent) => {
			const r = el.getBoundingClientRect();
			const x = (e.clientX - r.left) / r.width;
			const y = (e.clientY - r.top) / r.height;
			cancelAnimationFrame(raf);
			raf = requestAnimationFrame(() => {
				el.style.setProperty('--rx', `${(0.5 - y) * max}deg`);
				el.style.setProperty('--ry', `${(x - 0.5) * max}deg`);
				el.style.setProperty('--mx', `${x * 100}%`);
				el.style.setProperty('--my', `${y * 100}%`);
			});
		};
		const leave = () => {
			cancelAnimationFrame(raf);
			el.style.setProperty('--rx', '0deg');
			el.style.setProperty('--ry', '0deg');
		};
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerleave', leave);
		return () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerleave', leave);
		};
	};

/** 按鈕被游標吸過去的磁力效果 */
export const magnetic =
	(strength = 0.35): Attachment<HTMLElement> =>
	(el) => {
		if (reduced() || matchMedia('(hover: none)').matches) return;
		const move = (e: PointerEvent) => {
			const r = el.getBoundingClientRect();
			const dx = e.clientX - (r.left + r.width / 2);
			const dy = e.clientY - (r.top + r.height / 2);
			el.style.transform = `translate(${dx * strength}px, ${dy * strength}px)`;
		};
		const leave = () => (el.style.transform = '');
		el.addEventListener('pointermove', move);
		el.addEventListener('pointerleave', leave);
		return () => {
			el.removeEventListener('pointermove', move);
			el.removeEventListener('pointerleave', leave);
		};
	};
