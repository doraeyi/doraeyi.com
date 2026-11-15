import QRCode from 'qrcode';
import { GITHUB_LOGIN } from '#lib/server/github.js';
import type { RequestHandler } from './$types';

// QR 卡片的「存圖」：手機掃不到自己的螢幕，給一張乾淨、留白夠的 PNG 存下來或傳給別人
const png = QRCode.toBuffer(`https://github.com/${GITHUB_LOGIN}`, {
	errorCorrectionLevel: 'M',
	margin: 4,
	width: 720,
	color: { dark: '#2c2363', light: '#ffffff' }
});

export const GET: RequestHandler = async () =>
	new Response(new Uint8Array(await png), {
		headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' }
	});
