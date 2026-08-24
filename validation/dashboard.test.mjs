import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validationDashboardHtml } from './dashboard.mjs';

const registry = JSON.parse(await readFile(new URL('./registry.v0.1.json', import.meta.url)));
const html = validationDashboardHtml(registry);
assert.match(html, /18<\/strong><span>reference complexes/);
assert.match(html, /25<\/strong><span>registered cases/);
assert.match(html, /15<\/strong><span>protein targets/);
assert.match(html, /5<\/strong><span>crystal-scored/);
assert.match(html, /25 preserved outcomes/);
assert.match(html, /Registered · partial/);
assert.match(html, /vacuum-versus-OBC2 protocol mismatch/);
assert.equal((html.match(/data-validation-tier=/g) || []).length, 25);

const hostile = structuredClone(registry);
hostile.cases[0].transformation = '<img src=x onerror=alert(1)>';
const escaped = validationDashboardHtml(hostile);
assert.ok(!escaped.includes('<img src=x'));
assert.ok(escaped.includes('&lt;img src=x'));
console.log('Validation dashboard renderer: PASS');
