import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
const sha = process.argv[3];
if (!out || !sha) throw new Error('usage: node build.mjs <outputDir> <sourceSha>');
if (fs.existsSync(out)) throw new Error('output must be fresh');
fs.mkdirSync(out, { recursive: true });

const readJson = (file, fallback) =>
	fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
if (fs.existsSync('.layall') && fs.lstatSync('.layall').isSymbolicLink())
	throw new Error('unsafe managed source');
if (fs.existsSync('.layall/site.json') && fs.lstatSync('.layall/site.json').isSymbolicLink())
	throw new Error('unsafe managed source');
const site = readJson('.layall/site.json', {});
const [owner = '', repo = ''] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const projectPath =
	repo && repo.toLowerCase() !== `${owner}.github.io`.toLowerCase() ? `/${repo}` : '';
const configuredBase = String(site.baseUrl ?? '').trim();
let basePath = projectPath;
let configuredPublicBase = '';
try {
	if (configuredBase) {
		const configuredUrl = new URL(configuredBase);
		if (configuredUrl.protocol === 'https:' || configuredUrl.protocol === 'http:') {
			basePath = configuredUrl.pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '');
			configuredPublicBase = `${configuredUrl.origin}${basePath}`;
		}
	}
} catch {}
const fallbackBase = owner ? `https://${owner}.github.io${projectPath}` : '';
const publicBase = configuredPublicBase || fallbackBase;
const href = (value) => `${basePath}${value}` || '/';
const absolute = (value) => (publicBase ? `${publicBase}${value}` : href(value));
const esc = (value) =>
	String(value ?? '').replace(
		/[&<>\"]/g,
		(character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[character]
	);
const js = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
const safeExternal = (value) => {
	try {
		const url = new URL(String(value ?? ''));
		return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
	} catch {
		return null;
	}
};
const safeContentHref = (value) => {
	const raw = String(value ?? '').trim();
	if (!raw || raw.startsWith('//') || raw.includes('\\')) return null;
	if (raw.startsWith('#')) return raw.replace(/[^#a-zA-Z0-9_-]/g, '');
	if (raw.startsWith('/')) return href(raw.replace(/\s/g, '%20'));
	if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return safeExternal(raw);
	return raw.replace(/\s/g, '%20');
};
const plainText = (value) =>
	String(value ?? '')
		.replace(/```[\s\S]*?```/g, ' ')
		.replace(/!?(\[([^\]]*)\])\([^)]*\)/g, '$2')
		.replace(/[#>*_`~-]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
const excerpt = (value, limit = 180) => {
	const text = plainText(value);
	return text.length > limit ? `${text.slice(0, limit).trimEnd()}…` : text;
};
const slugify = (value) => {
	const slug = String(value ?? '')
		.normalize('NFKD')
		.toLowerCase()
		.replace(/[^\p{Letter}\p{Number}]+/gu, '-')
		.replace(/^-|-$/g, '');
	return slug || 'section';
};
const tagSegment = (value) => `t-${Buffer.from(String(value), 'utf8').toString('hex')}`;
const formatDate = (value) => {
	if (value === undefined || value === null || value === '') return '';
	const date = new Date(value ?? 0);
	if (Number.isNaN(date.getTime())) return '';
	try {
		return new Intl.DateTimeFormat(site.locale || 'ko-KR', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
		}).format(date);
	} catch {
		return date.toISOString().slice(0, 10);
	}
};

const folders = new Map();
const folderRoot = 'content/folders';
if (fs.existsSync('content') && fs.lstatSync('content').isSymbolicLink())
	throw new Error('unsafe managed source');
if (fs.existsSync(folderRoot)) {
	if (fs.lstatSync(folderRoot).isSymbolicLink()) throw new Error('unsafe managed source');
	for (const name of fs.readdirSync(folderRoot).sort()) {
		if (!name.endsWith('.json')) continue;
		const folderPath = path.join(folderRoot, name);
		if (fs.lstatSync(folderPath).isSymbolicLink()) throw new Error('unsafe managed source');
		const folder = readJson(folderPath, {});
		if (folder.format === 'layall-folder' && folder.folderId) {
			const folderId = String(folder.folderId);
			if (!/^[a-zA-Z0-9_-]{1,128}$/.test(folderId)) throw new Error('invalid folder id');
			folders.set(folderId, folder);
		}
	}
}

const posts = [];
const postRoot = 'content/posts';
if (fs.existsSync(postRoot)) {
	if (fs.lstatSync(postRoot).isSymbolicLink()) throw new Error('unsafe managed source');
	const realPostRoot = fs.realpathSync(postRoot);
	for (const id of fs.readdirSync(postRoot).sort()) {
		const sourceDir = path.join(postRoot, id);
		if (fs.lstatSync(sourceDir).isSymbolicLink()) throw new Error('unsafe managed source');
		if (!fs.realpathSync(sourceDir).startsWith(`${realPostRoot}${path.sep}`))
			throw new Error('unsafe managed source');
		const file = path.join(sourceDir, 'post.layallnote');
		if (!fs.existsSync(file)) continue;
		if (fs.lstatSync(file).isSymbolicLink()) throw new Error('unsafe managed source');
		const post = readJson(file, {});
		if (post.format !== 'layall-note' || post.postId !== id)
			throw new Error('invalid managed source');
		if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(String(post.permalink ?? ''))) {
			throw new Error('invalid permalink');
		}
		Object.defineProperty(post, 'sourceDir', { value: sourceDir });
		posts.push(post);
	}
}
posts.sort((a, b) => {
	const byDate =
		new Date(b.sourceUpdatedAt ?? 0).getTime() - new Date(a.sourceUpdatedAt ?? 0).getTime();
	return (
		byDate || String(a.title ?? '').localeCompare(String(b.title ?? ''), site.locale || 'ko-KR')
	);
});

const generated = [];
const generatedSet = new Set();
const write = (name, data) => {
	const outputRoot = path.resolve(out);
	const file = path.resolve(outputRoot, name);
	if (!file.startsWith(`${outputRoot}${path.sep}`)) throw new Error('unsafe output path');
	if (generatedSet.has(name)) throw new Error('duplicate output path');
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, data);
	generated.push(name);
	generatedSet.add(name);
};

const assetClaims = [];
const imageByPost = new Map();
for (const post of posts) {
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
		if (!realSource.startsWith(`${realSourceRoot}${path.sep}`)) throw new Error('unsafe asset');
		const destination = `assets/posts/${post.postId}/${segments.map(encodeURIComponent).join('/')}`;
		write(destination, fs.readFileSync(source));
		assetClaims.push({ postId: post.postId, path: destination, sha256: asset.sha256 });
		const looksLikeImage =
			String(asset.mimeType ?? asset.contentType ?? '').startsWith('image/') ||
			/\.(avif|gif|jpe?g|png|webp)$/i.test(relative);
		if (looksLikeImage && !imageByPost.has(post.postId))
			imageByPost.set(post.postId, href(`/${destination}`));
	}
}

