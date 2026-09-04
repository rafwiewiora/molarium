import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser } from './headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await startMolariumBrowser({ root, appPath:'?blank=1',
  width:800, height:600, localOnly:true });
try {
  const probe = await browser.evaluate(`(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!context) throw new Error('Chrome did not expose a WebGL rendering context');
    const debug = context.getExtension('WEBGL_debug_renderer_info');
    const renderer = debug
      ? context.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : context.getParameter(context.RENDERER);
    const vendor = debug
      ? context.getParameter(debug.UNMASKED_VENDOR_WEBGL)
      : context.getParameter(context.VENDOR);
    const description = String(renderer || '');
    return { renderer:description, vendor:String(vendor || ''),
      softwareFallback:/swiftshader|llvmpipe|software/i.test(description) };
  })()`);
  if (!probe.renderer) throw new Error('Chrome did not identify its WebGL renderer');
  if (probe.softwareFallback) throw new Error(`Software rendering is forbidden: ${probe.renderer}`);
  console.log(JSON.stringify(probe, null, 2));
} finally {
  await browser.close();
}
