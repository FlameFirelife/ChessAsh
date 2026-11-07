import { useEffect, useState } from 'react';

const reducedMotion = () => document.documentElement.dataset.motion === 'reduced' || matchMedia('(prefers-reduced-motion: reduce)').matches;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(reducedMotion);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(reducedMotion());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
    media.addEventListener('change', update);
    update();
    return () => { observer.disconnect(); media.removeEventListener('change', update); };
  }, []);
  return reduced;
}
