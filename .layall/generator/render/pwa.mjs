import { esc, js } from './text.mjs';

export function emitPwa({ site, href, write, staticAssets }) {
	const pwaScope = href('/');
	const siteTitle = String(site.title || 'LayAll Blog');
	const siteDescription = String(site.description || '');
	write(
		'manifest.webmanifest',
		JSON.stringify({
			id: pwaScope,
			name: siteTitle,
			short_name: siteTitle,
			description: siteDescription,
			lang: String(site.locale || 'ko-KR'),
			start_url: pwaScope,
			scope: pwaScope,
			display: 'standalone',
			background_color: '#f6f4f0',
			theme_color: '#f6f4f0',
			prefer_related_applications: false,
			icons: [192, 512].map((size) => ({
				src: href('/' + staticAssets['icon' + size]),
				sizes: `${size}x${size}`,
				type: 'image/png',
				purpose: 'any',
			})),
		})
	);
	// Keep this response independent of public posts and settings. No offline article cache:
	// deleting/updating a post must never revive old HTML, indexes, attachments or live markers.
	const offlinePage = `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>인터넷 연결이 필요합니다</title></head><body><main><h1>인터넷 연결이 필요합니다</h1><p>연결을 확인한 뒤 다시 열어 주세요. 최신 글은 온라인에서 확인할 수 있습니다.</p><a href="${esc(pwaScope)}">블로그 홈 다시 열기</a></main></body></html>`;
	write(
		'layall-sw.js',
		`'use strict';
const scope = new URL(self.registration.scope);
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
 const request = event.request;
 const url = new URL(request.url);
 if (request.method !== 'GET' || url.origin !== scope.origin || !url.pathname.startsWith(scope.pathname)) return;
 event.respondWith(fetch(request, { cache: 'no-store' }).catch(error => {
  if (request.mode !== 'navigate') throw error;
  return new Response(${js(offlinePage)}, {
   status: 503,
   headers: {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'"
   }
  });
 }));
});
`
	);
}
