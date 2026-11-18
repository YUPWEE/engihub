import type { CSSProperties } from "react";

export const stagger = (i: number): CSSProperties => ({ "--i": i } as CSSProperties);

const SELECTOR = "[data-reveal]:not([data-in]):not([data-watched])";

export function startReveal(): void {
  if (typeof window === "undefined" || !("IntersectionObserver" in window)) return;
  document.documentElement.classList.add("motion");
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
