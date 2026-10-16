import mysql from 'mysql2/promise';
import { DATABASE_URL } from '$app/env/private';
import type { Profile } from '#lib/types.js';

let pool: mysql.Pool | null = null;

export const hasDatabase = () => Boolean(DATABASE_URL);

function db() {
	pool ??= mysql.createPool({
		uri: DATABASE_URL!,
		connectionLimit: 4,
		connectTimeout: 5000,
		charset: 'utf8mb4'
	});
	return pool;
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

/** mysql2 會自動 parse JSON 欄位，但 MariaDB 的 JSON 是 LONGTEXT，要自己 parse */
function json<T>(value: unknown): T | null {
	if (value == null) return null;
	if (typeof value === 'string') {
		try {
			return JSON.parse(value) as T;
		} catch {
			return null;
		}
	}
	return value as T;
}

export async function getProfile(): Promise<Profile | null> {
	const [rows] = await db().query<mysql.RowDataPacket[]>('SELECT * FROM profile WHERE id = 1');
	const r = rows[0];
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
	const [rows] = await db().query<mysql.RowDataPacket[]>('SELECT * FROM project_meta');
	return new Map(
		rows.map((r) => [
			r.vercel_name as string,
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
