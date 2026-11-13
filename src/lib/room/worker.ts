// 3D 場景的 Worker 入口：WebGL 整個在這條執行緒跑，主執行緒只負責版面跟輸入

import { createRoom, type RoomHandle } from './core.js';
import { dispatch } from './dispatch.js';
import type { FromScene, ToScene } from './protocol.js';

let room: RoomHandle | null = null;
const post = (msg: FromScene) => postMessage(msg);

onmessage = (e: MessageEvent<ToScene>) => {
	const msg = e.data;
	try {
		if (msg.type === 'init') room = createRoom(msg.canvas, msg.options, msg.world, post);
		else if (room) dispatch(room, msg);
	} catch (err) {
		post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
	}
};
