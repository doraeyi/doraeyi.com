export interface Profile {
	name: string;
	handle: string;
	role: string;
	tagline: string;
	bio: string;
	location: string;
	email: string;
	avatarUrl: string | null;
	skills: string[];
	links: { label: string; url: string }[];
}

export interface Project {
	/** Vercel 專案名稱，也是 project_meta 表的 key */
	id: string;
	title: string;
	description: string;
	url: string | null;
	repo: string | null;
	framework: string | null;
	tags: string[];
	featured: boolean;
	accent: string;
	createdAt: number;
	updatedAt: number;
	lastDeployAt: number | null;
	state: 'READY' | 'BUILDING' | 'ERROR' | 'QUEUED' | 'CANCELED' | 'UNKNOWN';
}

export interface ActivityDay {
	/** YYYY-MM-DD */
	date: string;
	count: number;
}

export interface SiteData {
	profile: Profile;
	projects: Project[];
	activity: ActivityDay[];
	totalDeploys: number;
	source: { vercel: boolean; database: boolean };
}