const inlineMarkdown = (source) => {
	const placeholders = [];
	let value = esc(source).replace(/`([^`]+)`/g, (_, code) => {
		const token = `\u0000${placeholders.length}\u0000`;
		placeholders.push(`<code>${code}</code>`);
		return token;
	});
	value = value.replace(
		/\[([^\]]+)\]\(([^)\s]+)(?:\s+[\"'][^\"']*[\"'])?\)/g,
		(_, label, target) => {
			const safe = safeContentHref(target.replace(/&amp;/g, '&'));
			if (!safe) return label;
			const token = `\u0000${placeholders.length}\u0000`;
			placeholders.push(`<a href="${esc(safe)}">${label}</a>`);
			return token;
		}
	);
	value = value
		.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
		.replace(/__([^_]+)__/g, '<strong>$1</strong>')
		.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
		.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
	return value.replace(/\u0000(\d+)\u0000/g, (_, index) => placeholders[Number(index)]);
};

const renderMarkdown = (source) => {
	const lines = String(source ?? '')
		.replace(/\r\n?/g, '\n')
		.split('\n');
	const html = [];
	const headings = [];
	const usedIds = new Set();
	let paragraph = [];
	let list = null;
	let fence = null;
	let quote = [];
	const flushParagraph = () => {
		if (!paragraph.length) return;
		html.push(`<p>${inlineMarkdown(paragraph.join(' '))}</p>`);
		paragraph = [];
	};
	const flushList = () => {
		if (!list) return;
		html.push(
			`<${list.type}>${list.items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join('')}</${list.type}>`
		);
		list = null;
	};
	const flushQuote = () => {
		if (!quote.length) return;
		html.push(`<blockquote><p>${inlineMarkdown(quote.join(' '))}</p></blockquote>`);
		quote = [];
	};
	const flushAll = () => {
		flushParagraph();
		flushList();
		flushQuote();
	};
	for (const line of lines) {
		if (fence) {
			if (/^\s*```/.test(line)) {
				html.push(
					`<pre><code${fence.language ? ` data-language="${esc(fence.language)}"` : ''}>${esc(fence.lines.join('\n'))}</code></pre>`
				);
				fence = null;
			} else fence.lines.push(line);
			continue;
		}
		const fenceMatch = line.match(/^\s*```([^\s`]*)/);
		if (fenceMatch) {
			flushAll();
			fence = { language: fenceMatch[1], lines: [] };
			continue;
		}
		const heading = line.match(/^(#{1,6})\s+(.+)$/);
		if (heading) {
			flushAll();
			const level = heading[1].length;
			const label = plainText(heading[2]);
			const base = `heading-${slugify(label)}`;
			let id = base;
			let suffix = 2;
			while (usedIds.has(id)) id = `${base}-${suffix++}`;
			usedIds.add(id);
			headings.push({ level, label, id });
			html.push(
				`<h${level} id="${esc(id)}">${inlineMarkdown(heading[2])}<a class="heading-anchor" href="#${esc(id)}" aria-label="${esc(label)} 바로가기">#</a></h${level}>`
			);
			continue;
		}
		const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
		const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
		if (unordered || ordered) {
			flushParagraph();
			flushQuote();
			const type = ordered ? 'ol' : 'ul';
			if (list?.type !== type) flushList();
			list ??= { type, items: [] };
			list.items.push((ordered || unordered)[1]);
			continue;
		}
		const quoted = line.match(/^>\s?(.*)$/);
		if (quoted) {
			flushParagraph();
			flushList();
			quote.push(quoted[1]);
			continue;
		}
		if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
			flushAll();
			html.push('<hr>');
			continue;
		}
		if (!line.trim()) {
			flushAll();
			continue;
		}
		flushList();
		flushQuote();
		paragraph.push(line.trim());
	}
	if (fence)
		html.push(
			`<pre><code${fence.language ? ` data-language="${esc(fence.language)}"` : ''}>${esc(fence.lines.join('\n'))}</code></pre>`
		);
	flushAll();
	return { html: html.join('\n'), headings };
};

const themeOrder = ['layall', 'blog', 'minimal', 'portfolio', 'docs'];
const themeNames = new Set(themeOrder);
const theme = themeNames.has(site.theme) ? site.theme : 'layall';
const layoutStorageKey = `layall-layout-theme:${publicBase || basePath || '/'}`;
const siteTitle = String(site.title || 'LayAll Blog');
const siteDescription = String(site.description || '');
const author = String(site.profileName || site.authorName || '');
const authorBio = String(site.profileBio || '');
const profileUrl = safeExternal(site.profileUrl);
const externalLinks = (Array.isArray(site.externalLinks) ? site.externalLinks : [])
	.filter((link) => link && typeof link === 'object')
	.map((link) => ({ label: String(link.label ?? '').trim(), url: safeExternal(link.url) }))
	.filter((link) => link.label && link.url);
const postUrl = (post) => href(`/posts/${encodeURIComponent(post.permalink)}/`);
const folderName = (id) => String(folders.get(String(id))?.name ?? id ?? 'Unfiled');
const metadata = (post) => {
	const parts = [formatDate(post.sourceUpdatedAt)];
	if (post.folderId) parts.push(folderName(post.folderId));
	return parts.filter(Boolean).join(' · ');
};
const tagsFor = (post) =>
	(Array.isArray(post.tags) ? post.tags : [])
		.map((rawTag) => {
			const tag = String(rawTag);
			return `<a class="tag" href="${href(`/tags/${tagSegment(tag)}/`)}">#${esc(tag)}</a>`;
		})
		.join(' ');
const picture = (post, className = 'post-cover') => {
	const source = imageByPost.get(post.postId);
	return source ? `<img class="${className}" src="${esc(source)}" alt="" loading="lazy">` : '';
};

const folderTree = (activePost = null, includePosts = false) => {
	const children = new Map();
	for (const [id, folder] of folders) {
		const parent =
			folder.parentFolderId && folders.has(String(folder.parentFolderId))
				? String(folder.parentFolderId)
				: '';
		const entries = children.get(parent) ?? [];
		entries.push({ id, folder });
		children.set(parent, entries);
	}
	for (const entries of children.values())
		entries.sort((a, b) =>
			String(a.folder.name).localeCompare(String(b.folder.name), site.locale || 'ko-KR')
		);
	const rendered = new Set();
	const branch = (parent = '', seen = new Set()) => {
		const entries = children.get(parent) ?? [];
		if (!entries.length) return '';
		return `<ul>${entries
			.map(({ id, folder }) => {
				if (seen.has(id)) return '';
				rendered.add(id);
				const next = new Set(seen).add(id);
				const items = includePosts
					? posts.filter((post) => String(post.folderId ?? '') === id)
					: [];
				const postLinks = items.length
					? `<ul>${items.map((post) => `<li><a${activePost?.postId === post.postId ? ' aria-current="page"' : ''} href="${postUrl(post)}">${esc(post.title || 'Untitled')}</a></li>`).join('')}</ul>`
					: '';
				const label = includePosts
					? `<span>${esc(folder.name)}</span>`
					: `<a href="${href(`/folders/${encodeURIComponent(id)}/`)}">${esc(folder.name)}</a>`;
				return `<li>${label}${postLinks}${branch(id, next)}</li>`;
			})
			.join('')}</ul>`;
	};
	let result = branch();
	for (const id of folders.keys()) {
		if (!rendered.has(id)) result += branch(id, new Set());
	}
	return result;
};

const topLinks = () => {
	const primary = [
		`<a href="${href('/')}">Home</a>`,
		`<a data-docs-link href="${href('/docs/')}">Docs</a>`,
		`<a href="${href('/search/')}">Search</a>`,
	];
	return [
		...primary,
		...externalLinks.map(
			(link) => `<a href="${esc(link.url)}" rel="me noopener">${esc(link.label)}</a>`
		),
	]
		.filter(Boolean)
		.join('');
};
const profileMarkup = () => {
	if (!author && !authorBio) return '';
	const name = profileUrl
		? `<a href="${esc(profileUrl)}" rel="me noopener">${esc(author)}</a>`
		: esc(author);
	return `<div class="profile"><p class="eyebrow">Author</p><h2>${name}</h2>${authorBio ? `<p>${esc(authorBio)}</p>` : ''}</div>`;
};
const docsNavigation = (activePost) => {
	const unfiled = posts.filter((post) => !post.folderId || !folders.has(String(post.folderId)));
	return `<nav class="docs-nav" aria-label="문서 목차"><a class="docs-overview" href="${href('/docs/')}">전체 가이드</a>${folderTree(activePost, true)}${unfiled.length ? `<section><h3>Articles</h3><ul>${unfiled.map((post) => `<li><a${activePost?.postId === post.postId ? ' aria-current="page"' : ''} href="${postUrl(post)}">${esc(post.title || 'Untitled')}</a></li>`).join('')}</ul></section>` : ''}</nav>`;
};

