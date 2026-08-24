'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Sign here, with a finger or a mouse.
 *
 * Pointer events rather than mouse plus touch: one code path covers a trackpad,
 * a phone and a stylus, and the two-listener version is where the bugs live —
 * a touch that also fires a synthetic mouse event draws every stroke twice.
 *
 * The canvas is sized in device pixels and scaled back down in CSS, so the ink
 * is sharp on a retina screen instead of being a 1x bitmap stretched to fit.
 * That also means the exported PNG is big enough to look like a signature when
 * it is drawn into a PDF at a quarter of the size.
 *
 * Reports a data URL upward on every stroke end. Empty string when cleared, so
 * the form can tell "not signed yet" from "signed" without inspecting pixels.
 */
export function SignaturePad({
  value,
  onChange,
  label = 'Signature',
  error,
  describedBy,
}: {
  value: string;
  onChange: (dataUrl: string) => void;
  label?: string;
  error?: string;
  describedBy?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [ready, setReady] = useState(false);

  /**
   * Size the bitmap to the box, in real device pixels.
   *
   * Re-run on resize, and it clears the drawing when it does. That is the
   * honest behaviour: the strokes were recorded in the old coordinate space and
   * rescaling them would change the shape of somebody's signature. A rotated
   * phone asks for it again rather than producing a signature they did not make.
   */
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0) return;
    const ratio = Math.min(globalThis.devicePixelRatio || 1, 3);
    const width = Math.round(rect.width * ratio);
    const height = Math.round(rect.height * ratio);
    if (canvas.width === width && canvas.height === height) return;

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0b2239';
    if (dirty.current) {
      dirty.current = false;
      onChange('');
    }
    setReady(true);
  }, [onChange]);

  useEffect(() => {
    fit();
    const observer = new ResizeObserver(fit);
    if (canvasRef.current) observer.observe(canvasRef.current);
    return () => observer.disconnect();
  }, [fit]);

  function pointAt(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Capture, so a stroke that wanders off the edge of the box still ends
    // cleanly instead of leaving the pad stuck in a drawing state.
    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = pointAt(event);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !last.current) return;

    const point = pointAt(event);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    last.current = point;
    dirty.current = true;
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const canvas = canvasRef.current;
    if (!canvas) return;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    if (dirty.current) onChange(canvas.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange('');
  }

  const signed = value.length > 0;

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="field-label">{label}</span>
        <button
          type="button"
          onClick={clear}
          className="text-[12px] text-link hover:underline disabled:text-ink-mute disabled:no-underline"
          disabled={!signed}
        >
          Clear
        </button>
      </div>

      {/*
        touch-action: none is what makes this work on a phone at all. Without it
        the browser claims the gesture for scrolling and the pad receives a
        single pointerdown and nothing else.
      */}
      <div
        className={`mt-1.5 rounded-[3px] border bg-panel ${
          error ? 'border-alarm' : 'border-edge-field'
        }`}
      >
        <canvas
          ref={canvasRef}
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          className="block h-[120px] w-full cursor-crosshair touch-none rounded-[3px]"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          role="img"
        />
      </div>

      <div className="mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-[12px] text-ink-dim">
          {ready ? 'Draw your signature above.' : 'Loading…'}
        </span>
        {signed ? (
          <span className="text-[12px] font-medium text-leaf-text">✓ Signed</span>
        ) : null}
      </div>

      {error ? <span className="field-error">{error}</span> : null}
    </div>
  );
}
