export function selectTickets(tickets, {status} = {}) { return status === undefined ? [...tickets] : tickets.filter(ticket => ticket.status === status); }
