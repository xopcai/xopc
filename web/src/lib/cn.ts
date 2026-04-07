import { type ClassValue, clsx } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** `rounded-pill` is a theme utility; merge it with default `rounded-*` so Button + segmented thumbs stay true pills. */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      rounded: ['rounded-pill'],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
