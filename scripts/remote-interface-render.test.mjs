import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [runner, chrome] = await Promise.all([
  readFile(new URL('./run-sos1-frozen-interface-render.remote.sh', import.meta.url), 'utf8'),
  readFile(new URL('./chrome-l4-hardware.sh', import.meta.url), 'utf8'),
]);

assert.match(runner, /verify-sos1-frozen-browser-publication\.mjs/);
assert.match(runner, /--result-class complete-frozen/);
assert.match(runner, /--replay-kind "\$REPLAY_KIND"/);
assert.match(runner, /nice -n 10/);
assert.match(runner, /source\.tar\.gz/);
assert.match(runner, /git get-tar-commit-id/);
assert.match(runner, /SOURCE_ARCHIVE_SHA256/);
assert.match(runner, /sourceRun\.holdoutAccepted \| type/);
assert.match(runner, /has\("acceptedRun"\) \| not/);
assert.match(runner, /initialInterface\.moleculeInfoHidden == true/);
assert.match(runner, /initialInterface\.sceneHidden == true/);
assert.match(runner, /sourceScript\.calculationPolicy == "none"/);
assert.match(runner, /exactFullSystemCheckpoints == 4/);
assert.match(runner, /networkPolicy\.runtimeLocalOnly == true/);
assert.match(runner, /presentation\.completedInterface\.previousEnabled == true/);
assert.match(runner, /presentation\.completedInterface\.cueCount == 0/);
assert.match(runner, /SAFE_TO_STOP/);
assert.match(runner, /grep -Eq '\^NVIDIA L4,'/);
assert.doesNotMatch(runner, /run-sos1-prospective|resume-sos1|recover-sos1|evaluate-sos1/,
  'publication rendering must not rerun or evaluate science');
assert.match(chrome, /--use-angle=vulkan/);
assert.match(chrome, /--disable-software-rasterizer/);
assert.match(chrome, /VK_ICD_FILENAMES/);

console.log('Remote SOS1 interface-render setup: PASS');
