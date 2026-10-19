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
	const tmoneyFont = emit('tmoney-round-wind', 'woff2', resources.tmoneyFont ?? resources.font);
	const icon192 = emit('layall-192', 'png', resources.icon192);
	const icon512 = emit('layall-512', 'png', resources.icon512);
	const css = emit('site', 'css', siteCss(resources.styles, href('/' + tmoneyFont)));
	const noScriptCss = emit('no-script', 'css', resources.noScriptStyles);
	const site = emit('site', 'js', resources.site);
	// Emit the protected runtime unconditionally: deleting the last protected post
	// must not change a surviving public article's shared resource identity.
	const protectedClient = emit('protected', 'js', resources.protected);
	const diagram = emit('diagram', 'js', resources.diagram);
	const diagramRoot = `assets/static/mermaid-${createHash('sha256').update(resources.diagramGraph).digest('hex')}`;
	write(diagramRoot + '/graph.json', resources.diagramGraph);
	for (const [name, bytes] of resources.diagramModules) write(diagramRoot + '/' + name, bytes);
	write(diagramRoot + '/license.json', resources.diagramLicense);
	const download = emit('download', 'js', resources.download);
	return {
		tmoneyFont,
		icon192,
		icon512,
		css,
		noScriptCss,
		site,
		protected: protectedClient,
		download,
		diagram,
		diagramGraph: diagramRoot + '/graph.json',
	};
}
