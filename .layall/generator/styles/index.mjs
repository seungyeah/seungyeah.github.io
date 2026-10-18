import fs from 'node:fs';

// Order is the existing cascade. No separators or layers are inserted.
const siteStyles = [
	'foundation.css',
	'header.css',
	'article.css',
	'layouts.css',
	'note-navigation.css',
	'responsive.css',
	'code.css',
	'maps.css',
	'home.css',
	'home-activity.css',
	'books.css',
	'home-layouts.css',
	'home-responsive.css',
	'palette.css',
	'heatmap.css',
];

export const readSiteStyles = () =>
	siteStyles.map((name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8')).join('');
