import { readConfig } from './config.mjs';
import { registerWorker } from './pwa.mjs';
import { mountSite } from './site.mjs';
const config = readConfig('[data-site-config]');
if (config) {
	mountSite(config, readConfig('[data-discussion-config]'));
	registerWorker(config.pwa);
}
