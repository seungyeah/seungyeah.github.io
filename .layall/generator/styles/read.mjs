import fs from 'node:fs';
import { siteStyles } from './index.mjs';
export const readSiteStyles = () =>
	siteStyles.map((name) => fs.readFileSync(new URL(name, import.meta.url), 'utf8')).join('');
