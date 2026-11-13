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
