import fs from 'node:fs';
import { themeTokens } from './tokens.mjs';
const template = fs.readFileSync(new URL('../styles/giscus.css', import.meta.url), 'utf8');
const fillTemplate = (values) =>
	template.replace(/__[A-Z_]+__/g, (slot) => {
		if (!(slot in values)) throw new Error('unknown giscus CSS slot');
		return values[slot];
	});

export const giscusCss = (name, mode, { absolute, omyuFontPath }) => {
	const tokens = themeTokens(name, mode);
	const giscusSurface =
		name === 'layall'
			? `color-mix(in srgb,${tokens.muted} 14%,${tokens.surface})`
			: tokens.surface;
	const giscusSurface2 =
		name === 'layall'
			? `color-mix(in srgb,${tokens.muted} 22%,${tokens.surface})`
			: tokens['surface-2'];
	const giscusAccentSoft =
		name === 'layall'
			? `color-mix(in srgb,${tokens.muted} 18%,${tokens.surface})`
			: tokens['accent-soft'];
	const font =
		name === 'layall'
			? '"Omyu Pretty",ui-sans-serif,system-ui,sans-serif'
			: 'ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif';
	const vars = {};
	const assign = (names, value) => names.split(' ').forEach((key) => (vars[key] = value));
	assign(
		'fg-default text-primary btn-text prettylights-syntax-markup-bold prettylights-syntax-markup-italic prettylights-syntax-storage-modifier-import',
		tokens.ink
	);
	assign(
		'fg-muted fg-subtle text-secondary text-tertiary diff-blob-num-text diff-blob-num-hover-text prettylights-syntax-comment prettylights-syntax-brackethighlighter-angle prettylights-syntax-sublimelinter-gutter-mark',
		tokens.muted
	);
	assign(
		'canvas-default canvas-overlay bg-canvas bg-primary bg-overlay input-bg segmented-control-button-bg',
		giscusSurface
	);
	assign(
		'canvas-inset canvas-subtle bg-canvas-inset bg-secondary bg-tertiary btn-bg btn-selected-bg input-contrast-bg hidden-text-expander-bg segmented-control-bg',
		giscusSurface2
	);
	assign(
		'border-default border-muted border-primary border-secondary border-tertiary input-border label-border btn-border btn-primary-border btn-primary-disabled-border segmented-control-button-selected-border',
		tokens.line
	);
	assign(
		'accent-fg accent-emphasis text-link btn-hover-border btn-active-border btn-primary-bg btn-primary-hover-bg btn-primary-hover-border btn-primary-selected-bg border-info box-border-info prettylights-syntax-keyword prettylights-syntax-constant prettylights-syntax-entity prettylights-syntax-entity-tag prettylights-syntax-string prettylights-syntax-string-regexp prettylights-syntax-variable prettylights-syntax-markup-heading prettylights-syntax-constant-other-reference-link prettylights-syntax-meta-diff-range',
		tokens.accent
	);
	// Retain the concurrent layall button-color change without reordering CSS declarations.
	if (name === 'layall')
		assign('btn-primary-bg btn-primary-hover-bg btn-primary-selected-bg', tokens.muted);
	assign(
		'accent-subtle accent-muted neutral-muted bg-info social-reaction-bg-hover social-reaction-bg-reacted-hover btn-hover-bg btn-active-bg btn-primary-disabled-bg action-list-item-default-hover-bg',
		giscusAccentSoft
	);
	assign('btn-primary-text', mode === 'dark' ? tokens.paper : '#ffffff');
	assign('btn-primary-disabled-text', tokens.muted);
	assign('scale-gray-1', giscusSurface2);
	assign('scale-blue-1', giscusAccentSoft);
	assign(
		'btn-shadow btn-inset-shadow btn-primary-shadow btn-primary-inset-shadow btn-primary-selected-shadow primer-shadow-inset',
		'none'
	);
	const danger = mode === 'dark' ? '#ffb4ab' : '#a52a26';
	const success = mode === 'dark' ? '#8dcca4' : '#286a47';
	const attention = mode === 'dark' ? '#efd064' : '#805b08';
	assign('danger-fg text-danger prettylights-syntax-brackethighlighter-unmatched', danger);
	assign('success-fg text-success prettylights-syntax-markup-inserted-text', success);
	assign(
		'attention-fg prettylights-syntax-markup-list prettylights-syntax-markup-changed-text',
		attention
	);
	assign(
		'danger-muted danger-subtle prettylights-syntax-invalid-illegal-bg prettylights-syntax-carriage-return-bg prettylights-syntax-markup-deleted-bg',
		`color-mix(in srgb,${danger} 12%,${tokens.surface})`
	);
	assign(
		'attention-muted attention-subtle prettylights-syntax-markup-changed-bg',
		`color-mix(in srgb,${attention} 12%,${tokens.surface})`
	);
	assign(
		'prettylights-syntax-markup-inserted-bg',
		`color-mix(in srgb,${success} 12%,${tokens.surface})`
	);
	assign(
		'prettylights-syntax-invalid-illegal-text prettylights-syntax-carriage-return-text prettylights-syntax-markup-deleted-text',
		danger
	);
	assign('prettylights-syntax-markup-ignored-text', tokens.ink);
	assign('prettylights-syntax-markup-ignored-bg', tokens['surface-2']);
	const radius = { layall: '12px', blog: '8px', minimal: '0px', portfolio: '20px', docs: '6px' }[
		name
	];
	const surface = name === 'layall' ? giscusSurface2 : tokens.surface;
	return `/* LayAll ${name} ${mode}. First-party giscus custom theme; no external imports. */
${name === 'layall' ? `@font-face{font-family:"Omyu Pretty";src:url(${JSON.stringify(absolute(`/${omyuFontPath}`))}) format("woff2");font-style:normal;font-weight:400;font-display:swap}` : ''}
:root{color-scheme:${mode};font-size:16px;--layall-type-scale:${name === 'layall' ? 1.125 : 1};--font-family-default:${font};--font-family-sans:${font};--font-family-monospace:${name === 'layall' ? font : 'ui-monospace,SFMono-Regular,Consolas,monospace'};${Object.entries(
		vars
	)
		.map(([key, value]) => `--color-${key}:${value}`)
		.join(';')}}
${fillTemplate({
	__RAIL__: tokens.line,
	__RADIUS__: radius,
	__SURFACE__: surface,
	__MINIMAL__:
		name === 'minimal'
			? '.gsc-comment>div:first-child{border-width:0;background:transparent}.gsc-comment-header{padding-left:0;padding-right:0}.gsc-comment-content,.gsc-comment-footer{padding-left:0;padding-right:0}'
			: '',
	__BORDERED_HEADER__:
		name === 'blog' || name === 'docs'
			? '.gsc-comment-header{border-bottom:1px solid var(--color-border-default);background:var(--color-canvas-subtle);border-radius:var(--layall-radius) var(--layall-radius) 0 0}'
			: '',
	__MOBILE_SCALE__: name === 'layall' ? 1.0546875 : 0.9375,
})}`;
};
