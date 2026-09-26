/**
 * Query hooks for the credits surface — the purse balance and the ledger.
 *
 * Kept apart from `useAccount` because that module owns the signed-in identity
 * and its mutations, while these two are reads of Coin state. Both are scoped to
 * the caller by the server, so neither takes a user id.
 */

import { useQuery } from '@tanstack/react-query';

import { fetchPurse, fetchTransactions } from '../services/apiAccount';

export const creditsKeys = {
  purse: ['account', 'purse'] as const,
  transactions: ['account', 'transactions'] as const,
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
