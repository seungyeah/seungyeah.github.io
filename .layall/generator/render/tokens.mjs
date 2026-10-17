import { palettes, themeOrder, tokenSets } from './theme-data.mjs';

export function themeTokens(name, mode) {
	if (!themeOrder.includes(name) || !['light', 'dark'].includes(mode))
		throw new Error('unknown theme');
	const tokens = { ...tokenSets.root, ...tokenSets[name] };
	if (mode === 'dark') {
		Object.assign(tokens, tokenSets.dark, name === 'layall' ? tokenSets.layallDark : {});
		tokens.accent = palettes[name].dark;
		tokens['accent-soft'] = `color-mix(in srgb,${tokens.accent} 16%,${tokens.surface})`;
	}
	return tokens;
}
