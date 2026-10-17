import { readConfig } from './config.mjs';
import { mountDownload } from './download.mjs';
void mountDownload(readConfig('[data-download-config]'));
