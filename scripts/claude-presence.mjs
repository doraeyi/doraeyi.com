#!/usr/bin/env node
// Claude Code 的 hook：開工、呼叫工具、做完一輪、關掉 session 時，告訴 doraeyi.com 現在在做哪個專案，
// 網站上那個專案的管理員就會跟著工作、停下來等你。
//
// 「哪個專案」看的是 Claude 實際動到的 repo：讀檔、改檔、搜尋帶的路徑，或 Bash 指令 cd 到的資料夾，
// 以最後動到的那個 repo 為準；還沒動到任何檔案前，先用 session 開在哪個資料夾。
// 一個 session 在 YIWallet 資料夾開、卻在改 doraeyi.com 的檔案，網站上動起來的就是 doraeyi.com 那位。
//
// 只送四樣東西：session id、事件名稱、git remote 網址、資料夾名稱。不送對話內容、不送檔名。
// Claude 要 git push 時多帶一個 push: true，網站上那個專案的管理員就先出發去花園澆水，一直澆到 GitHub Actions 部署完。
// 公司的專案：放在 ~/.claude/doraeyi-presence.json 的 workDirs 底下的，一律只送 dir: 'work'，
// 不送 git remote、不送資料夾名稱，網站上對到的是工作室裡那張不公開的「公司」桌子。
// 公司電腦設 { "all": true }：這台電腦上的每個 session 都當作公司的，一律只送 work。
//
// 安裝到這台電腦的 Claude Code：node claude-presence.mjs --install [--all-work] [--work-dir D:/Workspace]
// 會把 hook 加進 ~/.claude/settings.json（先備份），選項寫進 ~/.claude/doraeyi-presence.json。
// 沒設 DORAEYI_PRESENCE_TOKEN 就什麼都不做；連不上網站也不會擋住 Claude（最多等 3 秒，錯誤全部吞掉）。
// 不能印任何東西到 stdout：UserPromptSubmit 的輸出會被塞進對話裡。
//
// 安裝方式見 README「管理員的工作狀態」。

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const token = process.env.DORAEYI_PRESENCE_TOKEN;
const site = process.env.DORAEYI_URL || 'https://doraeyi.com';
const CONFIG = join(homedir(), '.claude', 'doraeyi-presence.json');
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'Stop', 'Notification', 'SessionEnd'];

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

function readConfig() {
	try {
		return JSON.parse(readFileSync(CONFIG, 'utf8'));
	} catch {
		return {};
	}
}

/** 公司專案的資料夾，例如 { "workDirs": ["D:/Workspace"] } */
function workDirs(conf) {
	return Array.isArray(conf.workDirs) ? conf.workDirs.filter((d) => typeof d === 'string' && d) : [];
}