const styles = `
:root{--paper:#f7f3ea;--surface:#fffdf8;--surface-2:#eee7da;--ink:#292723;--muted:#716d65;--line:#ded6c7;--accent:#716690;--accent-soft:#e8e1f3;--shadow:0 18px 60px rgba(65,55,43,.09);--radius:22px;--content:1180px;color-scheme:light}
html[data-theme][data-color-mode=dark]{--paper:#1d1c1a;--surface:#272521;--surface-2:#33302a;--ink:#f2eee6;--muted:#bbb3a7;--line:#454139;--accent:#c8b9ec;--accent-soft:#3b344b;--shadow:0 18px 60px rgba(0,0,0,.28);color-scheme:dark}
@media(prefers-color-scheme:dark){html[data-theme][data-color-mode=system]{--paper:#1d1c1a;--surface:#272521;--surface-2:#33302a;--ink:#f2eee6;--muted:#bbb3a7;--line:#454139;--accent:#c8b9ec;--accent-soft:#3b344b;--shadow:0 18px 60px rgba(0,0,0,.28);color-scheme:dark}}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.7 ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}a{color:inherit;text-decoration-color:color-mix(in srgb,var(--accent) 52%,transparent);text-underline-offset:.2em}a:hover{color:var(--accent)}img{display:block;max-width:100%}button,input{font:inherit}.skip-link{position:fixed;z-index:100;top:.75rem;left:.75rem;transform:translateY(-180%);padding:.65rem 1rem;border-radius:999px;background:var(--ink);color:var(--paper)}.skip-link:focus{transform:none}.site-header{position:sticky;z-index:30;top:0;border-bottom:1px solid color-mix(in srgb,var(--line) 76%,transparent);background:color-mix(in srgb,var(--paper) 88%,transparent);backdrop-filter:blur(18px)}.header-inner{width:min(calc(100% - 2rem),var(--content));min-height:68px;margin:auto;display:flex;align-items:center;gap:1rem}.brand{font-weight:800;letter-spacing:-.03em;text-decoration:none}.nav-toggle{display:none;margin-left:auto;border:1px solid var(--line);border-radius:999px;background:var(--surface);padding:.42rem .8rem;color:var(--ink)}.site-nav{margin-left:auto;display:flex;align-items:center;gap:1.1rem}.site-nav a{text-decoration:none;font-size:.9rem;font-weight:650}.color-controls{display:flex;border:1px solid var(--line);border-radius:999px;padding:3px}.color-controls button{width:28px;height:28px;border:0;border-radius:50%;background:transparent;color:var(--muted);cursor:pointer}.color-controls button:hover,.color-controls button[aria-pressed=true]{background:var(--accent-soft);color:var(--accent)}main{width:min(calc(100% - 2rem),var(--content));margin:auto}.site-footer{width:min(calc(100% - 2rem),var(--content));margin:5rem auto 0;padding:2rem 0 3rem;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:1rem;color:var(--muted);font-size:.9rem}.eyebrow{text-transform:uppercase;letter-spacing:.14em;font-size:.72rem;font-weight:800;color:var(--accent)}.lead{font-size:clamp(1.05rem,2vw,1.28rem);color:var(--muted)}.muted,.post-meta{color:var(--muted);font-size:.88rem}.tag{display:inline-block;margin:.25rem .25rem 0 0;font-size:.8rem;text-decoration:none;color:var(--muted)}.empty{margin:4rem 0;padding:3rem;border:1px dashed var(--line);border-radius:var(--radius);text-align:center;color:var(--muted)}.post-cover{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:calc(var(--radius) - 5px);background:var(--surface-2)}.page-heading{margin:4.5rem 0 2.5rem}.page-heading h1{margin:.2rem 0;font:700 clamp(2.2rem,6vw,4.8rem)/1.02 ui-serif,Georgia,serif;letter-spacing:-.055em}.page-heading p{max-width:48rem}.post-list{list-style:none;margin:0;padding:0}.post-list li{border-top:1px solid var(--line)}.post-list a{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:1rem;padding:1.2rem 0;text-decoration:none}.post-list strong{font-size:1.08rem}.post-list span{color:var(--muted);font-size:.85rem}.pagination{display:flex;gap:.4rem;margin:2.5rem 0}.pagination a{display:grid;place-items:center;width:38px;height:38px;border:1px solid var(--line);border-radius:50%;text-decoration:none}.pagination a[aria-current=page]{background:var(--ink);color:var(--paper);border-color:var(--ink)}
.article-shell{display:grid;grid-template-columns:minmax(0,760px) minmax(180px,1fr);gap:4rem;align-items:start;padding-top:4rem}.article{min-width:0}.article-header{margin-bottom:2.5rem}.article-header h1{margin:.4rem 0 1rem;font:700 clamp(2.3rem,6vw,4.8rem)/1.03 ui-serif,Georgia,serif;letter-spacing:-.05em}.article-body{font-size:1.05rem}.article-body p{margin:1.25rem 0}.article-body h2,.article-body h3,.article-body h4{scroll-margin-top:6rem;margin:2.5rem 0 .75rem;line-height:1.25;letter-spacing:-.025em}.article-body h2{font-size:1.8rem}.article-body h3{font-size:1.35rem}.heading-anchor{margin-left:.45rem;text-decoration:none;opacity:0}.article-body :is(h2,h3,h4):hover .heading-anchor,.heading-anchor:focus{opacity:1}.article-body pre{overflow:auto;margin:1.5rem 0;padding:1.2rem;border:1px solid var(--line);border-radius:15px;background:#171816;color:#f4f1ea;font:14px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace}.article-body code{padding:.13em .36em;border-radius:6px;background:var(--surface-2);font:85% ui-monospace,SFMono-Regular,Menlo,monospace}.article-body pre code{padding:0;background:transparent;font:inherit}.article-body blockquote{margin:1.5rem 0;padding:.2rem 1.25rem;border-left:3px solid var(--accent);color:var(--muted)}.article-body hr{border:0;border-top:1px solid var(--line);margin:2.4rem 0}.article-body a{overflow-wrap:anywhere}.article-aside{position:sticky;top:100px}.article-aside h2{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.article-aside ol{padding-left:1.1rem}.article-aside a{display:block;padding:.25rem 0;font-size:.86rem;text-decoration:none;color:var(--muted)}
html[data-theme=blog]{--paper:#fffaf2;--surface:#fff;--surface-2:#f5e9db;--ink:#342923;--muted:#7b6b61;--line:#eadbcb;--accent:#a24f37;--accent-soft:#f4dfd4}.blog-home{padding-top:3.6rem}.blog-title{display:grid;grid-template-columns:1fr minmax(240px,.55fr);gap:2rem;align-items:end;margin-bottom:2rem}.blog-title h1{max-width:800px;margin:0;font:750 clamp(3rem,8vw,7.4rem)/.88 ui-serif,Georgia,serif;letter-spacing:-.07em}.blog-lead{display:grid;grid-template-columns:minmax(0,1.5fr) minmax(260px,.8fr);gap:1.8rem;padding:1rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}.blog-lead-content{display:flex;flex-direction:column;justify-content:flex-end;padding:clamp(1rem,3vw,2.2rem)}.blog-lead h2{margin:.4rem 0;font:700 clamp(2rem,4vw,3.7rem)/1.04 ui-serif,Georgia,serif;letter-spacing:-.045em}.blog-lead a{text-decoration:none}.blog-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:1.2rem;margin:1.2rem 0 4rem}.blog-card{padding:1rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.blog-card h2{font:700 1.65rem/1.15 ui-serif,Georgia,serif}.blog-card a{text-decoration:none}.blog-archive{display:grid;grid-template-columns:minmax(0,1fr) 280px;gap:4rem}.blog-sidebar{position:sticky;top:100px}.blog-sidebar ul{list-style:none;padding:0}.blog-sidebar li{border-top:1px solid var(--line)}.blog-sidebar a{display:flex;justify-content:space-between;padding:.65rem 0;text-decoration:none}
html[data-theme=minimal]{--paper:#fff;--surface:#fff;--surface-2:#f5f5f3;--ink:#20201e;--muted:#74746e;--line:#e5e5e0;--accent:#20201e;--accent-soft:#efefeb;--content:760px}.minimal-home{padding-top:6rem}.minimal-masthead{padding-bottom:3.5rem;border-bottom:1px solid var(--line)}.minimal-masthead h1{margin:.3rem 0;font:650 clamp(2.5rem,8vw,5.6rem)/1 ui-serif,Georgia,serif;letter-spacing:-.055em}.minimal-profile{display:grid;grid-template-columns:1fr 1fr;gap:2rem;margin-top:2rem}.minimal-list{list-style:none;padding:0}.minimal-list li{border-bottom:1px solid var(--line)}.minimal-list a{display:block;padding:1.45rem 0;text-decoration:none}.minimal-list h2{margin:0 0 .35rem;font:600 clamp(1.25rem,3vw,1.65rem)/1.3 ui-serif,Georgia,serif}.minimal-list p{margin:.45rem 0;color:var(--muted)}
html[data-theme=portfolio]{--paper:#f0efe9;--surface:#fbfaf6;--surface-2:#e4e1d8;--ink:#242522;--muted:#6d7068;--line:#d7d4ca;--accent:#556846;--accent-soft:#dce6d3;--radius:32px}.portfolio-home{padding-top:2rem}.portfolio-hero{min-height:62vh;display:grid;align-content:center;grid-template-columns:1.2fr .8fr;gap:3rem;padding:clamp(2rem,6vw,5rem);border-radius:42px;background:var(--surface);box-shadow:var(--shadow)}.portfolio-hero h1{margin:.2rem 0;font:750 clamp(3.2rem,9vw,8rem)/.86 ui-serif,Georgia,serif;letter-spacing:-.075em}.portfolio-hero .profile{align-self:end;padding:1.4rem;border-radius:25px;background:var(--accent-soft)}.showcase{padding:5rem 0}.showcase-header{display:flex;justify-content:space-between;align-items:end;margin-bottom:1.5rem}.showcase-header h2{margin:0;font:700 clamp(2rem,5vw,4rem)/1 ui-serif,Georgia,serif}.showcase-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:1.2rem}.showcase-card{grid-column:span 6;min-height:300px;display:flex;flex-direction:column;padding:1rem;border:1px solid var(--line);border-radius:var(--radius);background:var(--surface);text-decoration:none}.showcase-card:nth-child(3n+1){grid-column:span 7}.showcase-card:nth-child(3n+2){grid-column:span 5}.showcase-card .post-cover{aspect-ratio:16/8}.showcase-card-content{margin-top:auto;padding:1.2rem}.showcase-card h3{margin:.3rem 0;font:650 clamp(1.45rem,3vw,2.2rem)/1.12 ui-serif,Georgia,serif}.floating-nav{position:fixed;z-index:25;bottom:1.25rem;left:50%;transform:translateX(-50%);display:flex;gap:.25rem;padding:.4rem;border:1px solid var(--line);border-radius:999px;background:color-mix(in srgb,var(--surface) 90%,transparent);box-shadow:var(--shadow);backdrop-filter:blur(16px)}.floating-nav a{padding:.55rem .95rem;border-radius:999px;text-decoration:none;font-size:.86rem}.floating-nav a:hover{background:var(--accent-soft)}html[data-theme=portfolio] .site-footer{padding-bottom:6rem}
html[data-theme=docs]{--paper:#fbfcfd;--surface:#fff;--surface-2:#f1f4f7;--ink:#1f2933;--muted:#68727e;--line:#e1e7ec;--accent:#3973a8;--accent-soft:#e5f1fb;--content:1380px}.docs-home{padding:2.5rem 0}.docs-intro{min-height:56vh;display:grid;align-content:center;justify-items:center;text-align:center;padding:5rem 1rem}.docs-intro h1{max-width:950px;margin:.35rem 0;font:750 clamp(3rem,8vw,7rem)/.92 ui-serif,Georgia,serif;letter-spacing:-.065em}.docs-intro p{max-width:680px}.primary-link{display:inline-flex;margin-top:1.3rem;padding:.75rem 1.1rem;border-radius:12px;background:var(--ink);color:var(--paper);text-decoration:none;font-weight:750}.guide-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}.guide-card{display:block;min-height:180px;padding:1.5rem;border:1px solid var(--line);border-radius:18px;background:var(--surface);text-decoration:none}.guide-card h2{margin:.2rem 0 .7rem}.docs-layout{width:min(calc(100% - 2rem),var(--content));margin:auto;display:grid;grid-template-columns:240px minmax(0,760px) minmax(180px,1fr);gap:3rem;align-items:start}.docs-sidebar-wrap{position:sticky;top:92px}.docs-sidebar{max-height:calc(100vh - 110px);overflow:auto;padding:1rem 0}.docs-nav ul{list-style:none;padding:0;margin:.25rem 0 1rem}.docs-nav h3,.docs-nav span{display:block;margin:1.2rem 0 .3rem;font-size:.72rem;font-weight:750;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.docs-nav a{display:block;padding:.32rem .6rem;border-radius:7px;text-decoration:none;font-size:.88rem;color:var(--muted)}.docs-nav a:hover,.docs-nav a[aria-current=page]{background:var(--accent-soft);color:var(--accent)}.docs-overview{font-weight:750;color:var(--ink)!important}.docs-content{min-width:0;padding-top:3.7rem}.docs-content .article-header h1{font-family:ui-sans-serif,system-ui,sans-serif;font-size:clamp(2.3rem,5vw,4.2rem)}.docs-toc{position:sticky;top:100px;padding-top:3.7rem}.docs-toc h2{font-size:.75rem;text-transform:uppercase;letter-spacing:.12em;color:var(--muted)}.docs-toc ol{list-style:none;padding:0}.docs-toc a{display:block;padding:.3rem 0;text-decoration:none;font-size:.82rem;color:var(--muted)}.docs-index{padding:4rem 0}.docs-index h1{font-size:clamp(2.5rem,6vw,5rem);letter-spacing:-.055em}.docs-section{margin:3rem 0}.docs-section-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.8rem}.docs-section-list a{padding:1rem;border:1px solid var(--line);border-radius:12px;background:var(--surface);text-decoration:none}
.search-shell{padding:4rem 0}.search-shell h1{font:700 clamp(2.5rem,6vw,5rem)/1 ui-serif,Georgia,serif}.search-form{display:flex;gap:.6rem;max-width:700px}.search-form input{min-width:0;flex:1;padding:.8rem 1rem;border:1px solid var(--line);border-radius:999px;background:var(--surface);color:var(--ink)}.search-form button{border:0;border-radius:999px;padding:.8rem 1.1rem;background:var(--ink);color:var(--paper);cursor:pointer}.search-results{margin-top:2rem}
@media(max-width:900px){.article-shell,.blog-archive,.docs-layout{grid-template-columns:1fr}.article-aside,.blog-sidebar,.docs-toc,.docs-sidebar-wrap{position:static}.docs-sidebar{display:none;max-height:none}.docs-sidebar-wrap>.nav-toggle{display:block}.docs-sidebar[data-open=true]{display:block}.blog-title,.blog-lead,.portfolio-hero{grid-template-columns:1fr}.guide-grid{grid-template-columns:1fr 1fr}.showcase-card,.showcase-card:nth-child(n){grid-column:span 12}.portfolio-hero{min-height:auto;margin-top:1rem}.blog-lead .post-cover{order:-1}}
@media(max-width:680px){body{font-size:15px}.header-inner{min-height:60px}.nav-toggle{display:block}.site-nav{position:absolute;top:calc(100% + 1px);left:1rem;right:1rem;display:none;flex-direction:column;align-items:stretch;padding:1rem;border:1px solid var(--line);border-radius:16px;background:var(--surface);box-shadow:var(--shadow)}.site-nav[data-open=true]{display:flex}.color-controls{align-self:flex-start}.blog-home{padding-top:2.2rem}.blog-title{display:block}.blog-grid,.guide-grid,.minimal-profile{grid-template-columns:1fr}.article-shell{padding-top:2.5rem}.site-footer{flex-direction:column}.portfolio-hero{padding:2rem 1.4rem;border-radius:28px}.floating-nav{max-width:calc(100% - 1rem);overflow:auto}.docs-intro{min-height:auto;padding:5rem .5rem}.docs-section-list{grid-template-columns:1fr}}
select{font:inherit}[data-docs-link]{display:none}html[data-theme=docs] [data-docs-link]{display:inline}.appearance-controls{display:flex;align-items:center;gap:.45rem}.theme-control{display:flex;align-items:center;gap:.35rem;color:var(--muted);font-size:.78rem}.theme-control select{max-width:8.5rem;border:1px solid var(--line);border-radius:999px;padding:.38rem 1.8rem .38rem .7rem;background:var(--surface);color:var(--ink);cursor:pointer}.floating-nav{display:none}html[data-theme=portfolio] .floating-nav{display:flex}.theme-article-minimal{display:block;max-width:760px}.theme-article-blog .article{padding:clamp(1.2rem,4vw,3.5rem);border:1px solid var(--line);border-radius:var(--radius);background:var(--surface)}.theme-article-portfolio{grid-template-columns:220px minmax(0,820px)}.theme-article-portfolio .article{order:2;padding:clamp(1.2rem,4vw,3rem);border-radius:var(--radius);background:var(--surface);box-shadow:var(--shadow)}.theme-article-portfolio .article-aside{order:1}@media(max-width:900px){.appearance-controls{flex-wrap:wrap}.theme-article-portfolio{grid-template-columns:1fr}.theme-article-portfolio .article,.theme-article-portfolio .article-aside{order:initial}}@media(max-width:680px){.appearance-controls{align-items:flex-start;flex-direction:column}.theme-control select{min-height:36px}.color-controls{align-self:auto}}
`;

