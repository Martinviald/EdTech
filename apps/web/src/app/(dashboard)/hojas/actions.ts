'use server';

import { cookies } from 'next/headers';
import { apiPost } from '@/lib/api';
import { getDisplayMessage } from '@/lib/errors';
import type {
  CreatePrintRunDto,
  FreezeLayoutResponse,
  LayoutSpec,
  PrintRunModel,
} from '@soe/types';

export type FreezeLayoutResult =
  | { ok: true; data: FreezeLayoutResponse }
  | { ok: false; message: string };

export async function freezeLayout(spec: LayoutSpec): Promise<FreezeLayoutResult> {
  try {
    const data = await apiPost<FreezeLayoutResponse>('/sheet-layouts', { spec });
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo congelar el layout') };
  }
}

export type CreatePrintRunResult =
  | { ok: true; data: PrintRunModel }
  | { ok: false; message: string };

export async function createPrintRun(dto: CreatePrintRunDto): Promise<CreatePrintRunResult> {
  try {
    const data = await apiPost<PrintRunModel>('/sheet-print-runs', dto);
    return { ok: true, data };
  } catch (e) {
    return { ok: false, message: getDisplayMessage(e, 'No se pudo crear la tirada') };
  }
}

export type DownloadPdfResult =
  | { ok: true; base64: string; fileName: string }
  | { ok: false; message: string };

/**
 * Descarga del PDF de una tirada (`GET /sheet-print-runs/:id/pdf`,
 * `application/pdf`). Vuelve como base64 y el cliente arma el Blob: el proxy
 * genérico `/api/proxy/[...path]` no sirve para binarios (hace
 * `upstream.text()`, que corrompe el stream del PDF al decodificarlo como
 * UTF-8) y `lib/api.ts` solo expone respuestas JSON. El fetch crudo con el
 * Bearer de la cookie de sesión replica lo que hace `lib/api.ts` para JSON.
 */
export async function downloadPrintRunPdf(runId: string): Promise<DownloadPdfResult> {
  const apiBase = process.env.API_URL;
  if (!apiBase) return { ok: false, message: 'API_URL no configurada' };

  const jar = await cookies();
  const token =
    jar.get('authjs.session-token')?.value ?? jar.get('__Secure-authjs.session-token')?.value;
  if (!token) return { ok: false, message: 'No autenticado' };

  let res: Response;
  try {
    res = await fetch(`${apiBase}/api/sheet-print-runs/${runId}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    return { ok: false, message: 'No se puede conectar con el servidor' };
  }

  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    const fallback = res.status < 500 ? `Error ${res.status}` : 'No se pudo generar el PDF';
    return { ok: false, message: body.message ?? fallback };
  }

  const buffer = Buffer.from(await res.arrayBuffer());
  return {
    ok: true,
    base64: buffer.toString('base64'),
    fileName: `hojas-de-respuesta-${runId.slice(0, 8)}.pdf`,
  };
}
