import { create } from 'zustand';
import {
  listCheckouts,
  requestCheckout as apiRequestCheckout,
  approveCheckout as apiApproveCheckout,
  rejectCheckout as apiRejectCheckout,
  checkinCheckout as apiCheckinCheckout,
} from '../api/checkout.api';
import type {
  CheckoutRequest,
  CheckoutStatus,
  CreateCheckoutInput,
  ListCheckoutFilters,
} from '../api/checkout.api';

interface CheckoutState {
  requests: CheckoutRequest[];
  total: number;
  loading: boolean;
  error: string | null;
  filters: ListCheckoutFilters;

  fetchRequests: () => Promise<void>;
  setFilters: (filters: Partial<ListCheckoutFilters>) => void;
  requestCheckout: (input: CreateCheckoutInput) => Promise<void>;
  approve: (id: string) => Promise<void>;
  reject: (id: string) => Promise<void>;
  checkin: (id: string) => Promise<void>;
}

export const useCheckoutStore = create<CheckoutState>((set, get) => ({
  requests: [],
  total: 0,
  loading: false,
  error: null,
  filters: { role: 'all' },

  fetchRequests: async () => {
    set({ loading: true, error: null });
    try {
      const result = await listCheckouts(get().filters);
      set({ requests: result.data, total: result.total });
    } catch {
      set({ error: 'Failed to load checkout requests' });
    } finally {
      set({ loading: false });
    }
  },

  setFilters: (filters: Partial<ListCheckoutFilters>) => {
    set((state) => ({ filters: { ...state.filters, ...filters } }));
  },

  requestCheckout: async (input: CreateCheckoutInput) => {
    await apiRequestCheckout(input);
    await get().fetchRequests();
  },

  approve: async (id: string) => {
    await apiApproveCheckout(id);
    await get().fetchRequests();
  },

  reject: async (id: string) => {
    await apiRejectCheckout(id);
    await get().fetchRequests();
  },

  checkin: async (id: string) => {
    await apiCheckinCheckout(id);
    await get().fetchRequests();
  },
}));

export type { CheckoutRequest, CheckoutStatus, CreateCheckoutInput };
