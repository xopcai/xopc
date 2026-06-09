import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { cn } from '@/lib/cn';

type LightboxImage = {
  src: string;
  alt?: string;
};

type NoteImageLightboxContextValue = {
  openImage: (src: string, alt?: string) => void;
};

const NoteImageLightboxContext = createContext<NoteImageLightboxContextValue | null>(null);

export function useNoteImageLightbox(): NoteImageLightboxContextValue {
  const ctx = useContext(NoteImageLightboxContext);
  if (!ctx) {
    return { openImage: () => {} };
  }
  return ctx;
}

export type NoteImageLightboxProviderProps = {
  children: ReactNode;
  closeLabel?: string;
};

export function NoteImageLightboxProvider({ children, closeLabel = 'Close' }: NoteImageLightboxProviderProps) {
  const [image, setImage] = useState<LightboxImage | null>(null);

  const openImage = useCallback((src: string, alt?: string) => {
    setImage({ src, alt });
  }, []);

  const value = useMemo(() => ({ openImage }), [openImage]);

  return (
    <NoteImageLightboxContext.Provider value={value}>
      {children}
      <Dialog.Root open={image !== null} onOpenChange={(open) => { if (!open) setImage(null); }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[70] bg-scrim/90 backdrop-blur-sm" />
          <Dialog.Content
            className={cn(
              'fixed inset-0 z-[71] flex items-center justify-center p-4 outline-none',
              'data-[state=open]:animate-in data-[state=closed]:animate-out',
            )}
            aria-describedby={undefined}
          >
            <Dialog.Title className="sr-only">{image?.alt || 'Image preview'}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label={closeLabel}
                className="absolute right-4 top-4 z-10 rounded-lg bg-surface-panel/80 p-2 text-fg-muted backdrop-blur transition-colors hover:bg-surface-hover hover:text-fg"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </Dialog.Close>
            {image ? (
              <img
                src={image.src}
                alt={image.alt ?? ''}
                className="max-h-[min(90vh,900px)] max-w-[min(95vw,1200px)] rounded-lg object-contain shadow-lg"
              />
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </NoteImageLightboxContext.Provider>
  );
}