/** 路徑在哪個專案裡：公司資料夾 → { top: 那個資料夾, work: true }；否則找 git repo；都不是就是 null */
function locate(path, work) {
	const dir = work.find((w) => (norm(path) + '/').startsWith(norm(w) + '/'));
	return dir ? { top: dir, remote: null, work: true } : repoOf(path);
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
	// 前面有 BOM 的話 JSON.parse 會失敗（某些 shell 用管線傳進來會帶）；trim 會連 BOM 一起去掉
	const hook = JSON.parse(input.trim());
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

	const conf = readConfig();
	const work = workDirs(conf);
	let repo = saved.top ? { top: saved.top, remote: saved.remote ?? null, work: Boolean(saved.work) } : null;
	let changed = false;
	const touched = conf.all ? null : touchedPath(hook, cwd);
	const inside = (path, dir) => (norm(path) + '/').startsWith(norm(dir) + '/');
	if (conf.all) {
		// 公司電腦：不管在哪裡都當作公司的，連 git 都不用問
		changed = saved.top !== 'work';
		repo = { top: 'work', remote: null, work: true };
	} else if (touched && (work.some((w) => inside(touched, w)) || !(repo && inside(touched, repo.top)))) {
		// 還在同一個 repo 裡就不用再問 git；公司資料夾先比，就算它放在某個 git repo 裡面也算公司的
		const hit = locate(touched, work);
		if (hit && (!repo || norm(hit.top) !== norm(repo.top))) {
			repo = hit;
			changed = true;
		}
	}
	if (!repo) {
		repo = locate(cwd, work);
		changed = true;
	}

	// 每呼叫一次工具都會跑一次：同一個 repo 一分鐘內只回報一次「還在做」，換了 repo 馬上回報
	const tool = event === 'PreToolUse' || event === 'PostToolUse';
	const state = tool || event === 'UserPromptSubmit' ? 'working' : 'other';
	const now = Date.now();
	// Claude 正要 git push：一定要馬上回報，管理員先出發去花園澆水，一直澆到 GitHub Actions 部署完（公司的不算）
	const cmd = event === 'PreToolUse' ? hook.tool_input?.command : null;
	const push = typeof cmd === 'string' && /(?:^|[\s;&|(])git(?:\s+-C\s+\S+)?\s+push(?:\s|$)/.test(cmd) && !repo?.work;
	const skip = !push && tool && !changed && saved.state === 'working' && now - (saved.at ?? 0) < 60_000;
	try {
		writeFileSync(file, JSON.stringify({ state, at: skip ? saved.at : now, top: repo?.top ?? null, remote: repo?.remote ?? null, work: Boolean(repo?.work) }));
	} catch {
		/* 寫不進去就每次都送 */
	}
	if (skip) return;

	await fetch(new URL('/api/presence', site), {
		method: 'POST',
		headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
		// 公司的專案只送 work，什麼名稱都不帶出去
		body: JSON.stringify(repo?.work ? { session, event, repo: null, dir: 'work' } : { session, event, repo: repo?.remote ?? null, dir: basename(repo?.top || cwd), push }),
		signal: AbortSignal.timeout(3000)
	});
}

/** --install：把自己複製到 ~/.claude/hooks，加進 settings.json 的 hooks，選項寫進設定檔 */
function install(args) {
	const dir = join(homedir(), '.claude');
	const target = join(dir, 'hooks', 'doraeyi-presence.mjs');
	mkdirSync(dirname(target), { recursive: true });
	const self = fileURLToPath(import.meta.url);
	if (resolve(self).toLowerCase() !== resolve(target).toLowerCase()) copyFileSync(self, target);

	const settingsFile = join(dir, 'settings.json');
	let settings = {};
	if (existsSync(settingsFile)) {
		settings = JSON.parse(readFileSync(settingsFile, 'utf8').trim() || '{}');
		copyFileSync(settingsFile, `${settingsFile}.bak-presence`);
	}
	const command = `node "${target.replace(/\\/g, '/')}"`;
	settings.hooks ??= {};
	for (const ev of EVENTS) {
		const list = (settings.hooks[ev] ??= []);
		if (!list.some((g) => g.hooks?.some((h) => h.command === command))) list.push({ hooks: [{ type: 'command', command, timeout: 5 }] });
	}
	writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + '\n');

	const conf = readConfig();
	if (args.includes('--all-work')) conf.all = true;
	const dirs = args.flatMap((a, i) => (args[i - 1] === '--work-dir' ? [a] : []));
	if (dirs.length) conf.workDirs = [...new Set([...workDirs(conf), ...dirs])];
	writeFileSync(CONFIG, JSON.stringify(conf, null, 2) + '\n');

	console.log(`✓ hook 裝好了：${target}`);
	console.log(`✓ 已加進 ${settingsFile}（原本的備份成 settings.json.bak-presence）`);
	if (conf.all) console.log('✓ 這台電腦上的每個 session 都算公司的，只會送 work');
	else if (conf.workDirs?.length) console.log(`✓ 這些資料夾算公司的：${conf.workDirs.join('、')}`);
}

if (process.argv[2] === '--install') {
	install(process.argv.slice(3));
} else {
	// 不要呼叫 process.exit：Windows 上 fetch 的連線還在收尾時硬結束，Node 會 assertion 失敗、回傳 9，
	// Claude Code 會把它當成 hook 出錯。讓它自然結束就好（逾時的計時器不會卡住程序）
	main()
		.catch(() => {})
		.finally(() => {
			process.exitCode = 0;
		});
}
