"use client";
import React, {
  createContext,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react"
import confetti from "canvas-confetti"

import { Button } from "@/components/ui/button"

const ConfettiContext = createContext(null)

const ConfettiComponent = forwardRef((props, ref) => {
  const {
    options,
    globalOptions = { resize: true, useWorker: true },
    manualstart = false,
    children,
    className,
    ...rest
  } = props

  const canvasNodeRef = useRef(null)
  const instanceRef = useRef(null)
  const optionsRef = useRef(options)
  const globalOptionsRef = useRef(globalOptions)

  useEffect(() => {
    optionsRef.current = options
  }, [options])

  useEffect(() => {
    globalOptionsRef.current = globalOptions
  }, [globalOptions])

  useEffect(() => {
    if (canvasNodeRef.current && !instanceRef.current) {
      instanceRef.current = confetti.create(canvasNodeRef.current, {
        resize: true,
        useWorker: true,
        ...globalOptionsRef.current,
      })
    }

    return () => {
      instanceRef.current?.reset()
      instanceRef.current = null
    }
  }, [])

  const fire = useCallback(async (opts = {}) => {
    try {
      await instanceRef.current?.({
        ...optionsRef.current,
        ...opts,
      })
    } catch (error) {
      console.error("Confetti error:", error)
    }
  }, [])

  const api = useMemo(() => ({ fire }), [fire])

  useImperativeHandle(ref, () => api, [api])

  useEffect(() => {
    if (!manualstart) {
      void fire()
    }
  }, [manualstart, fire])

  return (
    <ConfettiContext.Provider value={api}>
      <canvas ref={canvasNodeRef} className={className} {...rest} />
      {children}
    </ConfettiContext.Provider>
  )
})

ConfettiComponent.displayName = "Confetti"

export const Confetti = ConfettiComponent

export const ConfettiButton = forwardRef(({ options, children, onClick, ...props }, ref) => {
  const handleClick = async (event) => {
    try {
      onClick?.(event)
      if (event?.defaultPrevented) return

      const target = event?.currentTarget
      if (target && "getBoundingClientRect" in target) {
        const rect = target.getBoundingClientRect()
        const origin = {
          x: (rect.left + rect.width / 2) / window.innerWidth,
          y: (rect.top + rect.height / 2) / window.innerHeight,
        }

        await confetti({
          zIndex: 9999,
          ...options,
          origin,
        })
      }
    } catch (error) {
      console.error("Confetti button error:", error)
    }
  }

  return (
    <Button ref={ref} type="button" onClick={handleClick} {...props}>
      {children}
    </Button>
  )
})

ConfettiButton.displayName = "ConfettiButton"
