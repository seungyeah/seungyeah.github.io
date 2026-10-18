import { readConfig } from './config.mjs';
import { mountDiagramFrame } from './diagram-renderer.mjs';
const input = readConfig('[data-mermaid-frame]');
if (input) mountDiagramFrame(input, { document, window });
