import {relayHostedCofold} from '../../../../server/hosted-cofold.mjs';
export function onRequest({request}){return relayHostedCofold(request);}
