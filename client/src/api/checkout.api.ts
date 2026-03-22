import api from './client';

// --- Types ---

export type CheckoutStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXPIRED' | 'CHECKED_IN';

export interface CheckoutRequest {
  id: string;
  secretId: string | null;
  connectionId: string | null;
  requesterId: string;
  approverId: string | null;
  status: CheckoutStatus;
  durationMinutes: number;
  reason: string | null;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
  requester: { email: string; username: string | null };
  approver?: { email: string; username: string | null } | null;
  secretName?: string | null;
  connectionName?: string | null;
}

export interface PaginatedCheckoutRequests {
  data: CheckoutRequest[];
  total: number;
}

export interface CreateCheckoutInput {
  secretId?: string;
  connectionId?: string;
  durationMinutes: number;
  reason?: string;
}

export interface ListCheckoutFilters {
  role?: 'requester' | 'approver' | 'all';
  status?: CheckoutStatus;
  limit?: number;
  offset?: number;
}

// --- API functions ---

export async function listCheckouts(filters?: ListCheckoutFilters): Promise<PaginatedCheckoutRequests> {
  const params: Record<string, string> = {};
  if (filters?.role) params.role = filters.role;
  if (filters?.status) params.status = filters.status;
  if (filters?.limit !== undefined) params.limit = String(filters.limit);
  if (filters?.offset !== undefined) params.offset = String(filters.offset);
  const { data } = await api.get('/checkouts', { params });
  return data;
}

export async function getCheckout(id: string): Promise<CheckoutRequest> {
  const { data } = await api.get(`/checkouts/${id}`);
  return data;
}

export async function requestCheckout(input: CreateCheckoutInput): Promise<CheckoutRequest> {
  const { data } = await api.post('/checkouts', input);
  return data;
}

export async function approveCheckout(id: string): Promise<CheckoutRequest> {
  const { data } = await api.post(`/checkouts/${id}/approve`);
  return data;
}

export async function rejectCheckout(id: string): Promise<CheckoutRequest> {
  const { data } = await api.post(`/checkouts/${id}/reject`);
  return data;
}

export async function checkinCheckout(id: string): Promise<CheckoutRequest> {
  const { data } = await api.post(`/checkouts/${id}/checkin`);
  return data;
}
