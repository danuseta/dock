import { useMutation } from '@apollo/client';
import { CLEAR_TICKET_WORK_ORDER, SET_TICKET_MANUAL, SET_TICKET_WORK_ORDER } from '../../graphql/mutations';

/** Work order and manual work for a ticket. Each call resolves to the message the owner reads. */
export function useTicketWork(refetchQueries: string[]) {
  const options = { refetchQueries, awaitRefetchQueries: true };
  const [setTicketWorkOrder, { loading: savingOrder }] = useMutation(SET_TICKET_WORK_ORDER, options);
  const [clearTicketWorkOrder, { loading: clearingOrder }] = useMutation(CLEAR_TICKET_WORK_ORDER, options);
  const [setTicketManual, { loading: savingManual }] = useMutation(SET_TICKET_MANUAL, options);

  return {
    busy: savingOrder || clearingOrder || savingManual,
    saveOrder: async (ticketKey: string, position: number) => {
      await setTicketWorkOrder({ variables: { ticketKey, position } });
      return `${ticketKey} is #${position} in the cron's work order.`;
    },
    clearOrder: async (ticketKey: string) => {
      await clearTicketWorkOrder({ variables: { ticketKey } });
      return 'The DOCK work order is removed; a #N Jira label applies again.';
    },
    setManual: async (ticketKey: string, manual: boolean) => {
      await setTicketManual({ variables: { ticketKey, manual } });
      return manual ? `${ticketKey} is worked manually: the cron will not take or resume it.` : `${ticketKey} is back in the cron's queue.`;
    },
  };
}
