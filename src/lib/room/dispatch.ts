// 把訊息交給場景。Worker 跟主執行緒模式共用，兩種模式行為才會一致

import type { RoomHandle } from './core.js';
import type { ToScene } from './protocol.js';

export function dispatch(r: RoomHandle, msg: Exclude<ToScene, { type: 'init' }>) {
	switch (msg.type) {
		case 'resize':
			return r.resize(msg.width, msg.height, msg.dpr);
		case 'orbit':
			return r.orbit(msg.dx, msg.dy);
		case 'zoom':
			return r.zoom(msg.factor);
		case 'hover':
			return r.hover(msg.x, msg.y);
		case 'click':
			return r.click(msg.x, msg.y);
		case 'focus':
			return r.focus(msg.focus, msg.panel);
		case 'tier':
			return r.setTier(msg.tier);
		case 'qr':
			return r.setQr(msg.on);
		case 'visible':
			return r.setVisible(msg.visible);
		case 'walk':
			return r.setWalk(msg.on);
		case 'move':
			return r.walkMove(msg.x, msg.z, msg.run);
		case 'interact':
			return r.interact();
	}
}