const behavior = `<script>(()=>{
const root=document.documentElement;
const colorModes=new Set(['light','dark','system']);
const layoutThemes=new Set(${js(themeOrder)});
const authorTheme=${js(theme)};
const layoutKey=${js(layoutStorageKey)};
const mount=document.querySelector('[data-theme-view]');
const pool=document.querySelector('[data-theme-pool]');
let pageGeneration=0;
const boundDocsToggles=new WeakSet();
const readStored=(key)=>{try{return localStorage.getItem(key)||''}catch{return ''}};
const writeStored=(key,value)=>{try{localStorage.setItem(key,value)}catch{}};
const syncColor=()=>document.querySelectorAll('[data-color]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.color===root.dataset.colorMode)));
const syncLayout=()=>document.querySelectorAll('[data-layout-theme]').forEach(select=>select.value=root.dataset.theme);
const bindDocs=()=>{const toggle=document.querySelector('[data-docs-toggle]');const docs=document.querySelector('[data-docs-sidebar]');if(!toggle||!docs||boundDocsToggles.has(toggle))return;boundDocsToggles.add(toggle);toggle.addEventListener('click',()=>{const open=docs.dataset.open!=='true';docs.dataset.open=String(open);toggle.setAttribute('aria-expanded',String(open))})};
const bindSearch=(preservedQuery='')=>{
 const generation=++pageGeneration;
 const form=document.querySelector('[data-search-form]');const input=document.querySelector('[data-search-input]');const results=document.querySelector('[data-search-results]');const status=document.querySelector('[data-search-status]');
 if(!form||!input||!results||!status)return;
 const run=async(syncUrl=false)=>{const query=input.value.trim().toLocaleLowerCase();const entries=await fetch(${js(href('/search.json'))}).then(response=>response.json());if(generation!==pageGeneration||input.isConnected===false)return;const found=query?entries.filter(entry=>[entry.title,entry.body,entry.folder,...entry.tags].join(' ').toLocaleLowerCase().includes(query)):entries;results.replaceChildren(...found.map(entry=>{const li=document.createElement('li');const a=document.createElement('a');const strong=document.createElement('strong');const span=document.createElement('span');const target=${js(`${basePath}/posts/`)}+encodeURIComponent(entry.permalink)+'/';a.href=target;a.setAttribute('href',target);strong.textContent=entry.title;span.textContent=[entry.folder,...entry.tags.map(tag=>'#'+tag)].filter(Boolean).join(' · ');a.append(strong,span);li.append(a);return li}));status.textContent=found.length+'개 결과';if(syncUrl){const url=new URL(location.href);query?url.searchParams.set('q',input.value.trim()):url.searchParams.delete('q');history.replaceState(null,'',url)}};
 form.addEventListener('submit',event=>{event.preventDefault();run(true).catch(()=>status.textContent='검색 색인을 불러오지 못했습니다.')});
 input.value=preservedQuery||new URL(location.href).searchParams.get('q')||'';
 run().catch(()=>status.textContent='검색 색인을 불러오지 못했습니다.');
};
const bindPage=(query='')=>{bindDocs();bindSearch(query)};
const activate=(next)=>{if(!layoutThemes.has(next)||!mount)return;const template=document.querySelector('template[data-theme-layout="'+next+'"]');if(!template)return;const query=document.querySelector('[data-search-input]')?.value||'';pageGeneration+=1;const fragment=template.content.cloneNode(true);fragment.querySelectorAll('[data-layout-id]').forEach(node=>{node.id=node.dataset.layoutId;node.removeAttribute('data-layout-id')});const retained=new Map([...document.querySelectorAll('[data-theme-piece]')].map(node=>[node.dataset.themePiece,node]));const used=new Set();fragment.querySelectorAll('[data-theme-slot]').forEach(target=>{const piece=retained.get(target.dataset.themeSlot);if(piece){used.add(target.dataset.themeSlot);target.replaceWith(piece)}});if(pool)pool.replaceChildren(...[...retained].filter(([name])=>!used.has(name)).map(([,node])=>node));root.dataset.theme=next;root.dataset.layallTheme=next;mount.replaceChildren(fragment);syncLayout();bindPage(query)};
const savedColor=readStored('layall-color-mode');if(colorModes.has(savedColor))root.dataset.colorMode=savedColor;syncColor();
document.querySelectorAll('[data-color]').forEach(button=>button.addEventListener('click',()=>{const mode=button.dataset.color;if(!colorModes.has(mode))return;root.dataset.colorMode=mode;writeStored('layall-color-mode',mode);syncColor()}));
document.querySelectorAll('[data-layout-theme]').forEach(select=>select.addEventListener('change',()=>{const next=select.value;if(!layoutThemes.has(next)){syncLayout();return}activate(next);writeStored(layoutKey,next)}));
const navToggle=document.querySelector('[data-nav-toggle]');const nav=document.querySelector('[data-nav]');navToggle?.addEventListener('click',()=>{const open=nav.dataset.open!=='true';nav.dataset.open=String(open);navToggle.setAttribute('aria-expanded',String(open))});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(nav)nav.dataset.open='false';if(navToggle)navToggle.setAttribute('aria-expanded','false');const docs=document.querySelector('[data-docs-sidebar]');const docsToggle=document.querySelector('[data-docs-toggle]');if(docs)docs.dataset.open='false';if(docsToggle)docsToggle.setAttribute('aria-expanded','false')}if(event.key==='/'&&!/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)){const input=document.querySelector('[data-search-input]');if(input){event.preventDefault();input.focus()}}});
const remembered=readStored(layoutKey);if(layoutThemes.has(remembered)&&remembered!==authorTheme)activate(remembered);else{root.dataset.theme=authorTheme;root.dataset.layallTheme=authorTheme;syncLayout();bindPage()}
})()</script>`;

