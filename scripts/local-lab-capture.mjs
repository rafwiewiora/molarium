import assert from 'node:assert/strict';

/**
 * Read both the active server policy and its visible UI consequences.
 *
 * Publication captures use this instead of trusting the badge text alone: the
 * response header and CSP prove that the local server was started in Local Lab
 * mode, while the runtime config and disabled controls prove that the loaded
 * application applied that policy.
 */
export async function readLocalLabCaptureState(browser) {
  return browser.evaluate(`(async () => {
    const response = await fetch(location.href, { cache:'no-store' });
    const runtime = globalThis.MOLARIUM_RUNTIME_CONFIG || {};
    const ccdOption = document.querySelector('#preparation-ligands option[value="ccd"]');
    return {
      responsePolicy:response.headers.get('x-molarium-network-policy'),
      contentSecurityPolicy:response.headers.get('content-security-policy'),
      runtimeMode:runtime.mode || null,
      runtimeLocalOnly:runtime.localOnly === true,
      runtimePolicy:runtime.policy || null,
      allowedNetworkOrigins:[...(runtime.allowedNetworkOrigins || [])],
      documentMode:document.documentElement.dataset.networkMode || null,
      badgeMode:document.querySelector('#network-policy-button')?.dataset.networkMode || null,
      badgeLocalLab:document.querySelector('#network-policy-button')?.classList.contains('local-lab') || false,
      badgeText:document.querySelector('#network-policy-label')?.textContent?.trim() || '',
      foldDisabled:document.querySelector('#fold-protein')?.disabled === true,
      msaEndpointDisabled:document.querySelector('#msa-endpoint')?.disabled === true,
      ccdRetrievalDisabled:ccdOption?.disabled === true,
    };
  })()`);
}

export function verifyLocalLabCaptureState(state, origin = null) {
  assert.equal(state?.responsePolicy, 'local-only-v1',
    'Publication capture server is not enforcing the Local Lab response policy');
  assert.match(String(state?.contentSecurityPolicy || ''), /(?:^|;\s*)connect-src 'self'(?:;|$)/,
    'Publication capture response does not restrict network connections to self');
  assert.equal(state?.runtimeMode, 'local-lab',
    'Publication capture runtime is not in Local Lab mode');
  assert.equal(state?.runtimeLocalOnly, true,
    'Publication capture runtime permits connected features');
  assert.equal(state?.runtimePolicy, 'local-only-v1',
    'Publication capture runtime policy does not match the server policy');
  if (origin) assert.deepEqual(state?.allowedNetworkOrigins, [origin],
    'Local Lab runtime permits a network origin other than its own server');
  assert.equal(state?.documentMode, 'local-lab',
    'Publication capture document did not apply Local Lab mode');
  assert.equal(state?.badgeMode, 'local-lab',
    'Publication capture badge is not bound to Local Lab runtime state');
  assert.equal(state?.badgeLocalLab, true,
    'Publication capture badge lacks its Local Lab state class');
  assert.equal(state?.badgeText, 'Local Lab · network locked',
    'Publication capture must visibly say “Local Lab · network locked”');
  assert.doesNotMatch(state?.badgeText, /Connected features/i,
    'Publication capture visibly claims connected features');
  assert.equal(state?.foldDisabled, true,
    'Local Lab publication capture leaves the networked fold control enabled');
  assert.equal(state?.msaEndpointDisabled, true,
    'Local Lab publication capture leaves the MSA endpoint enabled');
  assert.equal(state?.ccdRetrievalDisabled, true,
    'Local Lab publication capture leaves CCD retrieval enabled');
  return Object.freeze({ ...state, verified:true });
}

export async function verifyBrowserLocalLabCapture(browser) {
  const state = await readLocalLabCaptureState(browser);
  return verifyLocalLabCaptureState(state, new URL(browser.appUrl).origin);
}
