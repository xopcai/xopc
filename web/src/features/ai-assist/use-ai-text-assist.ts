import { useCallback, useState } from 'react';

import { requestTextAssist, type TextAssistRequest } from './ai-text-assist-api';

export function useAiTextAssist() {
  const [suggestion, setSuggestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (request: TextAssistRequest) => {
    setLoading(true);
    setError(null);
    setSuggestion('');
    try {
      const result = await requestTextAssist(request, {
        onDelta: (delta) => {
          setSuggestion((current) => current + delta);
        },
      });
      setSuggestion(result.text);
      return result.text;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI suggestion failed';
      setError(message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const reset = useCallback(() => {
    setSuggestion('');
    setError(null);
    setLoading(false);
  }, []);

  return { suggestion, loading, error, generate, reset };
}
