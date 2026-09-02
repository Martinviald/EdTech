'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import { useSession } from 'next-auth/react';
import type { TelemetryContext, TrackFn } from '@soe/types';

/**
 * Telemetría de uso — capa cliente. Expone `track(name, properties)` tipado
 * contra el registro de eventos de `@soe/types` (nombres/props desconocidos
 * fallan en compilación). Los eventos se acumulan en un buffer en memoria y se
 * envían en lote al backend (`POST /api/proxy/telemetry/events`) por intervalo,
 * por tamaño y al ocultarse/cerrarse la pestaña (sendBeacon / fetch keepalive).
 *
 * Best-effort: la telemetría NUNCA rompe la UX. Todo error de red se traga y no
 * hay estado que la UI observe. Sólo emite para usuarios autenticados con org
 * activa; en login/marketing es un no-op.
 */

const ENDPOINT = '/api/proxy/telemetry/events';
const FLUSH_INTERVAL_MS = 10_000;
const MAX_QUEUE = 25;
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;

type QueuedEvent = {
  name: string;
  properties: Record<string, unknown>;
  occurredAt: string;
  context: TelemetryContext;
};

type TelemetryValue = { track: TrackFn };

const NOOP: TelemetryValue = { track: () => {} };

const TelemetryCtx = createContext<TelemetryValue>(NOOP);

function createSessionId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function TelemetryProvider({ children }: { children: React.ReactNode }) {
  const { data: session } = useSession();

  const authedRef = useRef(false);
  const queueRef = useRef<QueuedEvent[]>([]);
  const sessionIdRef = useRef<string | null>(null);

  authedRef.current = Boolean(session?.user?.orgId);

  const flush = useCallback((useBeacon = false) => {
    if (queueRef.current.length === 0) return;
    const events = queueRef.current;
    queueRef.current = [];
    const payload = JSON.stringify({ events });
    try {
      if (useBeacon && typeof navigator !== 'undefined' && navigator.sendBeacon) {
        navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
        return;
      }
      void fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true,
      }).catch(() => {});
    } catch {
      // best-effort: nunca propagar un fallo de telemetría al flujo de usuario.
    }
  }, []);

  const track = useCallback<TrackFn>(
    (name, properties) => {
      if (!authedRef.current) return;
      if (!sessionIdRef.current) sessionIdRef.current = createSessionId();
      const context: TelemetryContext = {
        source: 'web',
        sessionId: sessionIdRef.current,
        path: typeof window !== 'undefined' ? window.location.pathname : undefined,
        appVersion: APP_VERSION,
      };
      queueRef.current.push({
        name,
        properties: properties as Record<string, unknown>,
        occurredAt: new Date().toISOString(),
        context,
      });
      if (queueRef.current.length >= MAX_QUEUE) flush();
    },
    [flush],
  );

  useEffect(() => {
    const interval = window.setInterval(() => flush(), FLUSH_INTERVAL_MS);
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush(true);
    };
    const onPageHide = () => flush(true);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      flush(true);
    };
  }, [flush]);

  const value = useMemo<TelemetryValue>(() => ({ track }), [track]);

  return <TelemetryCtx.Provider value={value}>{children}</TelemetryCtx.Provider>;
}

/**
 * Acceso al `track` tipado desde cualquier Client Component. Fuera del provider
 * (p. ej. una página de marketing) devuelve un no-op, así el llamador nunca
 * necesita chequear disponibilidad.
 */
export function useTelemetry(): TelemetryValue {
  return useContext(TelemetryCtx);
}