const shell = (title, body, options = {}) => {
	const description = options.description ?? siteDescription;
	const nav = topLinks();
	const variants = options.variants ?? Object.fromEntries(themeOrder.map((name) => [name, body]));
	const pieces = Object.entries(options.pieces ?? {});
	const slot = (name) => `<span data-theme-slot="${name}"></span>`;
	const assemble = (markup) =>
		pieces.reduce((result, [name, piece]) => result.replace(slot(name), piece), markup);
	const activeVariant = variants[theme] ?? body;
	const activeBody = assemble(activeVariant);
	const pool = pieces
		.filter(([name]) => !activeVariant.includes(slot(name)))
		.map(([, piece]) => piece)
		.join('');
	const templates = themeOrder
		.map((name) => {
			const inertBody = (variants[name] ?? body).replace(
				/ id="([^"]+)"/g,
				' data-layout-id="$1"'
			);
			return `<template data-theme-layout="${name}">${inertBody}</template>`;
		})
		.join('');
	const layoutOptions = themeOrder
		.map(
			(name) =>
				`<option value="${name}"${name === theme ? ' selected' : ''}>${name === 'layall' ? 'LayAll' : name[0].toUpperCase() + name.slice(1)}</option>`
		)
		.join('');
	return `<!doctype html><html lang="${esc(site.locale || 'ko-KR')}" data-layall-theme="${esc(theme)}" data-theme="${esc(theme)}" data-author-theme="${esc(theme)}" data-color-mode="${esc(site.colorMode || 'system')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="${esc(description)}"><title>${esc(title)}${title === siteTitle ? '' : ` · ${esc(siteTitle)}`}</title><style>${styles}</style></head><body data-page-kind="${esc(options.kind || 'page')}"><a class="skip-link" href="#content">본문으로 건너뛰기</a><header class="site-header"><div class="header-inner"><a class="brand" href="${href('/')}">${esc(siteTitle)}</a><button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="site-navigation">Menu</button><nav class="site-nav" id="site-navigation" data-nav>${nav}<span class="appearance-controls"><label class="theme-control">Layout<select data-layout-theme aria-label="Layout theme">${layoutOptions}</select></label><span class="color-controls" aria-label="화면 테마"><button type="button" data-color="light" aria-label="라이트 모드">☀</button><button type="button" data-color="dark" aria-label="다크 모드">☾</button><button type="button" data-color="system" aria-label="시스템 모드">◐</button></span></span></nav></div></header><div data-theme-view>${activeBody}</div><div data-theme-pool hidden>${pool}</div><footer class="site-footer"><span>${esc(siteTitle)}</span><span>${esc(site.authorName || author)}</span></footer><nav class="floating-nav" aria-label="빠른 탐색"><a href="${href('/')}">Home</a><a href="${href('/#work')}">Writing</a><a href="${href('/search/')}">Search</a></nav>${templates}${behavior}</body></html>`;
};

