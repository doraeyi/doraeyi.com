import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DATABASE_URL } from '$app/env/private';
import type { Health, Profile } from '#lib/types.js';
import schema from '../../../db/schema.sql?raw';
import { fallbackProfile, fallbackVmProjects } from './fallback.js';

/** 資料庫檔案位置；截圖也放在同一個資料夾底下，VM 上掛在 ./data，重新部署不會不見 */
export const DB_FILE = DATABASE_URL ?? 'data/doraeyi.db';

let conn: Database.Database | null = null;

/** 第一次用到才開檔：建資料夾、建表、放入預設個人資料 */
function db() {
	if (conn) return conn;
	const file = DB_FILE;
	mkdirSync(dirname(file), { recursive: true });
	conn = new Database(file);
	conn.pragma('journal_mode = WAL');
	conn.exec(schema);
	const p = fallbackProfile;
	conn
		.prepare(
			`INSERT OR IGNORE INTO profile (id, name, handle, role, tagline, bio, location, email, avatar_url, skills, links)
			 VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
		)
		.run(p.name, p.handle, p.role, p.tagline, p.bio, p.location, p.email, p.avatarUrl, JSON.stringify(p.skills), JSON.stringify(p.links));
	const vm = conn.prepare(
		`INSERT OR IGNORE INTO vm_project (slug, title, description, url, tags, sort_order) VALUES (?, ?, ?, ?, ?, ?)`
	);
	for (const v of fallbackVmProjects) vm.run(v.slug, v.title, v.description, v.url, JSON.stringify(v.tags), v.sortOrder);
	return conn;
}

export interface ProjectMeta {
	title: string | null;
	description: string | null;
	tags: string[] | null;
	url: string | null;
	repo: string | null;
	accent: string | null;
	featured: boolean;
	hidden: boolean;
	sortOrder: number;
}

/** JSON 欄位在 SQLite 裡是字串，壞掉的值當成沒有 */
function json<T>(value: unknown): T | null {
	if (typeof value !== 'string') return null;
	try {
		return JSON.parse(value) as T;
	} catch {
		return null;
	}
}

interface ProfileRow {
	name: string;
	handle: string;
	role: string;
	tagline: string;
	bio: string;
	location: string;
	email: string;
	avatar_url: string | null;
	skills: string;
	links: string;
}

interface MetaRow {
	vercel_name: string;
	title: string | null;
	description: string | null;
	tags: string | null;
	url: string | null;
	repo: string | null;
	accent: string | null;
	featured: number;
	hidden: number;
	sort_order: number;
}

export async function getProfile(): Promise<Profile | null> {
	const r = db().prepare('SELECT * FROM profile WHERE id = 1').get() as ProfileRow | undefined;
	if (!r) return null;
	return {
		name: r.name,
		handle: r.handle,
		role: r.role,
		tagline: r.tagline,
		bio: r.bio,
		location: r.location,
		email: r.email,
		avatarUrl: r.avatar_url,
		skills: json<string[]>(r.skills) ?? [],
		links: json<Profile['links']>(r.links) ?? []
	};
}

export async function getProjectMeta(): Promise<Map<string, ProjectMeta>> {
	const rows = db().prepare('SELECT * FROM project_meta').all() as MetaRow[];
	return new Map(
		rows.map((r) => [
			r.vercel_name,
			{
				title: r.title,
				description: r.description,
				tags: json<string[]>(r.tags),
				url: r.url,
				repo: r.repo,
				accent: r.accent,
				featured: Boolean(r.featured),
				hidden: Boolean(r.hidden),
				sortOrder: r.sort_order
			}
		])
	);
}

export interface VmProject {
	slug: string;
	title: string;
	description: string;
	url: string;
	repo: string | null;
	tags: string[];
	sortOrder: number;
}

interface VmRow {
	slug: string;
	title: string;
	description: string;
	url: string;
	repo: string | null;
	tags: string | null;
	sort_order: number;
}

export async function getVmProjects(): Promise<VmProject[]> {
	const rows = db().prepare('SELECT * FROM vm_project WHERE hidden = 0 ORDER BY sort_order, slug').all() as VmRow[];
	return rows.map((r) => ({
		slug: r.slug,
		title: r.title,
		description: r.description,
		url: r.url,
		repo: r.repo,
		tags: json<string[]>(r.tags) ?? [],
		sortOrder: r.sort_order
	}));
}

interface HealthRow {
	project_key: string;
	ok: number;
	status: number | null;
	ms: number | null;
	note: string | null;
	checked_at: number;
	checks: number;
	fails: number;
}

export function getHealth(): Map<string, Health> {
	const rows = db().prepare('SELECT * FROM health').all() as HealthRow[];
	return new Map(
		rows.map((r) => [
			r.project_key,
			{
				ok: Boolean(r.ok),
				status: r.status,
				ms: r.ms,
				note: r.note,
				checkedAt: r.checked_at,
				uptime: r.checks ? (r.checks - r.fails) / r.checks : 1
			}
		])
	);
}

/** 記下一次檢查結果，順便累計次數算妥善率 */
export function saveHealth(key: string, h: Omit<Health, 'uptime'>) {
	db()
		.prepare(
			`INSERT INTO health (project_key, ok, status, ms, note, checked_at, checks, fails)
			 VALUES (@key, @ok, @status, @ms, @note, @checkedAt, 1, @fail)
			 ON CONFLICT(project_key) DO UPDATE SET
			   ok = excluded.ok, status = excluded.status, ms = excluded.ms, note = excluded.note,
			   checked_at = excluded.checked_at, checks = checks + 1, fails = fails + excluded.fails`
		)
		.run({ key, ok: Number(h.ok), status: h.status, ms: h.ms, note: h.note, checkedAt: h.checkedAt, fail: Number(!h.ok) });
}

/** 每個專案最近一次截圖的時間 */
export function getShots(): Map<string, number> {
	const rows = db().prepare('SELECT project_key, taken_at FROM screenshot').all() as { project_key: string; taken_at: number }[];
	return new Map(rows.map((r) => [r.project_key, r.taken_at]));
}

export function saveShot(key: string, takenAt: number) {
	db()
		.prepare('INSERT INTO screenshot (project_key, taken_at) VALUES (?, ?) ON CONFLICT(project_key) DO UPDATE SET taken_at = excluded.taken_at')
		.run(key, takenAt);
}

export type PresenceState = 'working' | 'waiting';

export interface PresenceRow {
	repo: string | null;
	dir: string;
	state: PresenceState;
	updated_at: number;
}

/** 記下某個 Claude session 現在的狀態；state 是 null 代表 session 結束了 */
export function savePresence(session: string, p: { repo: string | null; dir: string; state: PresenceState | null }, now = Date.now()) {
	if (!p.state) {
		db().prepare('DELETE FROM presence WHERE session_id = ?').run(session);
		return;
	}
	db()
		.prepare(
			`INSERT INTO presence (session_id, repo, dir, state, updated_at) VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(session_id) DO UPDATE SET repo = excluded.repo, dir = excluded.dir, state = excluded.state, updated_at = excluded.updated_at`
		)
		.run(session, p.repo, p.dir, p.state, now);
	// 關掉視窗沒送 SessionEnd 的 session 會一直留著，順便清掉一天以前的
	db().prepare('DELETE FROM presence WHERE updated_at < ?').run(now - 24 * 3600 * 1000);
}

export function getPresence(since: number): PresenceRow[] {
	return db().prepare('SELECT repo, dir, state, updated_at FROM presence WHERE updated_at >= ?').all(since) as PresenceRow[];
}

// ---- 澆水：一次 push 從開始到部署完成 ----

/** Claude 開始 push，這麼久 GitHub 還沒收到，就當作沒推成功 */
export const PUSH_WAIT = 3 * 60 * 1000;
/** GitHub 收到 push 後，這麼久都沒有 GitHub Actions 開跑，就當作這個 repo 沒有 CI */
export const NO_CI_WAIT = 25 * 1000;
/** CI 跑這麼久還沒好，不等了 */
export const DEPLOY_MAX = 40 * 60 * 1000;
/** 澆完之後還留在清單上這麼久，晚一點才問的網頁也看得到結果 */
export const KEEP_DONE = 3 * 60 * 1000;

export interface WateringRow {
	id: number;
	repo: string;
	sha: string | null;
	commits: number;
	started_at: number;
	pushed_at: number | null;
	runs: string;
	saw_run: number;
	ok: number;
	done_at: number | null;
}

const latestBySha = (repo: string, sha: string) =>
	db().prepare('SELECT * FROM watering WHERE repo = ? AND sha = ? ORDER BY id DESC LIMIT 1').get(repo, sha) as WateringRow | undefined;

/** Claude 開始 git push：管理員出發。同一個 repo 已經有一個在等 GitHub 的就不重複開 */
export function startWatering(repo: string, now = Date.now()) {
	const open = db()
		.prepare('SELECT id FROM watering WHERE repo = ? AND done_at IS NULL AND pushed_at IS NULL AND started_at > ?')
		.get(repo, now - PUSH_WAIT);
	if (!open) db().prepare('INSERT INTO watering (repo, started_at) VALUES (?, ?)').run(repo, now);
}

/** GitHub 收到 push：接上 Claude 開始的那一筆；手動 push 沒有那一筆，就從現在開始 */
export function recordPush(repo: string, sha: string, commits: number, now = Date.now()) {
	const row =
		latestBySha(repo, sha) ??
		(db()
			.prepare('SELECT * FROM watering WHERE repo = ? AND sha IS NULL AND done_at IS NULL AND started_at > ? ORDER BY id DESC LIMIT 1')
			.get(repo, now - PUSH_WAIT) as WateringRow | undefined);
	if (row) {
		db()
			.prepare('UPDATE watering SET sha = ?, commits = commits + ?, pushed_at = COALESCE(pushed_at, ?) WHERE id = ?')
			.run(sha, commits, now, row.id);
	} else {
		db().prepare('INSERT INTO watering (repo, sha, commits, started_at, pushed_at) VALUES (?, ?, ?, ?, ?)').run(repo, sha, commits, now, now);
	}
}

/** GitHub Actions 開跑（start）或跑完（end）。這次 push 的 run 全部跑完，就澆完了 */
export function recordRun(repo: string, sha: string, runId: number, status: 'start' | 'end', ok: boolean, now = Date.now()) {
	let row = latestBySha(repo, sha);
	if (!row) {
		// 有時候 Actions 的通知比 push 的先到
		db().prepare('INSERT INTO watering (repo, sha, started_at) VALUES (?, ?, ?)').run(repo, sha, now);
		row = latestBySha(repo, sha)!;
	}
	if (row.done_at) return;
	const runs = new Set<number>(json<number[]>(row.runs) ?? []);
	if (status === 'start') runs.add(runId);
	else runs.delete(runId);
	const done = status === 'end' && runs.size === 0;
	db()
		.prepare('UPDATE watering SET runs = ?, saw_run = 1, ok = ok * ?, done_at = ? WHERE id = ?')
		.run(JSON.stringify([...runs]), status === 'end' && !ok ? 0 : 1, done ? now : null, row.id);
}

/** 還在澆的，加上剛澆完的。順便把等太久的收掉：push 沒送上去、沒有 CI、CI 卡住 */
export function getWaterings(now = Date.now()): WateringRow[] {
	const conn = db();
	conn
		.prepare('UPDATE watering SET done_at = ?, ok = 0 WHERE done_at IS NULL AND pushed_at IS NULL AND saw_run = 0 AND started_at < ?')
		.run(now, now - PUSH_WAIT);
	conn.prepare('UPDATE watering SET done_at = ? WHERE done_at IS NULL AND pushed_at < ? AND saw_run = 0').run(now, now - NO_CI_WAIT);
	conn.prepare('UPDATE watering SET done_at = ? WHERE done_at IS NULL AND started_at < ?').run(now, now - DEPLOY_MAX);
	conn.prepare('DELETE FROM watering WHERE started_at < ?').run(now - 24 * 3600 * 1000);
	return conn.prepare('SELECT * FROM watering WHERE done_at IS NULL OR done_at > ? ORDER BY id').all(now - KEEP_DONE) as WateringRow[];
}
