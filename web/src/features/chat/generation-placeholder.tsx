import { ImageIcon, Play } from 'lucide-react';
import type { CSSProperties } from 'react';

import { cn } from '@/lib/cn';

import './generation-placeholder.css';

const waveform = [5, 8, 11, 7, 13, 21, 11, 19, 29, 17, 24, 32, 20, 13, 23, 29, 16, 22, 13, 8, 14, 9, 5];
const frames = ['before', 'current', 'after'] as const;

export function GenerationPlaceholder({ kind, waiting = false, paused = false, className, style }: {
  kind: 'image' | 'music' | 'video' | 'preview';
  waiting?: boolean;
  paused?: boolean;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <div aria-hidden="true" data-generation-placeholder={kind} data-waiting={waiting || undefined}
      data-paused={paused || undefined} className={cn('generation-placeholder relative rounded-lg', className)} style={style}>
      {kind === 'image' && (
        <div className="generation-image-focus">
          <span className="generation-image-frame"><ImageIcon className="size-6" strokeWidth={1.4} /></span>
        </div>
      )}
      {kind === 'music' && (
        <div className="generation-waveform">
          {waveform.map((height, index) => (
            <span key={index} style={{ '--bar-height': `${height}px`, '--phase': index % 9 } as CSSProperties} />
          ))}
        </div>
      )}
      {kind === 'video' && (
        <div className="generation-filmstrip">
          {frames.map((frame, index) => (
            <span key={frame} data-frame={frame} style={{ '--phase': index } as CSSProperties}>
              {frame === 'current' && <Play className="size-3.5" strokeWidth={1.5} />}
            </span>
          ))}
        </div>
      )}
      {kind === 'preview' && (
        <div className="generation-preview-window">
          <div className="generation-preview-toolbar"><i /><i /><i /></div>
          <div className="generation-preview-body">
            <span /><span /><span />
          </div>
        </div>
      )}
    </div>
  );
}
