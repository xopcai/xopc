'use client';

import { useEffect, useId, useRef } from 'react';

import { animateLoopi, type LoopiMood } from './loopi-motion';
import './loopi.css';

export type { LoopiMood } from './loopi-motion';

const ai = 'M317.464 214.54 A120 120 0 1 1 175.46 72.536';
const human = 'M229.437 73.667 A120 120 0 0 1 316.333 160.563';
const core = 'M130 190 C130 153 156 131 200 131 C244 131 270 153 270 190 C270 229 244 250 200 250 C156 250 130 229 130 190Z';

/** Loopi is a companion, not a replacement for a person's profile image. */
export function Loopi({ mood = 'idle', variant = 'hero', interactive = false, cycle = false, language = 'en', className = '' }: {
  mood?: LoopiMood; variant?: 'hero' | 'avatar'; interactive?: boolean;
  cycle?: boolean; language?: 'en' | 'zh'; className?: string;
}) {
  const id = useId().replace(/:/g, '');
  const host = useRef<HTMLSpanElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const paint = (name: string) => `url(#${id}-${name})`;
  useEffect(() => {
    if (!svg.current || !host.current) return;
    const controller = animateLoopi(svg.current, host.current, {
      mood, avatar: variant === 'avatar', ambient: interactive, cycle: interactive && cycle,
    });
    return () => controller.dispose();
  }, [mood, variant, interactive, cycle]);
  const drawing = (
    <svg ref={svg} viewBox={variant === 'avatar' ? '48 38 304 304' : '0 0 400 400'} aria-hidden="true" focusable="false" data-loopi="ceramic-v3" data-face-rotation="0">
      <defs>
        <linearGradient id={`${id}-ceramic`} x1="100" y1="65" x2="280" y2="330" gradientUnits="userSpaceOnUse"><stop className="loopi-ceramic-top" stopColor="#41494C" /><stop offset=".48" className="loopi-ceramic-mid" stopColor="#30383C" /><stop offset="1" className="loopi-ceramic-bottom" stopColor="#3B4449" /></linearGradient>
        <linearGradient id={`${id}-enamel`} x1="230" y1="63" x2="326" y2="170" gradientUnits="userSpaceOnUse"><stop stopColor="#6C9FF6" /><stop offset="1" stopColor="#387DE5" /></linearGradient>
        <linearGradient id={`${id}-porcelain`} x1="180" y1="127" x2="218" y2="247" gradientUnits="userSpaceOnUse"><stop stopColor="#FFFEF9" /><stop offset=".65" stopColor="#F6F3EB" /><stop offset="1" stopColor="#EAE6DC" /></linearGradient>
        <linearGradient id={`${id}-edge`} x1="170" y1="50" x2="224" y2="310" gradientUnits="userSpaceOnUse"><stop stopColor="#fff" stopOpacity=".36" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
        <filter id={`${id}-shadow`} x="-40%" y="-40%" width="180%" height="200%"><feDropShadow dx="0" dy="4" stdDeviation="4" floodColor="#39473E" floodOpacity=".09" /></filter>
      </defs>
      {variant === 'hero' && <ellipse cx="200" cy="349" rx="67" ry="4" fill="currentColor" opacity=".05" />}
      <g data-part="ring">
        <g fill="none" strokeWidth="35" strokeLinecap="round" transform="translate(0 3)"><path stroke="#232C30" d={ai} /><path stroke="#2866C4" d={human} /></g>
        <g fill="none" strokeWidth="35" strokeLinecap="round" filter={paint('shadow')}><path stroke={paint('ceramic')} d={ai} /><path stroke={paint('enamel')} d={human} /></g>
        <g fill="none" strokeWidth="1.2" strokeLinecap="round" opacity=".75"><path stroke={paint('edge')} d="M332.445 223.022 A136.5 136.5 0 1 1 166.978 57.555" /><path stroke="#D9E8FF" opacity=".5" d="M237.624 58.788 A136.5 136.5 0 0 1 331.212 152.376" /></g>
        <path data-part="cue" fill="none" stroke="#9ABFFF" strokeWidth="2" strokeLinecap="round" opacity="0" d="M258.163 59.363 A143 143 0 0 1 323.842 118.5" />
      </g>
      <g data-part="core"><g data-part="shape">
        <path d={core} fill="#DCDDD3" opacity=".5" transform="translate(0 2)" />
        <path d={core} fill={paint('porcelain')} stroke="#fff" strokeOpacity=".8" filter={paint('shadow')} />
      </g><g data-part="face">
        <g data-part="cheeks" opacity="0"><ellipse cx="168" cy="207" rx="8" ry="3.5" fill="#E8B8A5" /><ellipse cx="232" cy="207" rx="8" ry="3.5" fill="#E8B8A5" /></g>
        {[179, 221].map((cx, i) => <g key={cx} data-part={i ? 'right' : 'left'}>
          <ellipse cx={cx} cy="188" rx="4.4" ry="6.2" fill="#293236" />
          <circle cx={cx + 1} cy="186" r=".9" fill="#FFFEFA" />
          <path d={`M${cx - 5} 188 Q${cx} 181 ${cx + 5} 188`} fill="none" stroke="#293236" strokeWidth="2.8" strokeLinecap="round" opacity="0" />
        </g>)}
        <path data-part="mouth" d="M193 207 Q200 213 207 207" fill="none" stroke="#293236" strokeWidth="2.5" strokeLinecap="round" />
      </g></g>
    </svg>
  );
  return <span ref={host} className={`loopi loopi--${variant} ${className}`}>
    {interactive ? <button className="loopi-touch" type="button" aria-label={language === 'zh' ? '和小环打个招呼' : 'Say hello to Loopi'}>{drawing}</button> : drawing}
  </span>;
}
