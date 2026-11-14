// Scroll reveals: any element with data-reveal="focus|fade|slide|line|card|rise|item" plays its entrance (see the
// motion section of index.css) the first time it scrolls into view. Elements added later by React (route changes,
// data arriving, opening a <details>) are picked up automatically.

import type { CSSProperties } from "react";

/** Inline style that staggers a reveal: items enter 70 ms apart (capped after 8). */
export const stagger = (i: number): CSSProperties => ({ "--i": i } as CSSProperties);

const SELECTOR = "[data-reveal]:not([data-in]):not([data-watched])";

export function startReveal(): void {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
  // No .motion class = everything renders in its final state (no support). Visitors who ask for reduced motion still
  // get reveals, but index.css turns them into plain fades (no movement, blur or wipes).
  document.documentElement.classList.add("motion");
  // Dev-only preview of the full motion on a machine set to reduce motion: open the site with ?motion
  if (import.meta.env.DEV && new URLSearchParams(window.location.search).has("motion")) {
    document.documentElement.classList.add("force-motion");
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.setAttribute("data-in", "");
        io.unobserve(e.target);
      }
    },
    { rootMargin: "0px 0px -6% 0px", threshold: 0 },
  );

  const scan = () => {
    document.querySelectorAll(SELECTOR).forEach((el) => {
      el.setAttribute("data-watched", "");
      io.observe(el);
    });
  };

  // A fast jump (anchor link, End key) can carry elements from below the viewport to above it without them ever
  // "entering" it; reveal anything already scrolled past so no blank cards are left behind.
  let sweeping = false;
  const sweepPassed = () => {
    if (sweeping) return;
    sweeping = true;
    window.setTimeout(() => {
      sweeping = false;
      document.querySelectorAll("[data-watched]:not([data-in])").forEach((el) => {
        if (el.getBoundingClientRect().bottom < 0) {
          el.setAttribute("data-in", "");
          io.unobserve(el);
        }
      });
    }, 150);
  };
  window.addEventListener("scroll", sweepPassed, { passive: true });

  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan();
    });
  }).observe(document.body, { childList: true, subtree: true });
  scan();
}
