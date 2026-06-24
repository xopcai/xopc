import { useCallback, useState } from 'react';

import { requestTextAssist, type TextAssistRequest } from './ai-text-assist-api';

export function useAiTextAssist() {
  const [suggestion, setSuggestion] = useState('');
  const [thinking, setThinking] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async (request: TextAssistRequest) => {
    setLoading(true);
    setError(null);
    setSuggestion('');
    setThinking('');
    try {
      const result = await requestTextAssist(request, {
        onDelta: (delta) => {
          setSuggestion((current) => current + delta);
        },
        onThinkingDelta: (delta) => {
          setThinking((current) => current + delta);
        },
      });
      setSuggestion(result.text);
      setThinking(result.thinking ?? '');
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
    setThinking('');
    setError(null);
    setLoading(false);
  }, []);

  return { suggestion, thinking, loading, error, generate, reset };
}
