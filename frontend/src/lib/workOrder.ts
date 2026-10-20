interface OrderedTicket {
  key: string;
  status?: string | null;
  workOrder?: number | null;
}

/** The number that puts a ticket ahead of every numbered To Do ticket: one below the lowest, never below 1. */
export const nextWorkOrder = (tickets: OrderedTicket[], key: string): number => {
  const orders = tickets
    .filter((ticket) => ticket.key !== key && ticket.status?.trim().toLowerCase() === 'to do' && ticket.workOrder != null)
    .map((ticket) => ticket.workOrder as number);
  return orders.length ? Math.max(1, Math.min(...orders) - 1) : 1;
};
