import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DATABASE_URL } from '$app/env/private';
import type { Profile } from '#lib/types.js';
import schema from '../../../db/schema.sql?raw';
import { fallbackProfile } from './fallback.js';

let conn: Database.Database | null = null;

/** 第一次用到才開檔：建資料夾、建表、放入預設個人資料 */
function db() {
	if (conn) return conn;
	const file = DATABASE_URL ?? 'data/doraeyi.db';
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
