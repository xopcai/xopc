import { createContext } from 'react';

/** The latest round owns its recovery action; historical failures remain inspectable. */
export const RunFeedbackContext = createContext<{
  conversationId?: string;
  turnId?: string;
  error?: string | null;
  running?: boolean;
  onRetry?: () => void;
}>({});
