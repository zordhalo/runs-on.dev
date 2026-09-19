'use client';

import { useRef } from 'react';
import { Confetti } from '@/components/ui/confetti';

// Firework cadence from the Magic UI preset (twin side bursts repeating over
// a short run), but the particles are the star shape in shades of white, so
// the celebration reads as sparks on the obsidian canvas rather than a
// rainbow.
const WHITE_STARS = ['#FFFFFF', '#F5F5F5', '#E8E8E8', '#D6D6D6', '#BFBFBF'];

const STAR_BURST = {
  shapes: ['star'],
  colors: WHITE_STARS,
  scalar: 1.3,
  spread: 360,
  startVelocity: 32,
  decay: 0.95,
  gravity: 0.35,
  ticks: 150,
  zIndex: 50,
};

function fireStarWorks(confettiRef) {
  const duration = 2600;
  const animationEnd = Date.now() + duration;
  const randomInRange = (min, max) => Math.random() * (max - min) + min;
  const interval = window.setInterval(() => {
    const timeLeft = animationEnd - Date.now();
    if (timeLeft <= 0) {
      window.clearInterval(interval);
      return;
    }
    const particleCount = 50 * (timeLeft / duration);
    confettiRef.current?.fire({
      ...STAR_BURST,
      particleCount,
      origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 },
    });
    confettiRef.current?.fire({
      ...STAR_BURST,
      particleCount,
      origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 },
    });
  }, 250);
}

// The "Names claimed" stat card, clickable: a click fires white star
// fireworks from the screen edges. Markup mirrors the Stat cell exactly so
// the card reads as identical; only the affordances differ.
export default function ConfettiStat({ value, label }) {
  const confettiRef = useRef(null);

  return (
    <>
      <Confetti
        ref={confettiRef}
        manualstart
        className="pointer-events-none fixed inset-0 z-50 h-full w-full"
      />
      <button
        type="button"
        onClick={() => fireStarWorks(confettiRef)}
        aria-label={`${label}: ${value}. Activate for confetti.`}
        className="slit-frame cursor-pointer rounded-lg p-6 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-(--color-signal) focus-visible:ring-offset-2 focus-visible:ring-offset-(--color-paper) sm:p-8"
      >
        <div className="text-[34px] leading-[1.03] font-normal tracking-[-0.005em] text-(--color-ink) sm:text-[44px] sm:tracking-[-0.007em]">
          {value}
        </div>
        <div className="meta mt-3">{label}</div>
      </button>
    </>
  );
}
