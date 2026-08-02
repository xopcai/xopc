import { useCallback, useState } from 'react';

import {
  createShare,
  type CreateShareParams,
  type CreateShareResponse,
} from '@/features/shares/shares-api';
import type { ShareLinkResult } from '@/features/shares/share-link-dialog';

export function useShareLink() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ShareLinkResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingParams, setPendingParams] = useState<CreateShareParams | null>(null);

  const createShareLink = useCallback((params: CreateShareParams) => {
    setDialogOpen(true);
    setPendingParams(params);
    setResult(null);
    setError(null);
  }, []);

  const confirmShareLink = useCallback(async (options?: Pick<CreateShareParams, 'ttlMs' | 'maxViews' | 'description'>) => {
    if (!pendingParams || loading) return null;
    setLoading(true);
    setError(null);
    try {
      const res: CreateShareResponse = await createShare({ ...pendingParams, ...options });
      setResult(res.payload);
      return res.payload;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, [loading, pendingParams]);

  const resetShareLink = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
    setPendingParams(null);
  }, []);

  const handleOpenChange = useCallback(
    (open: boolean) => {
      setDialogOpen(open);
      if (!open) resetShareLink();
    },
    [resetShareLink],
  );

  return {
    dialogOpen,
    loading,
    result,
    error,
    pendingParams,
    createShareLink,
    confirmShareLink,
    handleOpenChange,
  };
}
