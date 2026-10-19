import { closesFence, openFence } from './markdown-fences.mjs';
import { esc, plainText, safeExternal, safeSocialImage, slugify } from './text.mjs';

export function createMarkdown({ href = (value) => value } = {}) {
	const safeContentHref = (value) => {
		const raw = String(value ?? '').trim();
		if (!raw || raw.startsWith('//') || raw.includes('\\')) return null;
		if (raw.startsWith('#')) return raw.replace(/[^#a-zA-Z0-9_-]/g, '');
		if (raw.startsWith('/')) return href(raw.replace(/\s/g, '%20'));
		if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return safeExternal(raw);
		return raw.replace(/\s/g, '%20');
	};
	const inlineMarkdown = (source, assets = new Map(), figures = false, onImage = null) => {
		const placeholders = [];
		const keep = (html) => {
			const token = `\u0000${placeholders.length}\u0000`;
			placeholders.push(html);
			return token;
		};
		let value = String(source ?? '')
			.replace(/\u0000/g, '')
			.replace(/`([^`]+)`/g, (_, code) => keep(`<code>${esc(code)}</code>`));
		value = value.replace(
			/(!?)\[([^\]]*)\]\(([^)\s]+)(?:\s+[\"'][^\"']*[\"'])?\)/g,
			(_, image, label, target) => {
				const attachment = target.startsWith('layall-attachment:');
				const asset = attachment
					? assets.get(target.slice('layall-attachment:'.length))
					: null;
				const safe = attachment ? asset?.url : safeContentHref(target);
				if (!safe || /[\u0000-\u001f\u007f]/.test(safe)) {
					return keep(
						attachment
							? `<span class="attachment-missing">첨부파일: ${esc(label || 'Attachment')}</span>`
							: esc(label)
					);
				}
				if (image && (!attachment || asset.image)) {
					const publicUrl = attachment ? asset.publicUrl : safeSocialImage(target);
					if (publicUrl) onImage?.({ url: publicUrl, alt: String(label ?? '') });
					const picture = `<img src="${esc(safe)}" alt="${esc(label)}" loading="lazy" decoding="async">`;
					return keep(
						figures
							? `<figure class="article-image">${picture}${label.trim() ? `<figcaption>${esc(label)}</figcaption>` : ''}</figure>`
							: picture
					);
				}
				return keep(`<a href="${esc(safe)}">${esc(label || 'Attachment')}</a>`);
			}
		);
		value = esc(value)
			.replace(/\\\|/g, '|')
			.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
			.replace(/__([^_]+)__/g, '<strong>$1</strong>')
			.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
			.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
		// A code span can occur inside a link label. Restore nested, generated tokens too.
		while (/\u0000\d+\u0000/.test(value))
			value = value.replace(
				/\u0000(\d+)\u0000/g,
				(_, index) => placeholders[Number(index)] ?? ''
			);
		return value;
	};

	// LayAll stores tables as pipe-delimited Markdown and side-by-side images on one line.
	const tableCells = (line = '') => {
		let value = line.trim();
		if (!value.includes('|')) return null;
		if (value.startsWith('|')) value = value.slice(1);
		if (value.endsWith('|') && !value.endsWith('\\|')) value = value.slice(0, -1);
		const cells = [];
		let cell = '';
		for (let index = 0; index < value.length; index += 1) {
			if (value[index] === '\\' && index + 1 < value.length) {
				cell += value[index] + value[++index];
			} else if (value[index] === '|') {
				cells.push(cell.trim());
				cell = '';
			} else cell += value[index];
		}
		cells.push(cell.trim());
		return cells;
	};
	const imageLine = (line) => {
		const pattern = /!\[[^\]]*\]\([^\s)]+(?:\s+["'][^"']*["'])?\)/g;
		const images = [...line.matchAll(pattern)];
		return images.length && !line.replace(pattern, '').trim() ? images.length : 0;
	};

	const finiteMapCoordinate = (value) => {
		const text = String(value ?? '').trim();
		if (!text) return null;
		const number = Number(text);
		return Number.isFinite(number) ? number : null;
	};
	const mapCoordinatePair = (lat, lng) => {
		if (lat === null || lng === null || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
		return { lat, lng };
	};
	/** Camera `c` is lng,lat,zoom,... Place pages use zoom-only `c=15.00,0,0,0,dh` plus lat/lng. */
	const naverCameraPair = (raw) => {
		const parts = String(raw ?? '').split(',');
		if (parts.length < 6) return null;
		return mapCoordinatePair(finiteMapCoordinate(parts[1]), finiteMapCoordinate(parts[0]));
	};
	/** Same URL shapes as `src/lib/markdown/map-place-card.ts`. */
	const parseMapPlaceUrl = (raw) => {
		let url;
		try {
			url = new URL(raw);
		} catch {
			return null;
		}
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		const host = url.hostname.replace(/^www\./, '');
		if (host === 'google.com' && url.pathname.startsWith('/maps')) {
			const query = url.searchParams.get('query') || url.searchParams.get('q') || '';
			const [latText, lngText] = query.split(',');
			const pair = mapCoordinatePair(
				finiteMapCoordinate(latText),
				finiteMapCoordinate(lngText)
			);
			return pair ? { provider: 'google', ...pair } : null;
		}
		if (host === 'map.naver.com') {
			const fromPoint = mapCoordinatePair(
				finiteMapCoordinate(url.searchParams.get('lat')),
				finiteMapCoordinate(url.searchParams.get('lng'))
			);
			const pair = fromPoint || naverCameraPair(url.searchParams.get('c'));
			return pair ? { provider: 'naver', ...pair } : null;
		}
		return null;
	};
	const naverPlaceOpenUrl = (raw, label, lat, lng) => {
		let url;
		try {
			url = new URL(raw);
		} catch {
			return raw;
		}
		if (url.hostname.replace(/^www\./, '') !== 'map.naver.com') return raw;
		if (/\/place\/\d+/.test(url.pathname)) return raw;
		const name = String(label ?? '').trim();
		if (!name) return raw;
		return `https://map.naver.com/p/search/${encodeURIComponent(name)}?c=15.00,0,0,0,dh&lat=${Number(lat).toFixed(6)}&lng=${Number(lng).toFixed(6)}`;
	};
	const mapPlaceFromLine = (line) => {
		const trimmed = String(line ?? '').trim();
		if (!trimmed) return null;
		const pattern = /\[([^\]]*)\]\(([^)\s]+)\)/g;
		const links = [...trimmed.matchAll(pattern)];
		if (!links.length) return null;
		if (trimmed.replace(pattern, '').replace(/[·\s]/g, '').length) return null;
		const places = [];
		for (const match of links) {
			const parsed = parseMapPlaceUrl(match[2]);
			if (!parsed) return null;
			places.push({ label: String(match[1] ?? '').trim(), url: match[2], ...parsed });
		}
		const named =
			places.find((place) => place.label && place.label !== '네이버 지도') ?? places[0];
		const preferred = places.find((place) => place.provider === 'naver') ?? named;
		const label = named.label || `${preferred.lat.toFixed(6)}, ${preferred.lng.toFixed(6)}`;
		return {
			...preferred,
			label,
			url:
				preferred.provider === 'naver'
					? naverPlaceOpenUrl(preferred.url, label, preferred.lat, preferred.lng)
					: preferred.url,
		};
	};
	const mapPlaceTile = (lat, lng, zoom = 16) => {
		const clampedLat = Math.min(85, Math.max(-85, lat));
		const n = 2 ** zoom;
		const worldX = ((lng + 180) / 360) * n;
		const latRad = (clampedLat * Math.PI) / 180;
		const worldY = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
		const tileX = Math.min(n - 1, Math.max(0, Math.floor(worldX)));
		const tileY = Math.min(n - 1, Math.max(0, Math.floor(worldY)));
		return {
			url: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`,
			left: (worldX - tileX) * 100,
			top: (worldY - tileY) * 100,
		};
	};
	const mapPlaceCardHtml = (place) => {
		const tile = mapPlaceTile(place.lat, place.lng);
		const caption = place.provider === 'naver' ? '네이버 지도' : 'Google Map';
		const coords = `${place.lat.toFixed(6)}, ${place.lng.toFixed(6)}`;
		return `<a class="map-place-card" data-map-place="${place.provider}" href="${esc(place.url)}" target="_blank" rel="noopener noreferrer"><span class="map-place-map" aria-hidden="true"><img src="${esc(tile.url)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"><span class="map-place-pin" style="left:${tile.left.toFixed(2)}%;top:${tile.top.toFixed(2)}%"></span><span class="map-place-credit">© OSM</span></span><span class="map-place-body"><span class="map-place-name">${esc(place.label)}</span><span class="map-place-meta">${esc(caption)}</span><span class="map-place-coords">${esc(coords)}</span></span></a>`;
	};

	const renderMarkdown = (source, assets) => {
		const lines = String(source ?? '')
			.replace(/\r\n?/g, '\n')
			.split('\n');
		const html = [];
		const headings = [];
		let firstImage = null;
		const usedIds = new Set();
		const rememberImage = (image) => {
			firstImage ??= image;
		};
		const inline = (value) => inlineMarkdown(value, assets, false, rememberImage);
		let paragraph = [];
		let list = null;
		let fence = null;
		let quote = [];
		const flushParagraph = () => {
			if (!paragraph.length) return;
			// Editor Enter keeps each source line as its own sentence unit.
			for (const line of paragraph) html.push(`<p>${inline(line)}</p>`);
			paragraph = [];
		};
		const flushList = () => {
			if (!list) return;
			html.push(
				`<${list.type}>${list.items.map((item) => `<li>${inline(item)}</li>`).join('')}</${list.type}>`
			);
			list = null;
		};
		const flushQuote = () => {
			if (!quote.length) return;
			html.push(
				`<blockquote>${quote.map((line) => inline(line)).join('<br />')}</blockquote>`
			);
			quote = [];
		};
		const flushAll = () => {
			flushParagraph();
			flushList();
			flushQuote();
		};
		for (let index = 0; index < lines.length; index += 1) {
			const line = lines[index];
			if (fence) {
				if (closesFence(line, fence)) {
					html.push(
						`<pre><code${fence.language ? ` data-language="${esc(fence.language)}"` : ''}>${esc(fence.lines.join('\n'))}</code></pre>`
					);
					fence = null;
				} else fence.lines.push(line);
				continue;
			}
			const fenceMatch = openFence(line);
			if (fenceMatch) {
				flushAll();
				fence = {
					...fenceMatch,
					lines: [],
				};
				continue;
			}
			const imageCount = imageLine(line);
			if (imageCount) {
				flushAll();
				const images = inlineMarkdown(line, assets, true, rememberImage);
				html.push(
					imageCount > 1
						? `<div class="image-gallery" data-image-gallery="true">${images}</div>`
						: images
				);
				continue;
			}
			const header = tableCells(line);
			const separator = tableCells(lines[index + 1]);
			if (
				header &&
				separator?.length === header.length &&
				separator.every((cell) => /^:?-{3,}:?$/.test(cell))
			) {
				flushAll();
				const alignments = separator.map((cell) =>
					cell.endsWith(':') ? (cell.startsWith(':') ? 'center' : 'right') : 'left'
				);
				const row = (cells, tag) =>
					`<tr>${header.map((_, column) => `<${tag}${tag === 'th' ? ' scope="col"' : ''} class="align-${alignments[column]}">${inline(cells[column] ?? '').replace(/&lt;br\s*\/?&gt;/gi, '<br>')}</${tag}>`).join('')}</tr>`;
				const rows = [];
				index += 1;
				while (index + 1 < lines.length) {
					const cells = tableCells(lines[index + 1]);
					if (
						!cells ||
						imageLine(lines[index + 1]) ||
						/^#{1,6}\s/.test(lines[index + 1]) ||
						openFence(lines[index + 1])
					)
						break;
					rows.push(cells);
					index += 1;
				}
				html.push(
					`<div class="article-table" tabindex="0" role="region" aria-label="표"><table><thead>${row(header, 'th')}</thead><tbody>${rows.map((cells) => row(cells, 'td')).join('')}</tbody></table></div>`
				);
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
					`<h${level} id="${esc(id)}">${inline(heading[2])}<a class="heading-anchor" href="#${esc(id)}" aria-label="${esc(label)} 바로가기">#</a></h${level}>`
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
				html.push('<br>');
				continue;
			}
			const mapPlace = mapPlaceFromLine(line);
			if (mapPlace) {
				flushAll();
				html.push(mapPlaceCardHtml(mapPlace));
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
		return { html: html.join('\n'), headings, firstImage };
	};

	return { renderMarkdown, inlineMarkdown };
}
