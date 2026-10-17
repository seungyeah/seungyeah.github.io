import { createHash } from 'node:crypto';
import path from 'node:path';

export function planRenderInputs({
	posts,
	folders,
	inputHashes,
	assetClaims,
	outputHashes,
	basePath,
	publicBase,
	owner = '',
	repo = '',
	generatorSha256,
	runtimeAssets = {},
}) {
	// Current sources alone plan post routes; cached/deleted routes cannot add outputs.
	const uniquePathsByPost = new Map(
		posts.map((post) => [post.postId, [`posts/${post.permalink}/index.html`]])
	);
	for (const asset of assetClaims) uniquePathsByPost.get(asset.postId).push(asset.path);
	for (const paths of uniquePathsByPost.values()) paths.sort();
	const hashInput = (value) => createHash('sha256').update(value).digest('hex');
	const siteSha256 = inputHashes.get('.layall/site.json') ?? hashInput('{}');
	const context = {
		basePath,
		publicBase,
		repository: { owner, repo },
		runtimeAssets,
		runtime: {
			node: process.versions.node,
			icu: process.versions.icu ?? null,
			tz: process.versions.tz ?? null,
			timeZone: new Intl.DateTimeFormat().resolvedOptions().timeZone,
		},
	};
	// Lists/search/feed use source text and attachment metadata, not rendered Markdown.
	// Only a post HTML depends on this source, its own folder, site/runtime and assets.
	// Ancestor folders/other posts affect the separately regenerated navigation resource.
	const postInputs = Object.fromEntries(
		[...posts]
			.sort((left, right) => String(left.postId).localeCompare(String(right.postId)))
			.map((post) => {
				const route = `posts/${post.permalink}/index.html`;
				const sourceSha256 = inputHashes.get(path.join(post.sourceDir, 'post.layallnote'));
				const folderSha256 = hashInput(
					JSON.stringify(folders.get(String(post.folderId ?? '')) ?? null)
				);
				const assets = uniquePathsByPost
					.get(post.postId)
					.filter((name) => name !== route)
					.map((name) => ({ path: name, sha256: outputHashes.get(name) }));
				const key = hashInput(
					JSON.stringify([
						'layall-post-html-v1',
						generatorSha256,
						siteSha256,
						context,
						sourceSha256,
						folderSha256,
						post.publicationDates,
						assets,
						route,
					])
				);
				return [
					post.postId,
					{
						sourceSha256,
						folderSha256,
						assets,
						cacheableOutputs: [{ path: route, key }],
					},
				];
			})
	);

	return { uniquePathsByPost, siteSha256, context, postInputs };
}
