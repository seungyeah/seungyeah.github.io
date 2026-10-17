import { createMarkdown } from '../render/markdown.mjs';
import { readConfig } from './config.mjs';
import { mountProtected } from './protected.mjs';
const config = readConfig('[data-site-config]');
const envelope = readConfig('[data-protected-envelope]');
if (envelope)
	mountProtected(
		envelope,
		createMarkdown({ href: (value) => config.basePath + value }).renderMarkdown
	);
