import { createHash } from 'node:crypto';
import { siteCss } from '../render/site-styles.mjs';

export const contentPath = (name, extension, bytes) =>
	`assets/static/${name}-${createHash('sha256').update(bytes).digest('hex')}.${extension}`;

// All resources pass through the same writer as articles, so ledger coverage is
// complete. URLs depend on bytes, never on post IDs or the current post list.
export function emitStaticAssets({ resources, write, href }) {
	const emit = (name, extension, bytes) => {
		const file = contentPath(name, extension, bytes);
		write(file, bytes);
		return file;
	};
	const font = emit('omyu-pretty', 'woff2', resources.font);
	const icon192 = emit('layall-192', 'png', resources.icon192);
	const icon512 = emit('layall-512', 'png', resources.icon512);
	const css = emit('site', 'css', siteCss(resources.styles, href('/' + font)));
	const noScriptCss = emit('no-script', 'css', resources.noScriptStyles);
	const site = emit('site', 'js', resources.site);
	// Emit the protected runtime unconditionally: deleting the last protected post
	// must not change a surviving public article's shared resource identity.
	const protectedClient = emit('protected', 'js', resources.protected);
	const download = emit('download', 'js', resources.download);
	return { font, icon192, icon512, css, noScriptCss, site, protected: protectedClient, download };
}
