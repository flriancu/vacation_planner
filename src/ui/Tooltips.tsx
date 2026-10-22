import { useEffect, useRef } from 'react';

const SHOW_DELAY_MS = 400;
const HIDE_DELAY_MS = 120;
const GAP = 8;

/**
 * The app's one tooltip, for every element with `data-tip` (instead of the browser's `title`,
 * which looks different everywhere and never matches the app). WCAG 1.4.13: shows on hover after
 * a short delay and at once on keyboard focus; stays while the pointer moves onto it; Escape
 * dismisses it without moving focus. It lives in the top layer (popover), so it also shows above
 * the editor dialog. Tooltips repeat what the element's accessible name already says.
 */
export function Tooltips() {
  const tip = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = tip.current!;
    const topLayer = typeof el.showPopover === 'function';
    let target: HTMLElement | null = null;
    let showTimer: number | undefined;
    let hideTimer: number | undefined;
    let pressing = false;
    // The shown element's text may change while it shows (another tab switches the language,
    // a plan reloads): the tooltip follows it.
    const watch = new MutationObserver(() => target && isOpen() && place(target));

    const isOpen = () => (topLayer ? el.matches(':popover-open') : el.classList.contains('open'));

    const place = (t: HTMLElement) => {
      el.textContent = t.dataset.tip ?? '';
      if (!isOpen()) {
        if (topLayer) el.showPopover();
        else el.classList.add('open');
      }
      const r = t.getBoundingClientRect();
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // Above if it fits, else below if it fits, else as low as it can go and still be whole.
      const top = r.top - h - GAP >= GAP ? r.top - h - GAP : Math.max(GAP, Math.min(r.bottom + GAP, window.innerHeight - h - GAP));
      const left = Math.max(GAP, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - GAP));
      el.style.top = `${top}px`;
      el.style.left = `${left}px`;
      watch.disconnect();
      watch.observe(t, { attributes: true, attributeFilter: ['data-tip'] });
    };

    const hide = (delay: number) => {
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        target = null;
        watch.disconnect();
        if (!isOpen()) return;
        if (topLayer) el.hidePopover();
        else el.classList.remove('open');
      }, delay);
    };

    const show = (t: HTMLElement, delay: number) => {
      window.clearTimeout(hideTimer);
      window.clearTimeout(showTimer);
      target = t;
      showTimer = window.setTimeout(() => target === t && t.isConnected && place(t), delay);
    };

    const tipOf = (node: EventTarget | null) => (node instanceof Element ? node.closest<HTMLElement>('[data-tip]') : null);

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === 'touch' || pressing) return;
      if (el.contains(e.target as Node)) {
        window.clearTimeout(hideTimer); // hoverable: the pointer may move onto the tooltip
        return;
      }
      const t = tipOf(e.target);
      if (t?.dataset.tip) {
        if (t !== target) show(t, isOpen() ? 0 : SHOW_DELAY_MS);
      } else if (target) {
        hide(HIDE_DELAY_MS);
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      const t = tipOf(e.target);
      if (t?.dataset.tip && t.matches(':focus-visible')) show(t, 0);
      else hide(0);
    };
    const onFocusOut = () => hide(0);
    const onDown = () => {
      pressing = true; // no tooltips while clicking or dragging across days
      hide(0);
    };
    const onUp = () => {
      pressing = false;
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isOpen()) return;
      // First Escape only dismisses the tooltip (WCAG 1.4.13); the next one reaches the page.
      e.preventDefault();
      e.stopPropagation();
      hide(0);
    };
    const onScroll = () => hide(0);

    document.addEventListener('pointerover', onOver);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      watch.disconnect();
      window.clearTimeout(showTimer);
      window.clearTimeout(hideTimer);
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, []);

  return <div ref={tip} className="tooltip" popover="manual" role="tooltip" />;
}
