import fs from 'node:fs';
import path from 'node:path';

const out = process.argv[2];
const sha = process.argv[3];
if (fs.existsSync(out)) throw new Error('output must be fresh');
fs.mkdirSync(out, { recursive: true });

const readJson = (file, fallback) => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : fallback;
const site = readJson('.layall/site.json', {});
const [owner = '', repo = ''] = (process.env.GITHUB_REPOSITORY ?? '').split('/');
const projectPath = repo && repo.toLowerCase() !== `${owner}.github.io`.toLowerCase() ? `/${repo}` : '';
const configuredBase = String(site.baseUrl ?? '').replace(/\/+$/, '');
let basePath = projectPath;
try { if (configuredBase) basePath = new URL(configuredBase).pathname.replace(/\/+$/, ''); } catch {}
const fallbackBase = owner ? `https://${owner}.github.io${projectPath}` : '';
const publicBase = configuredBase || fallbackBase;
const href = value => `${basePath}${value}` || '/';
const absolute = value => publicBase ? `${publicBase}${value}` : href(value);
const esc = value => String(value ?? '').replace(/[&<>\"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' })[char]);
const safeExternal = value => {
  try {
    const url = new URL(String(value ?? ''));
    return url.protocol === 'https:' || url.protocol === 'http:' ? esc(url.href) : '#';
  } catch { return '#'; }
};

const folders = new Map();
const folderRoot = 'content/folders';
if (fs.existsSync(folderRoot)) for (const name of fs.readdirSync(folderRoot).sort()) {
  if (!name.endsWith('.json')) continue;
  const folder = readJson(path.join(folderRoot, name), {});
  if (folder.format === 'layall-folder' && folder.folderId) folders.set(folder.folderId, folder);
}

const posts = [];
const postRoot = 'content/posts';
if (fs.existsSync(postRoot)) for (const id of fs.readdirSync(postRoot).sort()) {
  const sourceDir = path.join(postRoot, id);
  const file = path.join(sourceDir, 'post.layallnote');
  if (!fs.existsSync(file)) continue;
  const post = readJson(file, {});
  if (post.format !== 'layall-note' || post.postId !== id) throw new Error('invalid managed source');
  if (!/^[a-z0-9][a-z0-9-]{0,127}$/.test(String(post.permalink ?? ''))) throw new Error('invalid permalink');
  Object.defineProperty(post, 'sourceDir', { value: sourceDir });
  posts.push(post);
}

const generated = [];
const write = (name, data) => {
  const outputRoot = path.resolve(out);
  const file = path.resolve(outputRoot, name);
  if (!file.startsWith(`${outputRoot}${path.sep}`)) throw new Error('unsafe output path');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data);
  generated.push(name);
};
const links = (site.externalLinks ?? []).map(link => `<a href="${safeExternal(link.url)}">${esc(link.label)}</a>`).join(' · ');
const profile = site.profileName || site.profileBio || site.profileUrl
  ? `<aside><a href="${safeExternal(site.profileUrl)}">${esc(site.profileName || site.authorName)}</a><p>${esc(site.profileBio)}</p></aside>`
  : '';
const page = (title, body) => `<!doctype html><html lang="${esc(site.locale || 'ko-KR')}" data-theme="${esc(site.theme || 'layall')}" data-color-mode="${esc(site.colorMode || 'system')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="description" content="${esc(site.description)}"><title>${esc(title)} · ${esc(site.title || 'LayAll Blog')}</title><style>:root{--paper:#faf7f2;--ink:#3d3935;--accent:#8176a8}html[data-theme=minimal]{--paper:#fff;--ink:#202020;--accent:#555}html[data-theme=blog]{--paper:#fff8ef;--ink:#372d28;--accent:#9b5d43}html[data-theme=docs]{--paper:#f5f7fa;--ink:#263142;--accent:#35679a}body{max-width:48rem;margin:auto;padding:2rem;font:16px/1.65 system-ui;color:var(--ink);background:var(--paper)}a{color:var(--accent)}header,footer{display:flex;gap:1rem;justify-content:space-between}article{margin-block:3rem}pre{overflow:auto}html[data-color-mode=dark]{--paper:#242321;--ink:#f1ece5;--accent:#c6b9ee;color-scheme:dark}@media(prefers-color-scheme:dark){html[data-color-mode=system]{--paper:#242321;--ink:#f1ece5;--accent:#c6b9ee;color-scheme:dark}}</style></head><body><header><a href="${href('/')}">${esc(site.title || 'LayAll Blog')}</a><nav>${links}</nav></header>${profile}<main>${body}</main><footer>${esc(site.authorName)}</footer></body></html>`;
const postList = items => `<ul>${items.map(post => `<li><a href="${href(`/posts/${encodeURIComponent(post.permalink)}/`)}">${esc(post.title)}</a></li>`).join('')}</ul>`;
const PAGE_SIZE = 10;
const collection = (prefix, title, items) => {
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  for (let index = 0; index < pages; index += 1) {
    const file = index === 0 ? `${prefix}index.html` : `${prefix}page/${index + 1}/index.html`;
    const nav = Array.from({ length: pages }, (_, pageIndex) => `<a href="${href(`/${prefix}${pageIndex ? `page/${pageIndex + 1}/` : ''}`)}">${pageIndex + 1}</a>`).join(' ');
    write(file, page(title, `<h1>${esc(title)}</h1>${postList(items.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE))}<nav>${nav}</nav>`));
  }
};

const assetClaims = [];
for (const post of posts) {
  write(`posts/${post.permalink}/index.html`, page(post.title, `<article data-post-id="${esc(post.postId)}"><h1>${esc(post.title)}</h1><div>${esc(post.body).replace(/\n/g, '<br>')}</div>${site.giscusEnabled ? '<section data-giscus-enabled="true"></section>' : ''}</article>`));
  for (const asset of post.attachments ?? []) {
    if (!asset.path || asset.path.includes('..') || path.isAbsolute(asset.path)) throw new Error('unsafe asset');
    const source = path.join(post.sourceDir, asset.path);
    if (!fs.existsSync(source)) continue;
    const destination = `assets/posts/${post.postId}/${path.basename(asset.path)}`;
    write(destination, fs.readFileSync(source));
    assetClaims.push({ postId: post.postId, path: destination, sha256: asset.sha256 });
  }
}

collection('', site.title || 'LayAll Blog', posts);
const groupedFolders = posts.reduce((groups, post) => ((groups[post.folderId ?? 'home'] ??= []).push(post), groups), {});
for (const [id, items] of Object.entries(groupedFolders)) collection(`folders/${encodeURIComponent(id)}/`, folders.get(id)?.name ?? id, items);
const groupedTags = {};
for (const post of posts) for (const tag of post.tags ?? []) (groupedTags[tag] ??= []).push(post);
for (const [tag, items] of Object.entries(groupedTags)) collection(`tags/${encodeURIComponent(tag)}/`, tag, items);

const search = posts.map(post => ({ postId: post.postId, title: post.title, permalink: post.permalink, body: post.body }));
write('search.json', JSON.stringify(search));
write('search/index.html', page('Search', postList(posts)));
if (site.feedEnabled !== false) {
  const rssItems = posts.map(post => `<item><title>${esc(post.title)}</title><link>${esc(absolute(`/posts/${post.permalink}/`))}</link></item>`).join('');
  const atomItems = posts.map(post => `<entry><title>${esc(post.title)}</title><link href="${esc(absolute(`/posts/${post.permalink}/`))}"/></entry>`).join('');
  write('feed.xml', `<rss version="2.0"><channel><title>${esc(site.title || 'LayAll Blog')}</title>${rssItems}</channel></rss>`);
  write('atom.xml', `<feed xmlns="http://www.w3.org/2005/Atom"><title>${esc(site.title || 'LayAll Blog')}</title>${atomItems}</feed>`);
}
write('sitemap.xml', `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${posts.map(post => `<url><loc>${esc(absolute(`/posts/${post.permalink}/`))}</loc></url>`).join('')}</urlset>`);
write('404.html', page('Not found', '<h1>404</h1>'));
write('assets-manifest.json', JSON.stringify({ files: assetClaims }));
write('__layall-deploy.json', JSON.stringify({ format: 'layall-deploy', sourceSha: sha }));
write('generated-files.json', JSON.stringify({ files: [...generated, 'generated-files.json'].sort() }));
