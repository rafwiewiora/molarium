import {startPublicReview} from './public-review.mjs';
startPublicReview().catch(e=>{document.querySelector('#status').textContent=e.message;});