const compactList = (items) => {
	if (!items.length) return '<div class="empty">아직 공개된 글이 없습니다.</div>';
	return `<ul class="post-list">${items.map((post) => `<li><a href="${postUrl(post)}"><strong>${esc(post.title || 'Untitled')}</strong><span>${esc(metadata(post))}</span></a></li>`).join('')}</ul>`;
};
const blogCard = (post) =>
	`<article class="blog-card">${picture(post)}<div class="post-meta">${esc(metadata(post))}</div><h2><a href="${postUrl(post)}">${esc(post.title || 'Untitled')}</a></h2>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 130))}</p>` : ''}${tagsFor(post)}</article>`;
const portfolioCard = (post) =>
	`<a class="showcase-card" href="${postUrl(post)}">${picture(post)}<div class="showcase-card-content"><span class="post-meta">${esc(metadata(post))}</span><h3>${esc(post.title || 'Untitled')}</h3>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 120))}</p>` : ''}</div></a>`;

const layallHome = (items) =>
	`<main id="content"><section class="page-heading"><p class="eyebrow">LayAll archive</p><h1>${esc(siteTitle)}</h1>${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : ''}</section>${profileMarkup()}${compactList(items)}</main>`;
const blogHome = (items) => {
	const [lead, ...rest] = items;
	const categories = [...folders.entries()]
		.map(
			([id, folder]) =>
				`<li><a href="${href(`/folders/${encodeURIComponent(id)}/`)}"><span>${esc(folder.name)}</span><span>${posts.filter((post) => String(post.folderId ?? '') === id).length}</span></a></li>`
		)
		.join('');
	return `<main id="content" class="blog-home"><section class="blog-title"><h1>${esc(siteTitle)}</h1><div>${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : ''}${profileMarkup()}</div></section>${lead ? `<article class="blog-lead">${picture(lead)}<div class="blog-lead-content"><span class="post-meta">${esc(metadata(lead))}</span><h2><a href="${postUrl(lead)}">${esc(lead.title || 'Untitled')}</a></h2>${excerpt(lead.body) ? `<p>${esc(excerpt(lead.body, 220))}</p>` : ''}${tagsFor(lead)}</div></article>` : '<div class="empty">아직 공개된 글이 없습니다.</div>'}<section class="blog-grid">${rest.slice(0, 4).map(blogCard).join('')}</section><section class="blog-archive"><div><p class="eyebrow">Archive</p><h2>All stories</h2>${compactList(rest.slice(4))}</div>${categories ? `<aside class="blog-sidebar"><p class="eyebrow">Categories</p><ul>${categories}</ul></aside>` : ''}</section></main>`;
};
const minimalHome = (items) =>
	`<main id="content" class="minimal-home"><section class="minimal-masthead"><p class="eyebrow">Notes & essays</p><h1>${esc(siteTitle)}</h1><div class="minimal-profile">${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : '<span></span>'}${profileMarkup()}</div></section><ul class="minimal-list">${items.map((post) => `<li><a href="${postUrl(post)}"><span class="post-meta">${esc(metadata(post))}</span><h2>${esc(post.title || 'Untitled')}</h2>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 150))}</p>` : ''}</a></li>`).join('')}</ul>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}</main>`;
const portfolioHome = (items) => {
	const groups = new Map();
	for (const post of items) {
		const id = String(post.folderId ?? 'home');
		const group = groups.get(id) ?? [];
		group.push(post);
		groups.set(id, group);
	}
	const sections = [...groups.entries()]
		.map(
			([id, group], index) =>
				`<section class="showcase"${index === 0 ? ' id="work"' : ''}><div class="showcase-header"><div><p class="eyebrow">${id === 'home' ? 'Archive' : 'Collection'}</p><h2>${esc(id === 'home' ? siteTitle : folderName(id))}</h2></div><span class="muted">${group.length} article${group.length === 1 ? '' : 's'}</span></div><div class="showcase-grid">${group.map(portfolioCard).join('')}</div></section>`
		)
		.join('');
	return `<main id="content" class="portfolio-home"><section class="portfolio-hero"><div><p class="eyebrow">Selected writing</p><h1>${esc(author || siteTitle)}</h1>${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : ''}</div>${profileMarkup()}</section>${sections || '<section class="showcase" id="work"><div class="empty">아직 공개된 글이 없습니다.</div></section>'}</main>`;
};
const docsHome = (items) => {
	const first = items[0];
	const cards = [...folders.entries()]
		.map(([id, folder]) => {
			const firstInFolder = items.find((post) => String(post.folderId ?? '') === id);
			return `<a class="guide-card" href="${firstInFolder ? postUrl(firstInFolder) : href(`/folders/${encodeURIComponent(id)}/`)}"><p class="eyebrow">Guide</p><h2>${esc(folder.name)}</h2><p>${firstInFolder ? esc(excerpt(firstInFolder.body, 110)) : '이 섹션의 문서를 살펴보세요.'}</p></a>`;
		})
		.join('');
	return `<main id="content" class="docs-home"><section class="docs-intro"><p class="eyebrow">Documentation</p><h1>${esc(siteTitle)}</h1>${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : ''}<a class="primary-link" href="${first ? postUrl(first) : href('/docs/')}">${first ? 'Start reading' : 'View guides'}</a></section><section><div class="showcase-header"><div><p class="eyebrow">Learn</p><h2>Guides</h2></div><a href="${href('/docs/')}">전체 문서 보기 →</a></div><div class="guide-grid">${
		cards ||
		items
			.slice(0, 6)
			.map(
				(post) =>
					`<a class="guide-card" href="${postUrl(post)}"><p class="eyebrow">Article</p><h2>${esc(post.title || 'Untitled')}</h2><p>${esc(excerpt(post.body, 110))}</p></a>`
			)
			.join('')
	}</div>${items.length ? '' : '<div class="empty">아직 공개된 문서가 없습니다.</div>'}</section></main>`;
};
const renderHome = (items, selectedTheme = theme) =>
	({
		layall: layallHome,
		blog: blogHome,
		minimal: minimalHome,
		portfolio: portfolioHome,
		docs: docsHome,
	})[selectedTheme](items);
const variantsOf = (renderer) =>
	Object.fromEntries(themeOrder.map((name) => [name, renderer(name)]));

const toc = (headings) => {
	const visible = headings.filter((heading) => heading.level >= 2 && heading.level <= 4);
	return visible.length
		? `<ol>${visible.map((heading) => `<li class="toc-level-${heading.level}"><a href="#${esc(heading.id)}">${esc(heading.label)}</a></li>`).join('')}</ol>`
		: '<p class="muted">이 문서에는 세부 목차가 없습니다.</p>';
};
const articleContent = (post, rendered) =>
	`<article class="article" data-theme-piece="article" data-post-id="${esc(post.postId)}"><header class="article-header"><p class="post-meta">${esc(metadata(post))}</p><h1>${esc(post.title || 'Untitled')}</h1>${tagsFor(post)}</header>${picture(post)}<div class="article-body">${rendered.html}</div>${site.giscusEnabled ? '<section data-giscus-enabled="true" aria-label="Comments"></section>' : ''}</article>`;
const articleToc = (rendered) =>
	`<aside class="article-aside" data-theme-piece="toc" aria-label="글 목차"><h2>On this page</h2>${toc(rendered.headings)}</aside>`;
const articleSlot = '<span data-theme-slot="article"></span>';
const tocSlot = '<span data-theme-slot="toc"></span>';
const docsNavigationSlot = '<span data-theme-slot="docs-navigation"></span>';
const standardArticle = (selectedTheme) => {
	if (selectedTheme === 'minimal')
		return `<main id="content" class="article-shell theme-article-minimal">${articleSlot}${tocSlot}</main>`;
	if (selectedTheme === 'portfolio')
		return `<main id="content" class="article-shell theme-article-portfolio">${tocSlot}${articleSlot}</main>`;
	return `<main id="content" class="article-shell theme-article-${selectedTheme}">${articleSlot}${tocSlot}</main>`;
};
const docsArticle = () =>
	`<div class="docs-layout">${docsNavigationSlot}<main id="content" class="docs-content">${articleSlot}</main><div class="docs-toc">${tocSlot}</div></div>`;

for (const post of posts) {
	const rendered = renderMarkdown(post.body);
	const variants = variantsOf((name) =>
		name === 'docs' ? docsArticle() : standardArticle(name)
	);
	const pieces = {
		article: articleContent(post, rendered),
		toc: articleToc(rendered),
		'docs-navigation': `<div class="docs-sidebar-wrap" data-theme-piece="docs-navigation"><button class="nav-toggle" type="button" data-docs-toggle aria-expanded="false">문서 메뉴</button><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation(post)}</aside></div>`,
	};
	write(
		`posts/${post.permalink}/index.html`,
		shell(post.title || 'Untitled', variants[theme], {
			kind: theme === 'docs' ? 'docs-article' : 'article',
			description: excerpt(post.body, 160),
			variants,
			pieces,
		})
	);
}

const PAGE_SIZE = 10;
const collectionBody = (selectedTheme, title, items, pagination, kind) => {
	const heading = `<header class="page-heading"><p class="eyebrow">${esc(kind)}</p><h1>${esc(title)}</h1></header>`;
	if (selectedTheme === 'blog')
		return `<main id="content" class="blog-home">${heading}<section class="blog-grid">${items.map(blogCard).join('')}</section>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}${pagination}</main>`;
	if (selectedTheme === 'minimal')
		return `<main id="content" class="minimal-home">${heading}<ul class="minimal-list">${items.map((post) => `<li><a href="${postUrl(post)}"><span class="post-meta">${esc(metadata(post))}</span><h2>${esc(post.title || 'Untitled')}</h2>${excerpt(post.body) ? `<p>${esc(excerpt(post.body, 150))}</p>` : ''}</a></li>`).join('')}</ul>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}${pagination}</main>`;
	if (selectedTheme === 'portfolio')
		return `<main id="content" class="portfolio-home"><section class="showcase" id="work">${heading}<div class="showcase-grid">${items.map(portfolioCard).join('')}</div>${items.length ? '' : '<div class="empty">아직 공개된 글이 없습니다.</div>'}${pagination}</section></main>`;
	if (selectedTheme === 'docs')
		return `<div class="docs-layout"><div class="docs-sidebar-wrap"><button class="nav-toggle" type="button" data-docs-toggle aria-expanded="false">문서 메뉴</button><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation()}</aside></div><main id="content" class="docs-index">${heading}${compactList(items)}${pagination}</main><aside></aside></div>`;
	return `<main id="content">${heading}${compactList(items)}${pagination}</main>`;
};
const collection = (prefix, title, items, kind = 'collection') => {
	const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
	for (let index = 0; index < pages; index += 1) {
		const file = index === 0 ? `${prefix}index.html` : `${prefix}page/${index + 1}/index.html`;
		const pagination =
			pages > 1
				? `<nav class="pagination" aria-label="페이지">${Array.from({ length: pages }, (_, pageIndex) => `<a${pageIndex === index ? ' aria-current="page"' : ''} href="${href(`/${prefix}${pageIndex ? `page/${pageIndex + 1}/` : ''}`)}">${pageIndex + 1}</a>`).join('')}</nav>`
				: '';
		const pageItems = items.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE);
		const variants = variantsOf((name) =>
			prefix === '' && index === 0
				? renderHome(pageItems, name).replace(/<\/main>$/, `${pagination}</main>`)
				: collectionBody(name, title, pageItems, pagination, kind)
		);
		write(
			file,
			shell(title, variants[theme], {
				kind: prefix === '' ? 'home' : kind,
				variants,
			})
		);
	}
};

collection('', siteTitle, posts);
const groupedFolders = new Map();
for (const post of posts) {
	const id = String(post.folderId ?? 'home');
	const items = groupedFolders.get(id) ?? [];
	items.push(post);
	groupedFolders.set(id, items);
}
for (const [id, folder] of folders) {
	collection(
		`folders/${encodeURIComponent(id)}/`,
		folder.name ?? id,
		groupedFolders.get(id) ?? [],
		'folder'
	);
}
if (groupedFolders.has('home')) {
	collection('folders/home/', 'Unfiled', groupedFolders.get('home'), 'folder');
}
const groupedTags = new Map();
for (const post of posts) {
	for (const rawTag of Array.isArray(post.tags) ? post.tags : []) {
		const tag = String(rawTag);
		const items = groupedTags.get(tag) ?? [];
		items.push(post);
		groupedTags.set(tag, items);
	}
}
for (const [tag, items] of groupedTags) {
	collection(`tags/${tagSegment(tag)}/`, tag, items, 'tag');
}

const docsSections = [...folders.entries()]
	.map(([id, folder]) => {
		const items = posts.filter((post) => String(post.folderId ?? '') === id);
		if (!items.length) return '';
		return `<section class="docs-section"><p class="eyebrow">Section</p><h2>${esc(folder.name)}</h2><div class="docs-section-list">${items.map((post) => `<a href="${postUrl(post)}">${esc(post.title || 'Untitled')}</a>`).join('')}</div></section>`;
	})
	.join('');
const docsIndex = `<div class="docs-layout"><div class="docs-sidebar-wrap"><button class="nav-toggle" type="button" data-docs-toggle aria-expanded="false">문서 메뉴</button><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation()}</aside></div><main id="content" class="docs-index"><p class="eyebrow">Documentation</p><h1>전체 가이드</h1>${siteDescription ? `<p class="lead">${esc(siteDescription)}</p>` : ''}${docsSections || compactList(posts)}</main><aside></aside></div>`;
const docsIndexVariants = variantsOf((name) =>
	name === 'docs' ? docsIndex : collectionBody(name, 'Docs', posts, '', 'documentation')
);
write(
	'docs/index.html',
	shell('Docs', docsIndexVariants[theme], {
		kind: 'docs-index',
		variants: docsIndexVariants,
	})
);

const search = posts.map((post) => ({
	postId: post.postId,
	title: String(post.title || 'Untitled'),
	permalink: post.permalink,
	body: plainText(post.body),
	tags: Array.isArray(post.tags) ? post.tags.map(String) : [],
	folder: post.folderId ? folderName(post.folderId) : '',
}));
write('search.json', JSON.stringify(search));
const searchPanel = `<p class="eyebrow">Archive search</p><h1>Search</h1><form class="search-form" data-search-form role="search"><label class="skip-link" for="search-query">검색어</label><input id="search-query" data-search-input type="search" autocomplete="off" placeholder="제목, 내용, 태그 검색"><button type="submit">검색</button></form><p class="muted" data-search-status aria-live="polite"></p><ul class="post-list search-results" data-search-results></ul>`;
const searchVariants = variantsOf((name) => {
	if (name === 'docs')
		return `<div class="docs-layout"><div class="docs-sidebar-wrap"><button class="nav-toggle" type="button" data-docs-toggle aria-expanded="false">문서 메뉴</button><aside class="docs-sidebar" data-docs-sidebar>${docsNavigation()}</aside></div><main id="content" class="search-shell">${searchPanel}</main><aside></aside></div>`;
	if (name === 'portfolio')
		return `<main id="content" class="search-shell portfolio-home"><section class="showcase" id="work">${searchPanel}</section></main>`;
	return `<main id="content" class="search-shell theme-search-${name}">${searchPanel}</main>`;
});
write(
	'search/index.html',
	shell('Search', searchVariants[theme], { kind: 'search', variants: searchVariants })
);

if (site.feedEnabled !== false) {
	const feedUpdated =
		posts
			.map((post) => new Date(post.sourceUpdatedAt ?? '').getTime())
			.filter(Number.isFinite)
			.sort((a, b) => b - a)[0] ?? 0;
	const feedUpdatedIso = new Date(feedUpdated).toISOString();
	const rssItems = posts
		.map(
			(post) =>
				`<item><title>${esc(post.title || 'Untitled')}</title><link>${esc(absolute(`/posts/${post.permalink}/`))}</link><guid>${esc(absolute(`/posts/${post.permalink}/`))}</guid><description>${esc(excerpt(post.body, 240))}</description></item>`
		)
		.join('');
	const atomItems = posts
		.map((post) => {
			const postUpdated = new Date(post.sourceUpdatedAt ?? '').getTime();
			const updated = new Date(Number.isFinite(postUpdated) ? postUpdated : 0).toISOString();
			const url = absolute(`/posts/${post.permalink}/`);
			return `<entry><title>${esc(post.title || 'Untitled')}</title><id>${esc(url)}</id><updated>${updated}</updated><link rel="alternate" href="${esc(url)}"/><summary>${esc(excerpt(post.body, 240))}</summary></entry>`;
		})
		.join('');
	write(
		'feed.xml',
		`<rss version="2.0"><channel><title>${esc(siteTitle)}</title><link>${esc(absolute('/'))}</link><description>${esc(siteDescription || siteTitle)}</description>${rssItems}</channel></rss>`
	);
	write(
		'atom.xml',
		`<feed xmlns="http://www.w3.org/2005/Atom"><title>${esc(siteTitle)}</title><id>${esc(absolute('/'))}</id><updated>${feedUpdatedIso}</updated><author><name>${esc(author || siteTitle)}</name></author><link rel="alternate" href="${esc(absolute('/'))}"/>${atomItems}</feed>`
	);
}
const sitemapPages = [
	'/',
	'/search/',
	'/docs/',
	...posts.map((post) => `/posts/${post.permalink}/`),
];
write(
	'sitemap.xml',
	`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemapPages.map((url) => `<url><loc>${esc(absolute(url))}</loc></url>`).join('')}</urlset>`
);
const notFoundVariants = variantsOf(
	(name) =>
		`<main id="content" class="theme-not-found-${name}"><section class="page-heading"><p class="eyebrow">Error 404</p><h1>페이지를 찾을 수 없습니다.</h1><p><a href="${href('/')}">홈으로 돌아가기</a></p></section></main>`
);
write(
	'404.html',
	shell('Not found', notFoundVariants[theme], {
		kind: 'not-found',
		variants: notFoundVariants,
	})
);
write('assets-manifest.json', JSON.stringify({ files: assetClaims }));
write('__layall-deploy.json', JSON.stringify({ format: 'layall-deploy', sourceSha: sha }));
write(
	'generated-files.json',
	JSON.stringify({ files: [...generated, 'generated-files.json'].sort() })
);
