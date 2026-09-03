import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildValidationRegistry, repositoryRoot, stableRegistryJson } from './registry-builder.mjs';

const output = resolve(repositoryRoot, 'validation/registry.v0.2.json');
const registry = await buildValidationRegistry();
await writeFile(output, stableRegistryJson(registry));
console.log(`Wrote validation/registry.v0.2.json: ${registry.headline.registeredDockingCases} cases, ${registry.headline.distinctReferenceSystems} reference systems, ${registry.headline.uniqueProteinTargets} targets`);
