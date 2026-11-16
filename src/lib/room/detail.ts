// 材質紋路：木地板、木紋、牆面、機房架高地板、石磚、草叢、碎石。
// 不載入圖片，全部在 shader 裡用世界座標算出來，所以不管牆多長都不會拉伸，檔案也不會變大。
// 頂點（或 InstancedMesh 的每一格）帶一個 pattern 數字，決定要畫哪一種紋路

import * as THREE from 'three';

export const PATTERN = {
	plain: 0,
	/** 木地板：一條條木板、接縫、木紋 */
	planks: 1,
	/** 粉刷牆面：很淡的斑駁 */
	plaster: 2,
	/** 機房架高地板：每一格四周有一圈倒角 */
	panel: 3,
	/** 實木：只有木紋、沒有接縫（桌面、書櫃） */
	wood: 4,
	/** 石磚：倒角 + 細碎的磨石子斑點 */
	stone: 5,
	/** 樹籬、草叢：一叢叢的葉子 */
	hedge: 6,
	/** 碎石：細碎的深淺顆粒 */
	gravel: 7
} as const;

/**
 * 在 MeshToonMaterial 上加紋路。回傳的 uniform 可以調整紋路強度：
 * 地磚變成 QR code 時把強度降到 0，格子才會是乾淨的純色，掃描器比較好讀
 */
export function addDetail(material: THREE.MeshToonMaterial) {
	const uniforms = { uDetail: { value: 1 } };
	material.onBeforeCompile = (shader) => {
		shader.uniforms.uDetail = uniforms.uDetail;
		shader.vertexShader = shader.vertexShader
			.replace(
				'#include <common>',
				/* glsl */ `#include <common>
				attribute float pattern;
				varying float vPattern;
				varying vec3 vWorld;
				varying vec3 vLocal;`
			)
			.replace(
				'#include <project_vertex>',
				/* glsl */ `#include <project_vertex>
				vec4 detailPos = vec4(transformed, 1.0);
				#ifdef USE_INSTANCING
					detailPos = instanceMatrix * detailPos;
				#endif
				vWorld = (modelMatrix * detailPos).xyz;
				// InstancedMesh 的格子是 1×1×1 的方塊，position 就是格子裡的相對位置
				vLocal = position + 0.5;
				vPattern = pattern;`
			);
		shader.fragmentShader = shader.fragmentShader
			.replace(
				'#include <common>',
				/* glsl */ `#include <common>
				uniform float uDetail;
				varying float vPattern;
				varying vec3 vWorld;
				varying vec3 vLocal;
				float dHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
				float dNoise(vec2 p) {
					vec2 i = floor(p);
					vec2 f = fract(p);
					f = f * f * (3.0 - 2.0 * f);
					return mix(mix(dHash(i), dHash(i + vec2(1.0, 0.0)), f.x), mix(dHash(i + vec2(0.0, 1.0)), dHash(i + vec2(1.0, 1.0)), f.x), f.y);
				}
				float grain(vec2 p) {
					// 沿著 x 方向拉長的木紋，再用低頻雜訊讓紋路彎一點
					float n = dNoise(vec2(p.x * 1.2, p.y * 26.0) + dNoise(p * 2.0) * 3.0);
					return 0.94 + 0.09 * n;
				}
				float bevel(vec3 l, float w) {
					float e = min(min(l.x, 1.0 - l.x), min(l.z, 1.0 - l.z));
					return smoothstep(0.0, w, e);
				}
				// 只在最後 return 一次：中途 return 在 Windows（D3D）上會被當成「可能沒給值」而跳警告
				float detailShade() {
					int p = int(vPattern + 0.5);
					float s = 1.0;
					if (p == 1) {
						float row = floor(vWorld.z / 0.2);
						float along = vWorld.x + dHash(vec2(row, 3.0)) * 4.0;
						float board = floor(along / 1.3);
						// 離木板邊緣多遠（公尺），貼著邊的那一點點畫成接縫
						float seamZ = smoothstep(0.0, 0.012, 0.1 - abs(fract(vWorld.z / 0.2) - 0.5) * 0.2);
						float seamX = smoothstep(0.0, 0.01, 0.65 - abs(fract(along / 1.3) - 0.5) * 1.3);
						float tone = 0.94 + 0.1 * dHash(vec2(row, board));
						s = grain(vec2(along, vWorld.z)) * tone * mix(0.8, 1.0, seamZ * seamX);
					} else if (p == 2) {
						s = 0.975 + 0.045 * dNoise(vec2(vWorld.x + vWorld.z, vWorld.y) * 7.0) + 0.02 * dNoise(vec2(vWorld.x - vWorld.z, vWorld.y) * 31.0);
					} else if (p == 3) {
						s = mix(0.8, 1.0, bevel(vLocal, 0.07)) * (0.97 + 0.04 * dNoise(vWorld.xz * 40.0));
					} else if (p == 4) {
						s = grain(vec2(vWorld.x + vWorld.y * 0.3, vWorld.z + vWorld.y));
					} else if (p == 5) {
						float speck = step(0.9, dHash(floor(vWorld.xz * 32.0))) * 0.1;
						s = mix(0.88, 1.0, bevel(vLocal, 0.05)) * (0.95 + 0.07 * dNoise(vWorld.xz * 6.0) - speck);
					} else if (p == 6) {
						float leaf = dNoise(vWorld.xz * 13.0 + vWorld.y * 9.0) * 0.6 + dNoise(vWorld.xz * 31.0 - vWorld.y * 17.0) * 0.4;
						// 越上面越亮，像頂端的嫩葉
						s = (0.78 + 0.34 * leaf) * (0.9 + 0.2 * clamp(vLocal.y, 0.0, 1.0));
					} else if (p == 7) {
						vec2 g = floor(vWorld.xz * 55.0);
						s = 0.94 + 0.08 * dNoise(vWorld.xz * 9.0) - 0.08 * step(0.82, dHash(g)) + 0.05 * step(0.88, dHash(g + 7.0));
					}
					return s;
				}`
			)
			.replace(
				'#include <color_fragment>',
				/* glsl */ `#include <color_fragment>
				diffuseColor.rgb *= mix(1.0, detailShade(), uDetail);`
			);
	};
	// 加了紋路的材質要跟沒加的分開編譯，不然 three 會拿快取裡的舊程式
	material.customProgramCacheKey = () => 'detail';
	return uniforms;
}
