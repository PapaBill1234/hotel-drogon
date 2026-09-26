/**
 * Query hooks for the credits surface — the purse balance and the ledger.
 *
 * Kept apart from `useAccount` because that module owns the signed-in identity
 * and its mutations, while these two are reads of Coin state. Both are scoped to
 * the caller by the server, so neither takes a user id.
 */

import { useQuery } from '@tanstack/react-query';

import { fetchClientEntry, fetchPurse, fetchTransactions } from '../services/apiAccount';

export const creditsKeys = {
  purse: ['account', 'purse'] as const,
  transactions: ['account', 'transactions'] as const,
  clientEntry: ['account', 'client-entry'] as const,
};

/** `GET /api/account/purse` — Coin, Pixel and Point balances. */
export function usePurse() {
  return useQuery({
    queryKey: creditsKeys.purse,
    queryFn: ({ signal }) => fetchPurse(signal),
    // `AccountPage` already decides signed-in vs signed-out from `/api/me`, so a
    // 401 here is a race (the session expired between the two calls) rather than
    // something worth retrying. The retry only delays showing the truth.
    retry: false,
    staleTime: 0,
  });
}

/** `GET /api/account/transactions` — the caller's own ledger, newest first. */
export function useTransactions() {
  return useQuery({
    queryKey: creditsKeys.transactions,
    queryFn: ({ signal }) => fetchTransactions(signal),
    retry: false,
    staleTime: 0,
  });
}

/**
 * `POST /api/account/client-entry` — CSRF-protected ticket rotation and launch options.
 *
 * `staleTime: 0` and no retry, like the others: the request issues a **fresh
 * ticket** each time it runs, so a cached answer would hand the page a ticket
 * that has since been rotated.
 */
export function useClientEntry() {
  return useQuery({
    queryKey: creditsKeys.clientEntry,
    queryFn: ({ signal }) => fetchClientEntry(signal),
    retry: false,
    staleTime: 0,
  });
}
