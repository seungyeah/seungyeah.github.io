import { palettes, themeOrder, tokenSets } from './theme-data.mjs';

export function siteCss(source, fontUrl) {
	const declarations = (tokens) =>
		Object.entries(tokens)
			.map(([key, value]) => `--${key}:${value};`)
			.join('');
	let css = source.replaceAll('__FONT_URL__', JSON.stringify(fontUrl));
	for (const [name, tokens] of Object.entries(tokenSets))
		css = css.replaceAll(`/* @tokens:${name} */`, declarations(tokens));
	css = css.replace(
		'/* @palette:dark */',
		themeOrder
			.map(
				(name) =>
					`[data-palette="${name}"]{--palette-primary:${palettes[name].primary};--palette-dark:${palettes[name].dark}}html[data-theme=${name}][data-color-mode=dark]{--accent:${palettes[name].dark};--accent-soft:color-mix(in srgb,${palettes[name].dark} 16%,var(--surface))}`
			)
			.join('')
	);
	css = css.replace(
		'/* @palette:system */',
		themeOrder
			.map(
				(name) =>
					`html[data-theme=${name}][data-color-mode=system]{--accent:${palettes[name].dark};--accent-soft:color-mix(in srgb,${palettes[name].dark} 16%,var(--surface))}`
			)
			.join('')
	);
	if (/__FONT_URL__|@palette:|@tokens:/.test(css)) throw new Error('unresolved stylesheet slot');
	return css;
}
