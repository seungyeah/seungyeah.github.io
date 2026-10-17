import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { safeSocialImage } from '../render/text.mjs';

export function emitAttachments({ site, posts, inputHashes, write, href, absolute }) {
	// Profile images are shared managed outputs, never attributed to a post's deletion ledger.
	let profileAsset = null;
	if (site.profileImage != null) {
		const id = site.profileImage.assetId;
		if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id))
			throw new Error('invalid profile asset');
		const directory = '.layall/profile';
		const file = `${directory}/${id}.webp`;
		if (
			fs.lstatSync(directory).isSymbolicLink() ||
			fs.lstatSync(file).isSymbolicLink() ||
			!fs.statSync(file).isFile() ||
			fs.statSync(file).size > 3 * 1024 * 1024
		)
			throw new Error('unsafe profile asset');
		const bytes = fs.readFileSync(file);
		if (
			createHash('sha256').update(bytes).digest('hex') !== id ||
			bytes.subarray(0, 4).toString() !== 'RIFF' ||
			bytes.subarray(8, 12).toString() !== 'WEBP'
		)
			throw new Error('profile asset changed');
		inputHashes.set(file, id);
		profileAsset = `assets/profile/${id}.webp`;
		write(profileAsset, bytes);
	}

	const assetClaims = [];
	const imageByPost = new Map();
	const assetsByPost = new Map();
	const coverAssetsByPost = new Map();
	for (const post of posts) {
		const assets = new Map();
		assetsByPost.set(post.postId, assets);
		const coverAssets = [];
		coverAssetsByPost.set(post.postId, coverAssets);
		for (const asset of Array.isArray(post.attachments) ? post.attachments : []) {
			const relative = String(asset.path ?? '').replace(/\\/g, '/');
			const segments = relative.split('/');
			if (
				!relative ||
				path.isAbsolute(relative) ||
				segments.some((segment) => !segment || segment === '..')
			) {
				throw new Error('unsafe asset');
			}
			const sourceRoot = path.resolve(post.sourceDir);
			const source = path.resolve(sourceRoot, relative);
			if (!source.startsWith(`${sourceRoot}${path.sep}`)) throw new Error('unsafe asset');
			if (!fs.existsSync(source) || !fs.statSync(source).isFile()) continue;
			let component = sourceRoot;
			for (const segment of segments) {
				component = path.join(component, segment);
				if (fs.lstatSync(component).isSymbolicLink()) throw new Error('unsafe asset');
			}
			const realSourceRoot = fs.realpathSync(sourceRoot);
			const realSource = fs.realpathSync(source);
			if (!realSource.startsWith(`${realSourceRoot}${path.sep}`))
				throw new Error('unsafe asset');
			let destination = `assets/posts/${post.postId}/${segments.map(encodeURIComponent).join('/')}`;
			const bytes = fs.readFileSync(source);
			// Covers use only copied raster attachments, never SVG, remote URLs or private paths.
			const raster =
				(/\.png$/i.test(relative) &&
					bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) ||
				(/\.jpe?g$/i.test(relative) &&
					bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) ||
				(/\.gif$/i.test(relative) && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString())) ||
				(/\.webp$/i.test(relative) &&
					bytes.subarray(0, 4).toString() === 'RIFF' &&
					bytes.subarray(8, 12).toString() === 'WEBP') ||
				(/\.avif$/i.test(relative) &&
					bytes.length >= 16 &&
					bytes.readUInt32BE(0) >= 16 &&
					bytes.readUInt32BE(0) <= bytes.length &&
					bytes.subarray(4, 8).toString() === 'ftyp' &&
					/^avi[fs]$/.test(bytes.subarray(8, 12).toString()));
			// Only signature-checked raster files retain an executable-origin URL. Everything
			// else is base64 JSON, including HTML/SVG/PDF/media and misleading extensions.
			// Even a direct URL cannot execute uploaded content on the key's origin.
			const published = raster
				? bytes
				: Buffer.from(
						JSON.stringify({
							format: 'layall-download',
							version: 1,
							name: Buffer.from(segments.at(-1)).toString('base64'),
							data: bytes.toString('base64'),
						})
					);
			if (!raster)
				destination = `assets/posts/${post.postId}/downloads/${createHash('sha256').update(relative).digest('hex')}.layall-download.json`;
			write(destination, published, post.postId);
			const assetUrl = raster
				? href(`/${destination}`)
				: href('/download.html') + '#' + encodeURIComponent(destination);
			if (raster) coverAssets.push({ id: String(asset.id ?? ''), url: assetUrl });
			assetClaims.push({
				postId: post.postId,
				path: destination,
				sha256: createHash('sha256').update(published).digest('hex'),
			});
			if (asset.id)
				assets.set(String(asset.id), {
					url: assetUrl,
					publicUrl: raster ? safeSocialImage(absolute(`/${destination}`)) : '',
					image: raster,
				});
			if (raster && !imageByPost.has(post.postId)) imageByPost.set(post.postId, assetUrl);
		}
	}
	return { profileAsset, assetClaims, imageByPost, assetsByPost, coverAssetsByPost };
}
