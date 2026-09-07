"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useTour } from "@/lib/tour/useTour";

/**
 * The highlight and the card.
 *
 * The anchor is found by attribute rather than by ref, so a tool never has to
 * know the tour exists — the only thing added to the five tools is an inert
 * `data-tour` attribute.
 *
 * A missing anchor is deliberately not an error: the card shows centred with
 * no ring. A control that moved should cost a slightly worse explanation, not
 * a broken page. `steps.test.ts` is what makes sure that never ships silently.
 */

interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

const PADDING = 6;

export function TourOverlay() {
  const { step, chapterTitle, index, total, next, back, stop } = useTour();
  const [box, setBox] = useState<Box | null>(null);

  useEffect(() => {
    if (!step) {
      setBox(null);
      return;
    }

    const locate = () => {
      const target = document.querySelector(`[data-tour="${step.anchor}"]`);
      if (!target) {
        setBox(null);
        return;
      }
      const rect = target.getBoundingClientRect();
      setBox({
        top: rect.top - PADDING,
        left: rect.left - PADDING,
        width: rect.width + PADDING * 2,
        height: rect.height + PADDING * 2,
      });
    };

    const locateAndScroll = () => {
      const target = document.querySelector(`[data-tour="${step.anchor}"]`);
      target?.scrollIntoView({ block: "center", behavior: "smooth" });
      locate();
    };

    // The route may still be settling after a step that navigates, so look
    // once now and once shortly after rather than assuming the element is
    // already mounted.
    locateAndScroll();
    const retry = setTimeout(locateAndScroll, 350);
    window.addEventListener("resize", locate);
    window.addEventListener("scroll", locate, true);
    return () => {
      clearTimeout(retry);
      window.removeEventListener("resize", locate);
      window.removeEventListener("scroll", locate, true);
    };
  }, [step]);

  useEffect(() => {
    if (!step) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") stop();
      if (event.key === "ArrowRight") next();
      if (event.key === "ArrowLeft") back();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [back, next, step, stop]);

  return (
    <AnimatePresence>
      {step ? (
        <motion.div
          className="fixed inset-0 z-50"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* The scrim. Clicking it leaves the tour, as the Data panel does. */}
          <div className="absolute inset-0 bg-charcoal/40" onClick={stop} />

          {box ? (
            <motion.div
              className="pointer-events-none absolute rounded-md ring-2 ring-gold ring-offset-2"
              style={{ top: box.top, left: box.left, width: box.width, height: box.height }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2 }}
            />
          ) : null}

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={`${chapterTitle}: ${step.title}`}
            className="absolute bottom-6 left-1/2 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 rounded-lg border border-charcoal/10 bg-parchment p-5 shadow-2xl"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <div className="mb-2 flex items-start justify-between gap-3">
              <p className="text-xs tracking-widest text-slate uppercase">{chapterTitle}</p>
              <button
                type="button"
                onClick={stop}
                aria-label="Close the tour"
                className="-mt-1 -mr-1 rounded p-1 text-slate hover:text-charcoal"
              >
                <X size={16} />
              </button>
            </div>

            <h2 className="font-display text-xl text-charcoal">{step.title}</h2>
            <p className="mt-2 text-sm text-slate">{step.body}</p>

            <div className="mt-5 flex items-center justify-between">
              <span className="text-xs text-slate">
                {index} of {total}
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={back}
                  disabled={index === 1}
                  className="rounded border border-charcoal/15 px-3 py-1.5 text-sm text-slate transition hover:border-gold hover:text-charcoal disabled:opacity-40 disabled:hover:border-charcoal/15"
                >
                  Back
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="rounded border border-gold bg-gold/15 px-3 py-1.5 text-sm text-charcoal transition hover:bg-gold/25"
                >
                  {index === total ? "Done" : "Next"}
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
