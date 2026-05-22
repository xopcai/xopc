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

  const createShareLink = useCallback(async (params: CreateShareParams) => {
    setDialogOpen(true);
    setLoading(true);
    setResult(null);
    setError(null);
    try {
      const res: CreateShareResponse = await createShare(params);
      setResult(res.payload);
      return res.payload;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const resetShareLink = useCallback(() => {
    setResult(null);
    setError(null);
    setLoading(false);
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
    createShareLink,
    handleOpenChange,
  };
}
