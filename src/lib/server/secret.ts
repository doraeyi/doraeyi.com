import { timingSafeEqual } from 'node:crypto';

/** 比對密碼、簽章：花的時間跟內容無關，不會被一個字一個字猜出來 */
export function sameSecret(a: string, b: string) {
	const x = Buffer.from(a);
	const y = Buffer.from(b);
	return x.length === y.length && timingSafeEqual(x, y);
}
