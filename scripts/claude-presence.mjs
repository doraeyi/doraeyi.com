#!/usr/bin/env node
// Claude Code 的 hook：開工、呼叫工具、做完一輪、關掉 session 時，告訴 doraeyi.com 現在在做哪個專案，
// 網站上那個專案的管理員就會跟著工作、停下來等你。
//
// 只送四樣東西：session id、事件名稱、git remote 網址、資料夾名稱。不送對話內容。
// 沒設 DORAEYI_PRESENCE_TOKEN 就什麼都不做；連不上網站也不會擋住 Claude（最多等 3 秒，錯誤全部吞掉）。
// 不能印任何東西到 stdout：UserPromptSubmit 的輸出會被塞進對話裡。
//
// 安裝方式見 README「管理員的工作狀態」。

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

const token = process.env.DORAEYI_PRESENCE_TOKEN;
const site = process.env.DORAEYI_URL || 'https://doraeyi.com';

async function main() {
	if (!token) return;
	let input = '';
	for await (const chunk of process.stdin) input += chunk;
	const hook = JSON.parse(input);
	const event = hook.hook_event_name;
	const session = hook.session_id;
	const cwd = hook.cwd || process.cwd();
	if (!event || !session) return;

	// 每呼叫一次工具都會跑一次，同一個 session 一分鐘內只回報一次「還在做」
	const working = event === 'PreToolUse' || event === 'PostToolUse';
	const stamp = join(tmpdir(), `doraeyi-presence-${String(session).replace(/[^\w-]/g, '')}`);
	if (working) {
		try {
			const [last, at] = readFileSync(stamp, 'utf8').split(' ');
			if (last === 'working' && Date.now() - Number(at) < 60_000) return;
		} catch {
			/* 第一次 */
		}
	}
	try {
		writeFileSync(stamp, `${working || event === 'UserPromptSubmit' ? 'working' : 'other'} ${Date.now()}`);
	} catch {
		/* 寫不進去就每次都送 */
	}

	const git = (...args) => {
		try {
			return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
		} catch {
			return null;
		}
	};
	const top = git('rev-parse', '--show-toplevel');
	await fetch(new URL('/api/presence', site), {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify({ session, event, repo: top ? git('remote', 'get-url', 'origin') : null, dir: basename(top || cwd) }),
		signal: AbortSignal.timeout(3000)
	});
}

main().catch(() => {}).finally(() => process.exit(0));
