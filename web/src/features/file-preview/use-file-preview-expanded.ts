import { useEffect, useState } from 'react';

/** Expand previews within the app, without changing the browser or desktop window. */
export function useFilePreviewExpanded(enabled = true, escapeDisabled = false) {
  const [expanded, setExpanded] = useState(false);

  if (!enabled && expanded) setExpanded(false);

  useEffect(() => {
    if (!enabled || !expanded) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const handleKeyDown = (event: KeyboardEvent) => {
      if (escapeDisabled || event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.querySelector('[data-file-preview-menu]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setExpanded(false);
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [enabled, expanded, escapeDisabled]);

  return { expanded, setExpanded };
}
