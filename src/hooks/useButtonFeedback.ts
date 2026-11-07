import { useEffect } from 'react';
import { useReducedMotion } from './useReducedMotion';
import '../button-feedback.css';

type Feedback = { animations: Animation[]; timer?: ReturnType<typeof setTimeout>; held: boolean };

export function useButtonFeedback() {
  const reduced = useReducedMotion();
  useEffect(() => {
    if (reduced) return;
    const states = new Map<HTMLButtonElement, Feedback>();
    const pointers = new Map<number, HTMLButtonElement>();
    let keyboardButton: HTMLButtonElement | null = null;
    const buttonFor = (target: EventTarget | null) => {
      const button = target instanceof Element ? target.closest<HTMLButtonElement>('button') : null;
      return button && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && !button.matches('.square, .square-reference') ? button : null;
    };
    const clear = (button: HTMLButtonElement) => {
      const state = states.get(button);
      if (state) { clearTimeout(state.timer); for (const animation of state.animations) animation.cancel(); }
      states.delete(button);
      button.classList.remove('ui-feedback', 'ui-feedback-relative');
      delete button.dataset.press;
      button.style.removeProperty('--press-x'); button.style.removeProperty('--press-y');
    };
    const press = (button: HTMLButtonElement, x?: number, y?: number) => {
      clear(button);
      const box = button.getBoundingClientRect();
      button.style.setProperty('--press-x', `${x === undefined ? 50 : Math.max(0, Math.min(100, (x - box.left) / box.width * 100))}%`);
      button.style.setProperty('--press-y', `${y === undefined ? 50 : Math.max(0, Math.min(100, (y - box.top) / box.height * 100))}%`);
      if (getComputedStyle(button).position === 'static') button.classList.add('ui-feedback-relative');
      button.classList.add('ui-feedback');
      button.dataset.press = 'held';
      const state: Feedback = { animations: [], held: true };
      for (const icon of button.querySelectorAll(':scope > svg')) state.animations.push(icon.animate([
        { scale: getComputedStyle(icon).scale }, { scale: button.closest('.move-controls') ? '.82' : '.91' },
      ], { duration: 75, easing: 'ease-out', fill: 'forwards' }));
      states.set(button, state);
    };
    const release = (button: HTMLButtonElement) => {
      if (!button.isConnected || button.disabled) { clear(button); return; }
      const state = states.get(button);
      if (!state) press(button);
      const feedback = states.get(button)!;
      feedback.held = false;
      const icons = [...button.querySelectorAll(':scope > svg')];
      const scales = icons.map(icon => getComputedStyle(icon).scale);
      for (const animation of feedback.animations) animation.cancel();
      button.dataset.press = 'released';
      feedback.animations = icons.map((icon, index) => icon.animate([
        { scale: scales[index] }, { scale: '1.1', offset: .5 }, { scale: '1' },
      ], { duration: 260, easing: 'cubic-bezier(.2,.75,.25,1)' }));
      feedback.timer = setTimeout(() => clear(button), 380);
    };
    const down = (event: PointerEvent) => {
      if (event.button !== 0 || !event.isPrimary) return;
      const button = buttonFor(event.target);
      if (!button) return;
      pointers.set(event.pointerId, button);
      press(button, event.clientX, event.clientY);
    };
    const up = (event: PointerEvent) => {
      const button = pointers.get(event.pointerId);
      pointers.delete(event.pointerId);
      if (!button) return;
      const box = button.getBoundingClientRect();
      if (event.type === 'pointercancel' || event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) clear(button);
      else release(button);
    };
    const keydown = (event: KeyboardEvent) => {
      if (!['Enter', ' '].includes(event.key) || event.repeat) return;
      const button = buttonFor(event.target);
      if (button) { keyboardButton = button; press(button); }
    };
    const keyup = (event: KeyboardEvent) => {
      if (!['Enter', ' '].includes(event.key)) return;
      const button = keyboardButton ?? buttonFor(event.target);
      keyboardButton = null;
      if (button && states.get(button)?.held) release(button);
    };
    const click = (event: MouseEvent) => {
      const button = buttonFor(event.target);
      if (button && !states.has(button)) release(button);
    };
    const reset = () => { for (const button of states.keys()) clear(button); pointers.clear(); keyboardButton = null; };
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', up, true);
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('keyup', keyup, true);
    document.addEventListener('click', click, true);
    window.addEventListener('blur', reset);
    return () => {
      reset();
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', up, true);
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('keyup', keyup, true);
      document.removeEventListener('click', click, true);
      window.removeEventListener('blur', reset);
    };
  }, [reduced]);
}
