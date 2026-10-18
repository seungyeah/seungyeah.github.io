export function createUrls(site, repository = process.env.GITHUB_REPOSITORY ?? '') {
	const [owner = '', repo = ''] = repository.split('/');
	const projectPath =
		repo && repo.toLowerCase() !== `${owner}.github.io`.toLowerCase() ? `/${repo}` : '';
	const configuredBase = String(site.baseUrl ?? '').trim();
	let basePath = projectPath;
	let configuredPublicBase = '';
	try {
		if (configuredBase) {
			const configuredUrl = new URL(configuredBase);
			if (
				(configuredUrl.protocol === 'https:' || configuredUrl.protocol === 'http:') &&
				!configuredUrl.username &&
				!configuredUrl.password
			) {
				basePath = configuredUrl.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
				configuredPublicBase = `${configuredUrl.origin}${basePath}`;
			}
		}
	} catch {}
	const fallbackBase = owner ? `https://${owner}.github.io${projectPath}` : '';
	const publicBase = configuredPublicBase || fallbackBase;
	const href = (value) => `${basePath}${value}` || '/';
	const absolute = (value) => (publicBase ? `${publicBase}${value}` : href(value));
	// Canonicals require a known public origin; local previews must not emit relative ones.
	const canonical = (value) => (publicBase ? absolute(value) : null);
	return { owner, repo, basePath, publicBase, href, absolute, canonical };
}
