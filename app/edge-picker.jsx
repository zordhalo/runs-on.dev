'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Home, Settings2, BarChart3, BookOpenText, CircleHelp, Info } from 'lucide-react';

const ROUTES = [
  { id: 'home', label: 'Home', path: '/', Icon: Home },
  { id: 'manage', label: 'Manage', path: '/manage', Icon: Settings2 },
  { id: 'stats', label: 'Stats', path: '/stats', Icon: BarChart3 },
  { id: 'docs', label: 'Docs', path: '/docs', Icon: BookOpenText },
  { id: 'faq', label: 'FAQ', path: '/faq', Icon: CircleHelp },
  { id: 'about', label: 'About', path: '/about', Icon: Info },
];

const ICON_SIZE = 18;

function openPickerDb() {
  return new Promise((resolve) => {
    if (typeof window === 'undefined' || !window.indexedDB) {
      resolve(null);
      return;
    }
    const req = indexedDB.open('edge-picker', 1);
    req.onupgradeneeded = () => {
      req.result.createObjectStore('state');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
}

function idbGet(db, key) {
  return new Promise((resolve) => {
    if (!db) { resolve(undefined); return; }
    const tx = db.transaction('state', 'readonly');
    const req = tx.objectStore('state').get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(undefined);
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve) => {
    if (!db) { resolve(); return; }
    const tx = db.transaction('state', 'readwrite');
    tx.objectStore('state').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

export default function EdgePicker() {
  const router = useRouter();
  const pathname = usePathname();
  const items = ROUTES;
  const itemCount = items.length;

  const initialIndex = Math.max(0, items.findIndex((r) => r.path === pathname));

  const [scrollPos, setScrollPos] = useState(initialIndex);
  const [isDragging, setIsDragging] = useState(false);
  const [isWheeling, setIsWheeling] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  const isDraggingRef = useRef(false);
  isDraggingRef.current = isDragging;
  const isPointerDownRef = useRef(false);
  const expandedAtRef = useRef(Date.now());
  const pointerDownTimeRef = useRef(0);

  const scrollPosRef = useRef(initialIndex);
  scrollPosRef.current = scrollPos;

  const containerRef = useRef(null);
  const animFrameRef = useRef(null);
  const pointerStartY = useRef(0);
  const pointerStartPos = useRef(0);
  const lastPointerY = useRef(0);
  const lastPointerTime = useRef(0);
  const velocityY = useRef(0);
  const hasDraggedRef = useRef(false);
  const targetItemOnDown = useRef(null);
  const lastDetentIndex = useRef(initialIndex);
  const audioContextRef = useRef(null);

  const playHapticTick = useCallback((direction = 1) => {
    try {
      if (!audioContextRef.current) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        audioContextRef.current = new AudioCtx();
      }
      const ctx = audioContextRef.current;
      if (ctx.state === 'suspended') ctx.resume();

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(direction > 0 ? 1420 : 1200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.035);

      gain.gain.setValueAtTime(0.25, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.035);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.035);
    } catch {
      // Audio awaiting user gesture
    }
  }, []);

  const checkDetent = useCallback(
    (pos) => {
      const currentDetent = Math.round(pos);
      if (currentDetent !== lastDetentIndex.current) {
        const dir = currentDetent > lastDetentIndex.current ? 1 : -1;
        lastDetentIndex.current = currentDetent;
        playHapticTick(dir);

        const normalized = ((currentDetent % itemCount) + itemCount) % itemCount;
        const route = items[normalized];
        if (route && route.path !== pathname) {
          router.push(route.path);
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, itemCount, router, pathname, playHapticTick]
  );

  const animateToTarget = useCallback(
    (targetPos, initialVelocity = 0) => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

      let current = scrollPosRef.current;
      let velocity = initialVelocity;
      const springK = 0.22;
      const damping = 0.74;

      const step = () => {
        const diff = targetPos - current;
        const springForce = diff * springK;
        velocity = velocity * damping + springForce;
        current += velocity;

        setScrollPos(current);
        checkDetent(current);

        if (Math.abs(diff) < 0.002 && Math.abs(velocity) < 0.002) {
          const normalized = ((Math.round(targetPos) % itemCount) + itemCount) % itemCount;
          setScrollPos(normalized);
          scrollPosRef.current = normalized;
          lastDetentIndex.current = normalized;
          animFrameRef.current = null;
          return;
        }

        animFrameRef.current = requestAnimationFrame(step);
      };

      animFrameRef.current = requestAnimationFrame(step);
    },
    [checkDetent, itemCount]
  );

  // Text revealed while dragging, wheeling, or hovering with a mouse.
  // Touch pointers never activate hover (checked via pointerType), so
  // mobile stays icon-only unless actively scrubbing the reel.
  const [isHovered, setIsHovered] = useState(false);
  const isScrollingReel = !isCompact && (isDragging || isWheeling || isHovered);
  const pillHeight = isScrollingReel ? 96 : 46;

  // Compact state: only on mobile (coarse pointer). Desktop never shrinks
  // — the full dock is always visible and interactive.
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);
  const isCoarsePointerRef = useRef(false);
  useEffect(() => {
    const coarse = window.matchMedia('(pointer: coarse)').matches;
    setIsCoarsePointer(coarse);
    isCoarsePointerRef.current = coarse;
  }, []);

  const dockLength = isCompact ? 116 : 380;

  const getSlotY = useCallback((relOffset, currentPillH) => {
    if (relOffset === 0) return 0;
    const sign = relOffset > 0 ? 1 : -1;
    const abs = Math.abs(relOffset);
    const D1 = currentPillH / 2 + 12 + 10;
    const step = 32;

    if (abs <= 1) {
      return sign * abs * D1;
    }
    return sign * (D1 + (abs - 1) * step);
  }, []);

  const handlePointerDown = (e, specificIndex = null) => {
    if (isCompact) {
      setIsCompact(false);
      expandedAtRef.current = Date.now();
      playHapticTick(1);
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    isPointerDownRef.current = true;
    hasDraggedRef.current = false;
    targetItemOnDown.current = specificIndex;
    pointerDownTimeRef.current = performance.now();

    pointerStartY.current = e.clientY;
    pointerStartPos.current = scrollPosRef.current;
    lastPointerY.current = e.clientY;
    lastPointerTime.current = performance.now();
    velocityY.current = 0;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}
  };

  const handlePointerMove = (e) => {
    if (!isPointerDownRef.current) return;

    const currentY = e.clientY;
    const deltaFromStart = currentY - pointerStartY.current;
    const stepDelta = currentY - lastPointerY.current;
    const now = performance.now();
    const timeDelta = Math.max(1, now - lastPointerTime.current);

    // Only switch to drag state if dragged > 10px and held > 80ms
    if (!hasDraggedRef.current && Math.abs(deltaFromStart) > 10 && now - pointerDownTimeRef.current > 80) {
      hasDraggedRef.current = true;
      setIsDragging(true);
      isDraggingRef.current = true;
    }

    if (!hasDraggedRef.current) return;

    const pxPerItem = 32;
    const instantVelocity = stepDelta / pxPerItem / timeDelta;
    velocityY.current = velocityY.current * 0.4 + instantVelocity * 0.6;

    lastPointerY.current = currentY;
    lastPointerTime.current = now;

    const newPos = pointerStartPos.current - deltaFromStart / pxPerItem;
    setScrollPos(newPos);
    checkDetent(newPos);
  };

  const handlePointerUp = (e) => {
    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;

    const wasDragging = hasDraggedRef.current;
    setIsDragging(false);
    isDraggingRef.current = false;

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    // Tap: select and center without text
    if (!wasDragging) {
      if (targetItemOnDown.current !== null) {
        const tappedIdx = targetItemOnDown.current;
        const currentCenter = Math.round(scrollPosRef.current);

        if (tappedIdx !== currentCenter) {
          animateToTarget(tappedIdx);
        }
        return;
      }

      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const tapRelY = e.clientY - (rect.top + rect.height / 2);

        if (Math.abs(tapRelY) >= 24) {
          const currentCenter = Math.round(scrollPosRef.current);
          let bestSlot = currentCenter;
          let minDiff = Infinity;

          for (let s = -3; s <= 3; s++) {
            const slotY = getSlotY(s, pillHeight);
            const diff = Math.abs(tapRelY - slotY);
            if (diff < minDiff) {
              minDiff = diff;
              bestSlot = currentCenter + s;
            }
          }
          animateToTarget(bestSlot);
        }
      }
      return;
    }

    // Drag ended: fling with inertia
    const momentumItems = -velocityY.current * 140;
    const projectedPos = scrollPosRef.current + momentumItems;
    const currentNorm = ((Math.round(scrollPosRef.current) % itemCount) + itemCount) % itemCount;
    const maxTravel = Math.ceil(itemCount * 1.5);
    let targetSnap = Math.round(projectedPos);
    if (targetSnap > currentNorm + maxTravel) targetSnap = currentNorm + maxTravel;
    if (targetSnap < currentNorm - maxTravel) targetSnap = currentNorm - maxTravel;

    animateToTarget(targetSnap, -velocityY.current * 1.4);
  };

  const wheelTimeoutRef = useRef(null);
  const wheelHandlerRef = useRef(null);

  wheelHandlerRef.current = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);

    setIsWheeling(true);

    const delta = e.deltaY * 0.012;
    const newPos = scrollPosRef.current + delta;
    setScrollPos(newPos);
    checkDetent(newPos);

    if (wheelTimeoutRef.current) clearTimeout(wheelTimeoutRef.current);
    wheelTimeoutRef.current = setTimeout(() => {
      setIsWheeling(false);
      animateToTarget(Math.round(scrollPosRef.current));
    }, 180);
  };

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e) => wheelHandlerRef.current(e);
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, []);

  // Shrink on page scroll (desktop + mobile via touchmove outside dock)
  useEffect(() => {
    let timer;

    const compact = () => {
      if (!isCoarsePointerRef.current) return; // desktop never compacts
      if (isDraggingRef.current || isPointerDownRef.current) return;
      if (Date.now() - expandedAtRef.current < 750) return;

      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!isDraggingRef.current && !isPointerDownRef.current && Date.now() - expandedAtRef.current >= 750) {
          setIsCompact(true);
        }
      }, 70);
    };

    const onDocScroll = () => compact();

    const onTouchMoveOutsideDock = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        compact();
      }
    };

    document.addEventListener('scroll', onDocScroll, { passive: true, capture: true });
    document.addEventListener('touchmove', onTouchMoveOutsideDock, { passive: true });

    return () => {
      document.removeEventListener('scroll', onDocScroll, { capture: true });
      document.removeEventListener('touchmove', onTouchMoveOutsideDock);
      clearTimeout(timer);
    };
  }, []);

  // Pathname sync
  useEffect(() => {
    const i = ROUTES.findIndex((r) => r.path === pathname);
    if (i < 0) return;
    const currentNorm = ((Math.round(scrollPosRef.current) % itemCount) + itemCount) % itemCount;
    if (i === currentNorm) return;
    const current = scrollPosRef.current;
    let delta = i - currentNorm;
    if (delta > itemCount / 2) delta -= itemCount;
    if (delta < -itemCount / 2) delta += itemCount;
    animateToTarget(current + delta);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  // Prefetch all routes
  const prefetchedRef = useRef(false);
  useEffect(() => {
    if (prefetchedRef.current) return;
    prefetchedRef.current = true;
    for (const route of ROUTES) {
      router.prefetch(route.path);
    }
    const interval = setInterval(() => {
      for (const route of ROUTES) {
        router.prefetch(route.path);
      }
    }, 25_000);
    return () => clearInterval(interval);
  }, [router]);

  // IndexedDB persistence
  useEffect(() => {
    openPickerDb()
      .then((db) => idbGet(db, 'scrollPos'))
      .then((saved) => {
        if (typeof saved === 'number' && saved >= 0 && saved < itemCount) {
          setScrollPos(saved);
          scrollPosRef.current = saved;
          lastDetentIndex.current = Math.round(saved);
        }
      })
      .catch(() => {});
  }, [itemCount]);

  useEffect(() => {
    if (Number.isInteger(scrollPos)) {
      openPickerDb()
        .then((db) => idbPut(db, 'scrollPos', ((scrollPos % itemCount) + itemCount) % itemCount))
        .catch(() => {});
    }
  }, [scrollPos, itemCount]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, []);

  if (pathname?.startsWith('/sites/')) return null;

  const currentNearestCenter = Math.round(scrollPos);
  const activeNormalizedIndex = ((currentNearestCenter % itemCount) + itemCount) % itemCount;
  const activeItem = items[activeNormalizedIndex];

  const visibleItemOffsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4];

  // Paper theme
  const pillShadow = '0 0 0 1px rgba(255,255,255,0.15) inset, 0 4px 12px rgba(0,0,0,0.35)';

  return (
    <div
      ref={containerRef}
      onPointerDown={(e) => handlePointerDown(e, null)}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') setIsHovered(true);
      }}
      onPointerLeave={() => setIsHovered(false)}
      onClick={(e) => {
        if (isCompact) {
          setIsCompact(false);
          expandedAtRef.current = Date.now();
          playHapticTick(1);
          e.preventDefault();
          e.stopPropagation();
        }
      }}
      style={{
        top: '50%',
        right: 0,
        position: 'fixed',
        transform: 'translateY(-50%)',
        width: '56px',
        height: `${dockLength}px`,
        transition: 'height 0.45s cubic-bezier(0.34, 1.56, 0.64, 1), box-shadow 0.3s ease',
      }}
      className={`z-50 select-none touch-none cursor-pointer flex items-center justify-end ${
        isCompact ? 'active:scale-95 hover:brightness-110' : 'cursor-ns-resize'
      }`}
      aria-label="Page navigation"
      role="navigation"
    >
      {/* Dynamic SVG ClipPath using objectBoundingBox: scales with height */}
      <svg
        className="absolute w-0 h-0 pointer-events-none"
        aria-hidden="true"
        style={{ position: 'absolute', width: 0, height: 0, overflow: 'hidden' }}
      >
        <defs>
          <clipPath id="dockNotchClipObject" clipPathUnits="objectBoundingBox">
            <path d="M 1,0 C 1,0.1184 0.0714,0.1316 0.0714,0.25 L 0.0714,0.75 C 0.0714,0.8684 1,0.8816 1,1 Z" />
          </clipPath>
        </defs>
      </svg>

      {/* Curved SVG Dock Bezel: MAINTAINED in both expanded and compact states */}
      <svg
        className="absolute right-0 top-0 h-full w-[56px] pointer-events-none drop-shadow-[-4px_0_14px_rgba(0,0,0,0.65)]"
        viewBox="0 0 56 380"
        preserveAspectRatio="none"
      >
        <defs>
          <linearGradient id="notchInnerShadow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(255,255,255,0.2)" />
            <stop offset="35%" stopColor="rgba(255,255,255,0.0)" />
          </linearGradient>
        </defs>

        <path
          d="M 56,0 C 56,45 4,50 4,95 L 4,285 C 4,330 56,335 56,380 Z"
          fill="#0a0a0c"
        />
        <path
          d="M 56,1 C 55,45 5,50 5,95 L 5,285 C 5,330 55,335 56,379"
          fill="none"
          stroke="url(#notchInnerShadow)"
          strokeWidth="2.5"
        />
      </svg>

      {/* Masked Reel Container clipped to the S-curve notch shape */}
      <div
        className="absolute right-0 top-0 w-full h-full overflow-hidden pointer-events-none"
        style={{
          clipPath: 'url(#dockNotchClipObject)',
          WebkitClipPath: 'url(#dockNotchClipObject)',
        }}
      >
        {/* Active Pill at Center Notch */}
        <div
          onPointerDown={(e) => {
            if (!isCompact) {
              e.stopPropagation();
              handlePointerDown(e, currentNearestCenter);
            }
          }}
          style={{
            height: `${pillHeight}px`,
            top: '50%',
            transform: 'translateY(-50%)',
            background: 'var(--paper)',
            boxShadow: pillShadow,
          }}
          className={`absolute right-[9px] w-[34px] rounded-full flex items-center justify-center z-20 pointer-events-auto transition-[height] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
            isCompact ? 'pointer-events-none' : 'cursor-pointer active:scale-95'
          }`}
        >
          <div
            className="flex items-center justify-center w-full h-full"
            style={{ color: 'var(--ink)' }}
          >
            {isScrollingReel ? (
              <span
                className="text-[11px] font-bold tracking-widest uppercase whitespace-nowrap"
                style={{
                  writingMode: 'vertical-rl',
                  transform: 'rotate(180deg)',
                }}
              >
                {activeItem.label}
              </span>
            ) : (
              <activeItem.Icon
                size={ICON_SIZE}
                strokeWidth={2.3}
                style={{ color: 'currentColor' }}
              />
            )}
          </div>
        </div>

        {/* Looping Reel Neighbors */}
        {visibleItemOffsets.map((offset) => {
          const integerIdx = currentNearestCenter + offset;
          const catalogIdx = ((integerIdx % itemCount) + itemCount) % itemCount;
          const item = items[catalogIdx];

          const relContinuous = integerIdx - scrollPos;
          const yPos = getSlotY(relContinuous, pillHeight);

          if (Math.abs(relContinuous) < 0.35) return null;

          const dist = Math.abs(yPos);
          const maxDist = 148;
          if (dist > maxDist) return null;

          const fadeStart = 72;
          let opacity = 1;
          if (dist > fadeStart) {
            opacity = Math.max(0, 1 - Math.pow((dist - fadeStart) / (maxDist - fadeStart), 1.3));
          }
          if (opacity <= 0.01) return null;

          const scale = Math.max(0.72, 1 - dist / (maxDist * 2.4));

          return (
            <div
              key={integerIdx}
              onPointerDown={(e) => {
                if (!isCompact) {
                  e.stopPropagation();
                  handlePointerDown(e, integerIdx);
                }
              }}
              style={{
                transform: `translateY(${yPos}px) scale(${scale})`,
                opacity: isCompact ? 0 : opacity,
                top: '50%',
                marginTop: '-16px',
                pointerEvents: isCompact ? 'none' : 'auto',
                transition: 'opacity 0.25s ease',
              }}
              className="absolute right-[9px] w-[34px] h-8 flex items-center justify-center pointer-events-auto cursor-pointer group"
              title={`Jump to ${item.label}`}
            >
              <span className="w-6 h-6 rounded-full flex items-center justify-center group-hover:bg-white/10 group-hover:scale-125 transition-all text-neutral-400 hover:text-white">
                <item.Icon size={ICON_SIZE} strokeWidth={2} />
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
