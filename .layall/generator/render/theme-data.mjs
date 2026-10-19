export const themeOrder = ['layall', 'blog', 'minimal', 'portfolio', 'docs'];
export const themeNames = new Set(themeOrder);
// Stable storage/layout IDs; only the visitor-facing palette names change.

export const tokenSets = {
	root: {
		'font-scale': '1',
		'font-ui': 'ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
		paper: '#f7f3ea',
		surface: '#fffdf8',
		'surface-2': '#eee7da',
		ink: '#292723',
		muted: '#716d65',
		line: '#ded6c7',
		accent: '#716690',
		'accent-soft': '#e8e1f3',
		shadow: '0 18px 60px rgba(65,55,43,.09)',
		radius: '22px',
		content: '1180px',
	},
	dark: {
		paper: '#1d1c1a',
		surface: '#272521',
		'surface-2': '#33302a',
		ink: '#f2eee6',
		muted: '#bbb3a7',
		line: '#454139',
		accent: '#c8b9ec',
		'accent-soft': '#3b344b',
		shadow: '0 18px 60px rgba(0,0,0,.28)',
	},
	layall: {
		'font-scale': '1',
		'font-ui':
			'"TmoneyRoundWindRegular","Tmoney RoundWind","티머니 둥근바람",ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
		paper: '#f6f4f0',
		surface: '#fffdf8',
		'surface-2': '#e8f7fb',
		ink: '#354146',
		muted: '#566b72',
		line: '#d9e4e2',
		accent: '#566b72',
		'accent-soft': '#dff2f6',
		shadow: '0 22px 58px rgba(69,88,93,.13)',
		radius: '20px',
		content: '1180px',
	},
	blog: {
		paper: '#fff',
		surface: '#fff',
		'surface-2': '#f6f8fa',
		ink: '#24292f',
		muted: '#57606a',
		line: '#d0d7de',
		accent: '#286a47',
		'accent-soft': '#ddf4e5',
		radius: '12px',
	},
	minimal: {
		paper: '#fff',
		surface: '#fff',
		'surface-2': '#f5f5f3',
		ink: '#20201e',
		muted: '#74746e',
		line: '#e5e5e0',
		accent: '#20201e',
		'accent-soft': '#efefeb',
		content: '760px',
	},
	portfolio: {
		paper: '#f0efe9',
		surface: '#fbfaf6',
		'surface-2': '#e4e1d8',
		ink: '#242522',
		muted: '#6d7068',
		line: '#d7d4ca',
		accent: '#556846',
		'accent-soft': '#dce6d3',
		radius: '32px',
	},
	docs: {
		paper: '#fbfcfd',
		surface: '#fff',
		'surface-2': '#f1f4f7',
		ink: '#1f2933',
		muted: '#68727e',
		line: '#e1e7ec',
		accent: '#3973a8',
		'accent-soft': '#e5f1fb',
		content: '1380px',
	},
	layallDark: {
		paper: '#17262d',
		surface: '#21343b',
		'surface-2': '#29434c',
		ink: '#edf6f5',
		muted: '#aec4c8',
		line: '#38535c',
		accent: '#aec4c8',
		'accent-soft': '#294b55',
		shadow: '0 22px 58px rgba(0,0,0,.28)',
	},
};

// Palette chips, site CSS and Giscus resolve the same accent values/formula.
const names = { layall: '청록', blog: '초록', minimal: '차콜', portfolio: '올리브', docs: '파랑' };
const darkAccents = {
	layall: tokenSets.layallDark.accent,
	blog: '#8dcca4',
	minimal: '#d8d8d2',
	portfolio: '#b3c69d',
	docs: '#9ac4e9',
};
export const palettes = Object.fromEntries(
	themeOrder.map((name) => [
		name,
		{
			name: names[name],
			primary: tokenSets[name].accent,
			dark: darkAccents[name],
		},
	])
);
export function darkAccentTokens(name, surface = 'var(--surface)') {
	const accent = palettes[name].dark;
	return { accent, 'accent-soft': `color-mix(in srgb,${accent} 16%,${surface})` };
}
export function themeTokens(name, mode) {
	if (!themeOrder.includes(name) || !['light', 'dark'].includes(mode))
		throw new Error('unknown theme');
	const tokens = { ...tokenSets.root, ...tokenSets[name] };
	if (mode === 'dark') {
		Object.assign(tokens, tokenSets.dark, name === 'layall' ? tokenSets.layallDark : {});
		Object.assign(tokens, darkAccentTokens(name, tokens.surface));
	}
	return tokens;
}
