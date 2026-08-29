import { create } from 'zustand';

interface TicketState {
  activeFilter: string;
  cachedTickets: any[];
  selectedTicket: any | null;
  setActiveFilter: (filter: string) => void;
  setCachedTickets: (tickets: any[]) => void;
  setSelectedTicket: (ticket: any | null) => void;
}

export const useTicketStore = create<TicketState>((set) => ({
  activeFilter: 'ALL',
  cachedTickets: [],
  selectedTicket: null,
  setActiveFilter: (filter) => set({ activeFilter: filter }),
  setCachedTickets: (tickets) => set({ cachedTickets: tickets }),
  setSelectedTicket: (ticket) => set({ selectedTicket: ticket }),
}));
