import { linkDiagramModules } from './diagram-graph.mjs';

export async function renderDiagramFrame(input, { document, window, active = () => true }, load) {
	const report = (state, height = 0) =>
		active() &&
		window.parent.postMessage(
			{ kind: 'layall:diagram', token: input.token, state, height },
			'*'
		);
	try {
		if (typeof input.source !== 'string' || input.source.length > 100000)
			throw new Error('Diagram limit');
		const { default: mermaid } = await load();
		if (!active()) return () => {};
		const c = input.colors;
		mermaid.initialize({
			startOnLoad: false,
			securityLevel: 'strict',
			suppressErrorRendering: true,
			maxTextSize: 100000,
			maxEdges: 500,
			htmlLabels: false,
			theme: 'base',
			secure: [
				'securityLevel',
				'startOnLoad',
				'suppressErrorRendering',
				'maxTextSize',
				'maxEdges',
				'htmlLabels',
				'theme',
				'themeVariables',
				'themeCSS',
				'fontFamily',
			],
			themeVariables: {
				darkMode: c.dark,
				background: c.surface,
				primaryColor: c.surface,
				primaryTextColor: c.ink,
				primaryBorderColor: c.line,
				secondaryColor: c.surface,
				tertiaryColor: c.surface,
				lineColor: c.muted,
				textColor: c.ink,
				mainBkg: c.surface,
				nodeBorder: c.accent,
				fontFamily: 'ui-sans-serif,system-ui,sans-serif',
			},
		});
		const host = document.getElementById('diagram');
		const { svg } = await mermaid.render('layall-diagram', input.source, host);
		if (!active()) return () => {};
		host.innerHTML = svg;
		// No bindFunctions, navigation, scripts, downloads or interactive links.
		host.addEventListener('click', (event) => event.preventDefault());
		const renderedSvg = host.querySelector?.('svg');
		const size = svgNaturalSize(renderedSvg);
		const measure = () =>
			active() &&
			window.parent.postMessage(
				{
					kind: 'layall:diagram',
					token: input.token,
					state: 'ready',
					height: Math.max(80, Math.ceil(host.getBoundingClientRect().height + 24)),
					size,
				},
				'*'
			);
		const observer = new window.ResizeObserver(measure);
		observer.observe(host);
		measure();
		return () => observer.disconnect();
	} catch {
		report('error'); // Do not log parser errors containing protected source text.
		return () => {};
	}
}

// Rendered SVG never leaves this frame. Only fixed state, token and numeric
// dimensions cross back to the parent, including for fullscreen rendering.
export function mountDiagramFrame(input, { document, window }, load = (url) => import(url)) {
	let active = true,
		started = false,
		linked,
		release = () => {};
	const dispose = () => {
		active = false;
		window.removeEventListener('message', receive);
		window.removeEventListener('pagehide', dispose);
		release();
		linked?.dispose();
	};
	const receive = async (event) => {
		if (
			!active ||
			started ||
			event.source !== window.parent ||
			event.data?.kind !== 'layall:diagram-modules' ||
			event.data.token !== input.token
		)
			return;
		started = true;
		window.removeEventListener('message', receive);
		release = await renderDiagramFrame(
			input,
			{ document, window, active: () => active },
			async () => {
				linked = linkDiagramModules(event.data.graph, event.data.sources, window);
				return load(linked.entry);
			}
		);
		if (!active) {
			release();
			linked?.dispose();
		}
	};
	window.addEventListener('message', receive);
	window.addEventListener('pagehide', dispose);
	window.parent.postMessage({ kind: 'layall:diagram', token: input.token, state: 'load' }, '*');
	return { dispose };
}

function svgNaturalSize(svg) {
	const viewBox = (svg?.getAttribute('viewBox') || '')
		.trim()
		.split(/[\s,]+/)
		.map(Number);
	const valid = (n) => Number.isFinite(n) && n > 0 && n <= 1000000;
	if (viewBox.length === 4 && valid(viewBox[2]) && valid(viewBox[3]))
		return { width: viewBox[2], height: viewBox[3] };
	const length = (name) => {
		const value = svg?.getAttribute(name) || '';
		return value.includes('%') ? 0 : Number.parseFloat(value);
	};
	const width = length('width'),
		height = length('height');
	return valid(width) && valid(height) ? { width, height } : { width: 800, height: 600 };
}
