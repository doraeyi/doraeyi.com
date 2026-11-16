// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		interface PageState {
			/** 這筆歷史是打開資訊卡時推進去的，用 ✕ 關掉時退回去，不要一直疊 */
			card?: boolean;
		}
		// interface Platform {}
	}
}

export {};
