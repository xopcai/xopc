import {selectTickets} from './query.mjs';import {page} from './pagination.mjs';
export function listTickets(tickets, options = {}) { return page(selectTickets(tickets, options), options); }
