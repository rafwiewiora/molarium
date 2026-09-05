import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser, waitFor } from './headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await startMolariumBrowser({ root, appPath:'?blank=1',
  width:800, height:600, localOnly:true });
try {
  // Chrome can publish the page target just before its first execution context
  // is ready after a cold VM start. Reuse the browser helper's bounded wait
  // rather than treating that DevTools startup race as an adapter failure.
  const probe = await waitFor(() => browser.evaluate(`(() => {
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
  })()`), 15000, 'headless WebGL execution context');
  if (!probe.renderer) throw new Error('Chrome did not identify its WebGL renderer');
  if (probe.softwareFallback) throw new Error(`Software rendering is forbidden: ${probe.renderer}`);
  console.log(JSON.stringify(probe, null, 2));
} finally {
  await browser.close();
}
