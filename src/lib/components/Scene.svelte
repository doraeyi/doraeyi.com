<script lang="ts">
	import { onMount } from 'svelte';
	import * as THREE from 'three';

	let canvas: HTMLCanvasElement;

	// Ashima 3D simplex noise
	const noise = /* glsl */ `
		vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
		vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
		vec4 permute(vec4 x){return mod289(((x*34.0)+1.0)*x);}
		vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
		float snoise(vec3 v){
			const vec2 C=vec2(1.0/6.0,1.0/3.0);const vec4 D=vec4(0.0,0.5,1.0,2.0);
			vec3 i=floor(v+dot(v,C.yyy));vec3 x0=v-i+dot(i,C.xxx);
			vec3 g=step(x0.yzx,x0.xyz);vec3 l=1.0-g;vec3 i1=min(g.xyz,l.zxy);vec3 i2=max(g.xyz,l.zxy);
			vec3 x1=x0-i1+C.xxx;vec3 x2=x0-i2+C.yyy;vec3 x3=x0-D.yyy;
			i=mod289(i);
			vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
			float n_=0.142857142857;vec3 ns=n_*D.wyz-D.xzx;
			vec4 j=p-49.0*floor(p*ns.z*ns.z);vec4 x_=floor(j*ns.z);vec4 y_=floor(j-7.0*x_);
			vec4 x=x_*ns.x+ns.yyyy;vec4 y=y_*ns.x+ns.yyyy;vec4 h=1.0-abs(x)-abs(y);
			vec4 b0=vec4(x.xy,y.xy);vec4 b1=vec4(x.zw,y.zw);
			vec4 s0=floor(b0)*2.0+1.0;vec4 s1=floor(b1)*2.0+1.0;vec4 sh=-step(h,vec4(0.0));
			vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
			vec3 p0=vec3(a0.xy,h.x);vec3 p1=vec3(a0.zw,h.y);vec3 p2=vec3(a1.xy,h.z);vec3 p3=vec3(a1.zw,h.w);
			vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
			p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
			vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);m=m*m;
			return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
		}
	`;

	onMount(() => {
		const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
		const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
		renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
		renderer.setClearColor(0x000000, 0);

		const scene = new THREE.Scene();
		const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
		camera.position.set(0, 0, 6);

		// ---- 主角：會呼吸的虹彩球 ----
		const blobUniforms = {
			uTime: { value: 0 },
			uAmp: { value: 0.24 },
			uFade: { value: 1 },
			uMouse: { value: new THREE.Vector2() }
		};
		const blob = new THREE.Mesh(
			new THREE.IcosahedronGeometry(1.35, 96),
			new THREE.ShaderMaterial({
				uniforms: blobUniforms,
				vertexShader: /* glsl */ `
					uniform float uTime; uniform float uAmp; uniform vec2 uMouse;
					varying vec3 vNormal; varying vec3 vView; varying float vDisp;
					${noise}
					float disp(vec3 p){
						float n = snoise(p * 1.1 + vec3(uTime * 0.18, uTime * 0.12, 0.0));
						n += 0.3 * snoise(p * 2.2 - uTime * 0.25);
						return n * (uAmp + length(uMouse) * 0.18);
					}
					void main(){
						vec3 p = position;
						float d = disp(normalize(p));
						vec3 displaced = p + normal * d;
						// 用鄰近點重新估法線，光影才會跟著變形
						vec3 t = normalize(cross(normal, vec3(0.0, 1.0, 0.001)));
						vec3 b = normalize(cross(normal, t));
						float e = 0.01;
						vec3 pt = normalize(p + t * e); vec3 pb = normalize(p + b * e);
						vec3 nt = pt * 1.35 + pt * disp(pt);
						vec3 nb = pb * 1.35 + pb * disp(pb);
						vec3 n = normalize(cross(nt - displaced, nb - displaced));
						vNormal = normalize(normalMatrix * n);
						vec4 mv = modelViewMatrix * vec4(displaced, 1.0);
						vView = normalize(-mv.xyz);
						vDisp = d;
						gl_Position = projectionMatrix * mv;
					}
				`,
				fragmentShader: /* glsl */ `
					uniform float uTime; uniform float uFade;
					varying vec3 vNormal; varying vec3 vView; varying float vDisp;
					void main(){
						vec3 n = normalize(vNormal);
						float fres = pow(1.0 - max(dot(n, vView), 0.0), 2.2);
						vec3 key = normalize(vec3(0.6, 0.8, 0.9));
						vec3 fill = normalize(vec3(-0.8, -0.4, 0.5));
						float diff = max(dot(n, key), 0.0);
						float back = max(dot(n, fill), 0.0);
						float spec = pow(max(dot(reflect(-key, n), vView), 0.0), 60.0);
						// 石墨底色 + 白色輪廓光，只在背光面帶一點點冷紫
						vec3 col = vec3(0.03, 0.03, 0.035);
						col += vec3(0.20) * diff;
						col += vec3(0.42, 0.38, 0.62) * back * 0.18;
						col += vec3(0.92, 0.92, 0.96) * fres;
						col += spec * 0.7;
						col += smoothstep(0.15, 0.35, vDisp) * 0.04;
						gl_FragColor = vec4(col, uFade);
					}
				`,
				transparent: true
			})
		);
		const blobGroup = new THREE.Group();
		blobGroup.add(blob);
		scene.add(blobGroup);

		// ---- 環繞的線框圓環 ----
		const ringMat = (color: number, opacity: number) =>
			new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity });
		const ring1 = new THREE.Mesh(new THREE.TorusGeometry(2.25, 0.008, 6, 180), ringMat(0xffffff, 0.28));
		const ring2 = new THREE.Mesh(new THREE.TorusGeometry(2.65, 0.006, 6, 200), ringMat(0xffffff, 0.12));
		const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(3.2, 1), ringMat(0xffffff, 0.035));
		for (const m of [ring1, ring2, shell]) m.userData.o = (m.material as THREE.MeshBasicMaterial).opacity;
		ring1.rotation.set(1.2, 0.3, 0);
		ring2.rotation.set(1.8, -0.5, 0.4);
		blobGroup.add(ring1, ring2, shell);

		// 環上的小衛星
		const moon = new THREE.Mesh(
			new THREE.SphereGeometry(0.07, 24, 24),
			new THREE.MeshBasicMaterial({ color: 0xffffff })
		);
		ring1.add(moon);

		// ---- 星塵 ----
		const COUNT = innerWidth < 700 ? 1400 : 3200;
		const pos = new Float32Array(COUNT * 3);
		const col = new Float32Array(COUNT * 3);
		const tints = [new THREE.Color('#ffffff'), new THREE.Color('#bdbdc6'), new THREE.Color('#8d84c9')];
		for (let i = 0; i < COUNT; i++) {
			const r = 4 + Math.pow(Math.random(), 0.6) * 22;
			const th = Math.random() * Math.PI * 2;
			const ph = Math.acos(2 * Math.random() - 1);
			pos.set([r * Math.sin(ph) * Math.cos(th), r * Math.sin(ph) * Math.sin(th) * 0.6, r * Math.cos(ph) - 6], i * 3);
			const c = tints[(Math.random() * tints.length) | 0];
			col.set([c.r, c.g, c.b], i * 3);
		}
		const starGeo = new THREE.BufferGeometry();
		starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
		starGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
		const dot = document.createElement('canvas');
		dot.width = dot.height = 64;
		const g = dot.getContext('2d')!;
		const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
		grd.addColorStop(0, 'rgba(255,255,255,1)');
		grd.addColorStop(0.3, 'rgba(255,255,255,0.5)');
		grd.addColorStop(1, 'rgba(255,255,255,0)');
		g.fillStyle = grd;
		g.fillRect(0, 0, 64, 64);
		const stars = new THREE.Points(
			starGeo,
			new THREE.PointsMaterial({
				size: 0.06,
				opacity: 0.8,
				map: new THREE.CanvasTexture(dot),
				vertexColors: true,
				transparent: true,
				depthWrite: false,
				blending: THREE.AdditiveBlending
			})
		);
		scene.add(stars);

		// ---- 互動狀態 ----
		const mouse = new THREE.Vector2();
		const mouseTarget = new THREE.Vector2();
		let scroll = 0;
		let heroY = 0;
		const onMove = (e: PointerEvent) => mouseTarget.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
		const onScroll = () => {
			heroY = scrollY;
			scroll = scrollY / Math.max(1, document.documentElement.scrollHeight - innerHeight);
		};
		addEventListener('pointermove', onMove, { passive: true });
		addEventListener('scroll', onScroll, { passive: true });
		onScroll();

		const resize = () => {
			const w = innerWidth;
			const h = innerHeight;
			renderer.setSize(w, h, false);
			camera.aspect = w / h;
			camera.fov = w < 700 ? 58 : 42;
			camera.updateProjectionMatrix();
		};
		addEventListener('resize', resize);
		resize();

		const clock = new THREE.Clock();
		let smooth = 0;
		let raf = 0;
		let visible = true;
		const onVis = () => (visible = !document.hidden);
		document.addEventListener('visibilitychange', onVis);

		const tick = () => {
			raf = requestAnimationFrame(tick);
			if (!visible) return;
			const t = reduced ? 0 : clock.getElapsedTime();
			mouse.lerp(mouseTarget, 0.05);
			smooth += (scroll - smooth) * 0.06;

			blobUniforms.uTime.value = t;
			blobUniforms.uMouse.value.copy(mouse);

			const mobile = innerWidth < 700;
			const L = THREE.MathUtils.lerp;
			const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
			// hero 時在主角位置；往下捲退到右邊當背景；到頁尾回到中間
			const h = clamp01(heroY / innerHeight);
			const end = clamp01((smooth - 0.86) / 0.14);
			const ease = (v: number) => v * v * (3 - 2 * v);
			const he = ease(h);
			const ee = ease(end);
			const sideX = mobile ? 1.6 : 3.6;
			blobGroup.position.x = L(L(mobile ? 0 : 1.9, sideX, he), 0, ee);
			blobGroup.position.y = L(L(mobile ? 0.9 : 0.1, mobile ? 1.2 : 0.4, he), mobile ? -1.3 : -2.1, ee);
			blobGroup.scale.setScalar((mobile ? 0.72 : 1) * L(L(1, 0.75, he), 0.7, ee));
			const fade = L(L(1, 0.32, he), 0.55, ee);
			blobUniforms.uFade.value = fade;
			for (const m of [ring1, ring2, shell]) (m.material as THREE.MeshBasicMaterial).opacity = (m.userData.o as number) * fade;
			const s = smooth;
			blobGroup.rotation.y = t * 0.08 + mouse.x * 0.4 + s * 3.5;
			blobGroup.rotation.x = mouse.y * -0.3 + s * 1.2;

			ring1.rotation.z = t * 0.35;
			ring2.rotation.z = -t * 0.22;
			shell.rotation.y = -t * 0.05;
			moon.position.set(Math.cos(t * 1.2) * 2.25, Math.sin(t * 1.2) * 2.25, 0);

			stars.rotation.y = t * 0.012 + s * 1.4;
			stars.rotation.x = s * 0.4;
			camera.position.x = mouse.x * 0.35;
			camera.position.y = mouse.y * 0.25;
			camera.position.z = 6 + s * 2.5;
			camera.lookAt(0, 0, 0);

			renderer.render(scene, camera);
		};
		tick();

		return () => {
			cancelAnimationFrame(raf);
			removeEventListener('pointermove', onMove);
			removeEventListener('scroll', onScroll);
			removeEventListener('resize', resize);
			document.removeEventListener('visibilitychange', onVis);
			renderer.dispose();
		};
	});
</script>

<canvas bind:this={canvas} aria-hidden="true"></canvas>

<style>
	canvas {
		position: fixed;
		inset: 0;
		width: 100vw;
		height: 100vh;
		z-index: 0;
		pointer-events: none;
	}
</style>
