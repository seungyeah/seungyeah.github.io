import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export function createOutput(out, posts) {
	if (!out) throw new Error('output directory required');
	if (fs.existsSync(out)) throw new Error('output must be fresh');
	fs.mkdirSync(out, { recursive: true });
	const generated = [];
	const generatedSet = new Set();
	const outputHashes = new Map();
	const outputOwners = new Map();
	const { referencedPathsByPost, recordReferences } = createReferenceIndex(posts);
	const write = (name, data, ownerId = null) => {
		const outputRoot = path.resolve(out);
		const file = path.resolve(outputRoot, name);
		if (!file.startsWith(`${outputRoot}${path.sep}`)) throw new Error('unsafe output path');
		if (generatedSet.has(name)) throw new Error('duplicate output path');
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, data);
		generated.push(name);
		generatedSet.add(name);
		const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
		outputHashes.set(name, createHash('sha256').update(bytes).digest('hex'));
		if (ownerId !== null) {
			outputOwners.set(name, ownerId);
			recordReferences(name, bytes, ownerId);
		}
	};
	function finish({
		sha,
		generatorSha256,
		siteSha256,
		context,
		postInputs,
		uniquePathsByPost,
		assetClaims,
		profileAsset,
	}) {
		write(
			'assets-manifest.json',
			JSON.stringify({ files: assetClaims, profile: profileAsset })
		);
		write('__layall-deploy.json', JSON.stringify({ format: 'layall-deploy', sourceSha: sha }));
		write(
			'generated-files.json',
			JSON.stringify({
				files: [
					...generated,
					'generated-files.json',
					'__layall-output-manifest.json',
				].sort(),
			})
		);

		// Owned outputs have direct claims plus exact raw-byte reverse references. Every
		// other output belongs to a conservative shared group (including the nav resource).
		// A deletion proof MUST also inspect new/changed files and removed old paths: the
		// new snapshot cannot index references to an ID that is no longer a source post.
		write(
			'__layall-output-manifest.json',
			JSON.stringify(
				describeOutput({
					posts,
					outputHashes,
					outputOwners,
					referencedPathsByPost,
					uniquePathsByPost,
					sha,
					generatorSha256,
					siteSha256,
					context,
					postInputs,
				})
			)
		);
	}
	return { write, finish, outputHashes };
}

export function createReferenceIndex(posts) {
	const referencedPathsByPost = new Map(posts.map((post) => [post.postId, new Set()]));

	// A byte trie with failure links finds overlapping raw IDs/routes, including code,
	// manual links and binary assets. Non-owned outputs are conservatively shared.
	const referenceStates = [{ edges: new Map(), fail: 0, matches: [] }];
	for (const post of posts) {
		for (const marker of [post.postId, `posts/${post.permalink}/`]) {
			let state = 0;
			for (const byte of Buffer.from(marker)) {
				if (!referenceStates[state].edges.has(byte)) {
					referenceStates[state].edges.set(byte, referenceStates.length);
					referenceStates.push({ edges: new Map(), fail: 0, matches: [] });
				}
				state = referenceStates[state].edges.get(byte);
			}
			referenceStates[state].matches.push(post.postId);
		}
	}
	const referenceQueue = [...referenceStates[0].edges.values()];
	for (let index = 0; index < referenceQueue.length; index += 1) {
		const state = referenceQueue[index];
		for (const [byte, next] of referenceStates[state].edges) {
			let fail = referenceStates[state].fail;
			while (fail && !referenceStates[fail].edges.has(byte))
				fail = referenceStates[fail].fail;
			referenceStates[next].fail = referenceStates[fail].edges.get(byte) ?? 0;
			referenceStates[next].matches.push(
				...referenceStates[referenceStates[next].fail].matches
			);
			referenceQueue.push(next);
		}
	}
	const referenceStarts = new Uint32Array(256);
	for (const [byte, state] of referenceStates[0].edges) referenceStarts[byte] = state;
	const recordReferences = (name, bytes, ownerId) => {
		let state = 0;
		const matches = new Set();
		for (let index = 0; index < bytes.length; index += 1) {
			const byte = bytes[index];
			if (!state) state = referenceStarts[byte];
			else {
				let next = referenceStates[state].edges.get(byte);
				while (next === undefined && state) {
					state = referenceStates[state].fail;
					next = referenceStates[state].edges.get(byte);
				}
				state = next ?? 0;
			}
			if (state) for (const id of referenceStates[state].matches) matches.add(id);
		}
		for (const id of matches) if (id !== ownerId) referencedPathsByPost.get(id).add(name);
	};
	return { referencedPathsByPost, recordReferences };
}

export function describeOutput({
	posts,
	outputHashes,
	outputOwners,
	referencedPathsByPost,
	uniquePathsByPost,
	sha,
	generatorSha256,
	siteSha256,
	context,
	postInputs,
}) {
	const outputPaths = [...outputHashes.keys()].sort();
	const allPostsShared = outputPaths.filter((name) => !outputOwners.has(name));
	const postClaims = Object.fromEntries(
		[...posts]
			.sort((left, right) => String(left.postId).localeCompare(String(right.postId)))
			.map((post) => [
				post.postId,
				{
					uniquePaths: uniquePathsByPost.get(post.postId).sort(),
					referencedPaths: [...referencedPathsByPost.get(post.postId)].sort(),
					sharedGroups: ['allPosts'],
				},
			])
	);
	return {
		format: 'layall-output-manifest',
		version: 2,
		sourceSha: sha,
		generator: {
			format: 'layall-node-static-generator',
			version: 2,
			sha256: generatorSha256,
		},
		coverage: {
			allOutputFilesHashed: true,
			manifestSelfExcluded: true,
			postClaimsComplete: true,
			sharedClaimsConservative: true,
			rendererReverseDependenciesComplete: true,
			rawByteReferencesComplete: true,
		},
		deletionProof: {
			version: 1,
			referenceMatch: 'utf8-substring-post-id-or-route-v1',
			requiresOldAndNewManifests: true,
			requiresChangedAndRemovedPaths: true,
		},
		files: outputPaths.map((name) => ({ path: name, sha256: outputHashes.get(name) })),
		claimGroups: { allPosts: allPostsShared },
		postClaims,
		renderInputs: { version: 1, siteSha256, context, posts: postInputs },
	};
}
