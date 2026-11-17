#!/usr/bin/env node
// Claude Code 的 hook：開工、呼叫工具、做完一輪、關掉 session 時，告訴 doraeyi.com 現在在做哪個專案，
// 網站上那個專案的管理員就會跟著工作、停下來等你。
//
// 「哪個專案」看的是 Claude 實際動到的 repo：讀檔、改檔、搜尋帶的路徑，或 Bash 指令 cd 到的資料夾，
// 以最後動到的那個 repo 為準；還沒動到任何檔案前，先用 session 開在哪個資料夾。
// 一個 session 在 YIWallet 資料夾開、卻在改 doraeyi.com 的檔案，網站上動起來的就是 doraeyi.com 那位。
//
// 只送四樣東西：session id、事件名稱、git remote 網址、資料夾名稱。不送對話內容、不送檔名。
// 沒設 DORAEYI_PRESENCE_TOKEN 就什麼都不做；連不上網站也不會擋住 Claude（最多等 3 秒，錯誤全部吞掉）。
// 不能印任何東西到 stdout：UserPromptSubmit 的輸出會被塞進對話裡。
//
// 安裝方式見 README「管理員的工作狀態」。

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';

const token = process.env.DORAEYI_PRESENCE_TOKEN;
const site = process.env.DORAEYI_URL || 'https://doraeyi.com';

const git = (dir, ...args) => {
	try {
		return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
	} catch {
		return null;
	}
};

/** 比路徑用：斜線統一、不分大小寫（Windows） */
const norm = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();

/** Git Bash 的 /d/project/x、~/x 換成真的路徑；相對路徑接在 cwd 後面 */
function realPath(p, cwd) {
	let out = p.trim();
	if (process.platform === 'win32') {
		const m = /^\/([a-z])(\/.*)?$/i.exec(out);
		if (m) out = `${m[1].toUpperCase()}:${m[2] ?? '/'}`;
	}
	if (out === '~' || out.startsWith('~/')) out = join(homedir(), out.slice(1));
	return isAbsolute(out) ? out : resolve(cwd, out);
}

/** 這次工具呼叫動到的路徑：file_path／notebook_path／path，或 Bash 指令裡第一個 cd 到的地方 */
function touchedPath(hook, cwd) {
	const input = hook.tool_input ?? {};
	const p = input.file_path ?? input.notebook_path ?? input.path;
	if (typeof p === 'string' && p) return realPath(p, cwd);
	const cmd = typeof input.command === 'string' ? input.command : '';
	const m = /(?:^|&&|;|\|\|)\s*cd\s+(?:\/d\s+)?(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/.exec(cmd);
	return m ? realPath(m[1] ?? m[2] ?? m[3], cwd) : null;
}

/** 路徑所在的 git repo：{ top, remote }，不在 repo 裡就是 null */
function repoOf(path) {
	let dir = path;
	// 還不存在的檔案（準備新建）往上找到存在的資料夾
	while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
	try {
		if (!statSync(dir).isDirectory()) dir = dirname(dir);
	} catch {
		return null;
	}
	const top = git(dir, 'rev-parse', '--show-toplevel');
	return top ? { top, remote: git(top, 'remote', 'get-url', 'origin') } : null;
}

async function main() {
	if (!token) return;
	let input = '';
	for await (const chunk of process.stdin) input += chunk;
	// 前面有 BOM 的話 JSON.parse 會失敗（某些 shell 用管線傳進來會帶）
	const hook = JSON.parse(input.replace(/^﻿/, ''));
	const event = hook.hook_event_name;
	const session = hook.session_id;
	const cwd = hook.cwd || process.cwd();
	if (!event || !session) return;

	// 每個 session 記一份狀態：上次回報的狀態、時間、正在動的 repo
	const file = join(tmpdir(), `doraeyi-presence-${String(session).replace(/[^\w-]/g, '')}.json`);
	let saved = {};
	try {
		saved = JSON.parse(readFileSync(file, 'utf8'));
	} catch {
		/* 這個 session 第一次 */
	}

	let repo = saved.top ? { top: saved.top, remote: saved.remote ?? null } : null;
	let changed = false;
	const touched = touchedPath(hook, cwd);
	// 還在同一個 repo 裡就不用再問 git
	if (touched && !(repo && (norm(touched) + '/').startsWith(norm(repo.top) + '/'))) {
		const hit = repoOf(touched);
		if (hit && (!repo || norm(hit.top) !== norm(repo.top))) {
			repo = hit;
			changed = true;
		}
	}
	if (!repo) {
		repo = repoOf(cwd);
		changed = true;
	}

	// 每呼叫一次工具都會跑一次：同一個 repo 一分鐘內只回報一次「還在做」，換了 repo 馬上回報
	const tool = event === 'PreToolUse' || event === 'PostToolUse';
	const state = tool || event === 'UserPromptSubmit' ? 'working' : 'other';
	const now = Date.now();
	const skip = tool && !changed && saved.state === 'working' && now - (saved.at ?? 0) < 60_000;
	try {
		writeFileSync(file, JSON.stringify({ state, at: skip ? saved.at : now, top: repo?.top ?? null, remote: repo?.remote ?? null }));
	} catch {
		/* 寫不進去就每次都送 */
	}
	if (skip) return;

	await fetch(new URL('/api/presence', site), {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		body: JSON.stringify({ session, event, repo: repo?.remote ?? null, dir: basename(repo?.top || cwd) }),
		signal: AbortSignal.timeout(3000)
	});
}

// 不要呼叫 process.exit：Windows 上 fetch 的連線還在收尾時硬結束，Node 會 assertion 失敗、回傳 9，
// Claude Code 會把它當成 hook 出錯。讓它自然結束就好（逾時的計時器不會卡住程序）
main()
	.catch(() => {})
	.finally(() => {
		process.exitCode = 0;
	});
