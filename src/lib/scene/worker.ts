// 3D 場景的 Worker 入口：WebGL 整個在這條執行緒跑，主執行緒只負責捲動跟版面

import { createScene, type SceneHandle } from './core.js';
import type { FromScene, ToScene } from './protocol.js';

let scene: SceneHandle | null = null;
const post = (msg: FromScene) => postMessage(msg);

onmessage = (e: MessageEvent<ToScene>) => {
	const msg = e.data;
	try {
		switch (msg.type) {
			case 'init':
				scene = createScene(msg.canvas, msg.options, post);
				break;
			case 'resize':
				scene?.resize(msg.width, msg.height, msg.dpr);
				break;
			case 'pointer':
				scene?.pointer(msg.x, msg.y);
				break;
			case 'scroll':
				scene?.scroll(msg.state);
				break;
			case 'visible':
				scene?.setVisible(msg.visible);
				break;
		}
	} catch (err) {
		post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
	}
};
