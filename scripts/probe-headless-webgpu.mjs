import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMolariumBrowser } from './headless-chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const browser = await startMolariumBrowser({ root, appPath:'?blank=1',
  width:800, height:600, localOnly:true });
try {
  const probe = await browser.evaluate(`(async () => {
    if (!navigator.gpu) throw new Error('navigator.gpu is unavailable');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference:'high-performance' });
    if (!adapter) throw new Error('requestAdapter returned null');
    const device = await adapter.requestDevice();
    const result = {
      isFallbackAdapter:Boolean(adapter.isFallbackAdapter),
      maxStorageBuffersPerShaderStage:Number(adapter.limits.maxStorageBuffersPerShaderStage),
      deviceLost:Boolean((await Promise.race([
        device.lost.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 100)),
      ]))),
    };
    device.destroy();
    return result;
  })()`);
  if (probe.deviceLost) throw new Error('The probed WebGPU device was lost immediately');
  if (probe.maxStorageBuffersPerShaderStage < 9)
    throw new Error(`WebGPU exposes only ${probe.maxStorageBuffersPerShaderStage} storage buffers; Molarium requires 9`);
  console.log(`Headless WebGPU probe: PASS · fallback ${probe.isFallbackAdapter} · ${probe.maxStorageBuffersPerShaderStage} storage buffers`);
} finally {
  await browser.close();
}
