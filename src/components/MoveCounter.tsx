import { useLayoutEffect, useRef } from 'react';
import { useReducedMotion } from '../hooks/useReducedMotion';

export default function MoveCounter({ position, total }: { position: number; total: number }) {
  const value = useRef<HTMLSpanElement>(null);
  const previous = useRef(position);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const direction = Math.sign(position - previous.current);
    previous.current = position;
    if (!direction || reduced || !value.current) return;
    const number = value.current.animate([
      { opacity: .45, transform: `translateY(${direction * 5}px)` },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 190, easing: 'cubic-bezier(.16,.8,.24,1)' });
    const arrow = value.current.closest('.move-controls')?.querySelector(`[data-step="${direction > 0 ? 'next' : 'previous'}"] svg`);
    const feedback = arrow?.animate([
      { transform: 'translateX(0)' },
      { transform: `translateX(${direction * 3}px)`, offset: .35 },
      { transform: 'translateX(0)' },
    ], { duration: 210, easing: 'ease-out' });
    return () => { number.cancel(); feedback?.cancel(); };
  }, [position, reduced]);
  return <span className="move-counter"><span ref={value} className="move-counter-value">{position}</span><span>/{total}</span></span>;
}
