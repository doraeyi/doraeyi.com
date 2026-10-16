import { getSiteData } from '#lib/server/site.js';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ setHeaders }) => {
	setHeaders({ 'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600' });
	return getSiteData();
};
