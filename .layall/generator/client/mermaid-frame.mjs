import { esc, js } from '../render/text.mjs';
import { themeOrder, themeTokens } from '../render/theme-data.mjs';

export function diagramTheme(root, darkSystem = false) {
	const theme = themeOrder.includes(root.dataset.theme) ? root.dataset.theme : 'layall';
	const dark =
		root.dataset.colorMode === 'dark' || (root.dataset.colorMode === 'system' && darkSystem);
	const tokens = themeTokens(theme, dark ? 'dark' : 'light');
	return {
		theme,
		dark,
		ink: tokens.ink,
		muted: tokens.muted,
		surface: tokens.surface,
		line: tokens.line,
		accent: tokens.accent,
	};
}

// Only the tiny classic bootstrap is requested by the opaque frame. Mermaid
// modules arrive from the parent and become frame-local Blob ES modules. No
// module CORS exception or same-origin sandbox permission is needed.
// Diagram text is only in srcdoc, never in a request URL or a remote renderer.
export function diagramDocument({ scriptUrl, origin, source, token, colors, fullscreen = false }) {
	const script = new URL(scriptUrl, origin);
	if (
		script.origin !== origin ||
		!/^https?:$/.test(script.protocol) ||
		script.username ||
		script.password ||
		script.search ||
		script.hash ||
		!/\/assets\/static\/diagram-[a-f0-9]{64}\.js$/.test(script.pathname)
	)
		throw new Error('Invalid local diagram runtime');
	const csp = `default-src 'none'; script-src ${script.href} blob:; style-src 'unsafe-inline'; img-src data:; connect-src 'none'; font-src 'none'; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
	const viewerStyle = fullscreen
		? 'html,body,#diagram{width:100%;height:100%;padding:0;overflow:hidden}#diagram>svg{width:100%!important;height:100%!important;max-width:none!important;max-height:none!important;margin:0}'
		: '';
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${esc(csp)}"><meta name="referrer" content="no-referrer"><style>html,body{margin:0;background:transparent}body{padding:12px;box-sizing:border-box;font-family:ui-sans-serif,system-ui,sans-serif}#diagram{min-width:0;overflow:auto}svg{display:block;max-width:100%;height:auto;margin:auto}${viewerStyle}</style></head><body><div id="diagram"></div><script type="application/json" data-mermaid-frame>${js({ source, token, colors })}</script><script defer src="${esc(script.href)}"></script></body></html>`;
}
