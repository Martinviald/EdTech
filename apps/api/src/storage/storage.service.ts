import { createHash, createHmac } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Parte ESTÁTICA de la configuración S3 (bucket/región/host): se lee una vez del
 * entorno y no cambia en la vida del proceso. Las credenciales viven aparte porque
 * pueden ser dinámicas (rol de instancia → creds temporales que rotan).
 */
interface S3Base {
  bucket: string;
  region: string;
  /** Host virtual-hosted del bucket (ej. `mi-bucket.s3.us-east-1.amazonaws.com`). */
  host: string;
  /** Base URL (protocolo + host) para construir las URLs prefirmadas. */
  baseUrl: string;
}

/**
 * Credenciales AWS resueltas para firmar (SigV4). `expiresAt` (epoch ms) sólo lo
 * traen las credenciales temporales del rol de instancia; las estáticas (env) no
 * expiran (`undefined`).
 */
interface ResolvedCredentials {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAt?: number;
}

/** Forma de la respuesta del endpoint de credenciales del contenedor (ECS/App Runner). */
interface ContainerCredentialsResponse {
  AccessKeyId?: string;
  SecretAccessKey?: string;
  Token?: string;
  Expiration?: string;
}

export interface CreateUploadUrlParams {
  /** Clave (S3 key) destino del objeto. */
  key: string;
  /** Content-Type que el cliente enviará en el PUT. */
  contentType: string;
  /** Segundos de validez de la URL. Default 900 (15 min). */
  expiresIn?: number;
}

export interface PresignedUpload {
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
  expiresIn: number;
}

export interface CreateDownloadUrlParams {
  key: string;
  expiresIn?: number;
  /** Nombre sugerido en `Content-Disposition; filename=...`. */
  downloadFileName?: string;
  /**
   * `attachment` (por defecto) fuerza la descarga; `inline` pide al navegador
   * mostrar el archivo embebido (previsualización de PDF en un iframe, sin bajarlo).
   */
  disposition?: 'attachment' | 'inline';
}

const DEFAULT_EXPIRES_IN = 900; // 15 min
const MAX_EXPIRES_IN = 7 * 24 * 3600; // límite S3 SigV4: 7 días

// Endpoint de credenciales del contenedor (ECS/App Runner) para el caso `RELATIVE_URI`.
const CONTAINER_CREDENTIALS_HOST = 'http://169.254.170.2';
const CREDENTIALS_TIMEOUT_MS = 3000; // corte del fetch de credenciales
const REFRESH_LEAD_MS = 5 * 60 * 1000; // refrescar 5 min antes de expirar
const MIN_REFRESH_MS = 60 * 1000; // nunca antes de 1 min
const RETRY_MS = 30 * 1000; // reintento tras un fallo de refresh
// Tope de delay de setTimeout (32-bit): más que esto Node avisa y lo clampa a 1ms
// (→ refresh en bucle). Las creds reales expiran en horas, muy por debajo de ~24.8 días.
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * Genera URLs prefirmadas (AWS Signature V4, query-string) para subir y descargar
 * objetos directamente contra S3, SIN que el backend reciba el archivo en memoria
 * (CLAUDE.md §11). Implementado con `node:crypto` — sin añadir el AWS SDK como
 * dependencia. Firma sólo el header `host` con payload `UNSIGNED-PAYLOAD`, así el
 * cliente puede hacer el PUT/GET directo con la URL sin headers firmados extra.
 *
 * ── Credenciales ──
 * Se resuelven de dos fuentes, en orden:
 *   1. Env estáticas (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` [+ `AWS_SESSION_TOKEN`]):
 *      es lo que usa el entorno LOCAL (`.env`). Se resuelven en el constructor (sync).
 *   2. Rol de instancia vía el *container credentials endpoint* de ECS/App Runner
 *      (`AWS_CONTAINER_CREDENTIALS_RELATIVE_URI`/`FULL_URI`): es lo que expone App Runner
 *      en la nube, donde NO hay llaves estáticas (least privilege). Como el presigner
 *      es propio (sin aws-sdk) y sólo leía `process.env`, sin esto `isConfigured()` daba
 *      false en demo/prod y toda URL prefirmada fallaba silenciosamente. Estas creds son
 *      TEMPORALES: se obtienen en `onModuleInit` y se refrescan proactivamente antes de
 *      expirar. El presigner ya emite `X-Amz-Security-Token`.
 */
@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private readonly base: S3Base | null = this.readBaseConfig();
  // Resuelve las credenciales estáticas de env de inmediato (caso local/tests). Las
  // del rol de instancia se resuelven async en onModuleInit.
  private credentials: ResolvedCredentials | null = this.readEnvCredentials();
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing: Promise<void> | null = null;

  /**
   * Si no hay bucket, o ya tenemos credenciales estáticas de env, no hay nada que
   * resolver. Si falta la credencial pero hay bucket, intentamos el rol de instancia
   * (ECS/App Runner). Nunca lanza: si no hay fuente de credenciales, el storage queda
   * "no configurado" (los endpoints que lo usan responden 503, igual que antes).
   */
  async onModuleInit(): Promise<void> {
    if (!this.base || this.credentials) return;
    await this.refreshCredentials();
  }

  onModuleDestroy(): void {
    this.clearRefreshTimer();
  }

  isConfigured(): boolean {
    return this.base !== null && this.credentials !== null;
  }

  createUploadUrl(params: CreateUploadUrlParams): PresignedUpload {
    const { base, credentials } = this.requireResolved();
    const expiresIn = this.clampExpiry(params.expiresIn);
    const uploadUrl = this.presign({
      base,
      credentials,
      method: 'PUT',
      key: params.key,
      expiresIn,
    });

    return {
      uploadUrl,
      method: 'PUT',
      // `Content-Type` NO va firmado (sólo `host`), pero se sugiere al cliente para
      // que el objeto quede con el MIME correcto. S3 lo acepta sin invalidar la firma.
      headers: { 'Content-Type': params.contentType },
      expiresIn,
    };
  }

  createDownloadUrl(params: CreateDownloadUrlParams): string {
    const { base, credentials } = this.requireResolved();
    const expiresIn = this.clampExpiry(params.expiresIn);
    const extraQuery: Record<string, string> = {};
    if (params.downloadFileName || params.disposition) {
      const disposition = params.disposition ?? 'attachment';
      const filenamePart = params.downloadFileName
        ? `; filename="${params.downloadFileName.replace(/"/g, '')}"`
        : '';
      extraQuery['response-content-disposition'] = `${disposition}${filenamePart}`;
    }
    return this.presign({
      base,
      credentials,
      method: 'GET',
      key: params.key,
      expiresIn,
      extraQuery,
    });
  }

  // ── Operaciones S3 server-side ───────────────────────────────────────────────

  /**
   * Elimina un objeto de S3. Presigna un `DELETE` y lo ejecuta desde el backend
   * (no lo delega al cliente). Es idempotente: S3 responde 204 tanto si borró el
   * objeto como si no existía, y aquí tratamos cualquier 2xx y el 404 como éxito.
   * Un 403/5xx (permisos, fallo del servicio) sí se propaga como error.
   */
  async deleteObject(key: string): Promise<void> {
    const { base, credentials } = this.requireResolved();
    const url = this.presign({
      base,
      credentials,
      method: 'DELETE',
      key,
      expiresIn: DEFAULT_EXPIRES_IN,
    });
    const res = await fetch(url, { method: 'DELETE' });
    // 2xx (204 típico) o 404 → objeto ausente = éxito idempotente.
    if (res.ok || res.status === 404) return;
    throw new Error(
      `Error al eliminar el objeto S3 "${key}": ${res.status} ${res.statusText}`,
    );
  }

  /**
   * Consulta metadatos de un objeto sin descargar su contenido (presigna un `HEAD`).
   * 200 → existe (con tamaño y content-type de los headers); 404 → no existe.
   * Cualquier otro status (403/5xx) se propaga como error.
   */
  async headObject(
    key: string,
  ): Promise<{ exists: boolean; sizeBytes: number | null; contentType: string | null }> {
    const { base, credentials } = this.requireResolved();
    const url = this.presign({
      base,
      credentials,
      method: 'HEAD',
      key,
      expiresIn: DEFAULT_EXPIRES_IN,
    });
    const res = await fetch(url, { method: 'HEAD' });
    if (res.status === 404) {
      return { exists: false, sizeBytes: null, contentType: null };
    }
    if (res.ok) {
      return {
        exists: true,
        sizeBytes: Number(res.headers.get('content-length')) || null,
        contentType: res.headers.get('content-type'),
      };
    }
    throw new Error(
      `Error al consultar el objeto S3 "${key}": ${res.status} ${res.statusText}`,
    );
  }

  /**
   * Lista los objetos del bucket bajo un `prefix` (S3 ListObjectsV2). El presign
   * apunta al root del bucket (`/`, key vacía), con `list-type=2` y `prefix` como
   * query. La respuesta es XML: se parsea con regex simple para extraer
   * `<Contents><Key>…</Key><Size>…</Size></Contents>`. Bucket/prefijo vacío → `[]`.
   */
  async listObjects(
    prefix: string,
  ): Promise<Array<{ key: string; sizeBytes: number | null }>> {
    const { base, credentials } = this.requireResolved();
    const url = this.presign({
      base,
      credentials,
      method: 'GET',
      key: '', // canonicalUri = '/' (root del bucket), no una key concreta
      expiresIn: DEFAULT_EXPIRES_IN,
      extraQuery: { 'list-type': '2', prefix },
    });
    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) {
      throw new Error(
        `Error al listar objetos S3 (prefix "${prefix}"): ${res.status} ${res.statusText}`,
      );
    }
    return this.parseListObjectsXml(await res.text());
  }

  /** Parseo minimalista del XML de ListObjectsV2 (sin dependencia de un parser XML). */
  private parseListObjectsXml(
    xml: string,
  ): Array<{ key: string; sizeBytes: number | null }> {
    const results: Array<{ key: string; sizeBytes: number | null }> = [];
    const contentsRe = /<Contents>([\s\S]*?)<\/Contents>/g;
    let match: RegExpExecArray | null;
    while ((match = contentsRe.exec(xml)) !== null) {
      const block = match[1]!;
      const keyMatch = /<Key>([\s\S]*?)<\/Key>/.exec(block);
      if (!keyMatch) continue;
      const sizeMatch = /<Size>(\d+)<\/Size>/.exec(block);
      results.push({
        key: this.decodeXmlEntities(keyMatch[1]!),
        sizeBytes: sizeMatch ? Number(sizeMatch[1]) : null,
      });
    }
    return results;
  }

  /** Decodifica las entidades XML básicas que S3 puede emitir en las keys. */
  private decodeXmlEntities(input: string): string {
    return input
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  // ── Resolución de credenciales ───────────────────────────────────────────────

  /** Credenciales estáticas de env (local/tests). null si no están ambas presentes. */
  private readEnvCredentials(): ResolvedCredentials | null {
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    if (!accessKeyId || !secretAccessKey) return null;
    return {
      accessKeyId,
      secretAccessKey,
      sessionToken: process.env.AWS_SESSION_TOKEN,
    };
  }

  /**
   * Obtiene (o refresca) las credenciales del rol de instancia y programa el próximo
   * refresco. Nunca lanza: ante error deja las credenciales actuales (si había) y
   * reintenta. Deduplica refrescos concurrentes.
   */
  private refreshCredentials(): Promise<void> {
    if (this.refreshing) return this.refreshing;
    this.refreshing = this.doRefreshCredentials().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  private async doRefreshCredentials(): Promise<void> {
    try {
      const creds = await this.fetchContainerCredentials();
      if (!creds) return; // no hay endpoint del rol → sólo quedan las de env (o ninguna)
      this.credentials = creds;
      this.scheduleRefresh(creds);
      this.logger.log(
        'Credenciales S3 obtenidas del rol de instancia (container credentials).',
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`No se pudieron obtener credenciales del rol de instancia: ${msg}`);
      // Reintento acotado: si teníamos creds y están por expirar, esto evita quedar
      // sin poder firmar; si nunca tuvimos, sigue intentando hasta que el endpoint
      // responda (el storage queda 503 mientras tanto).
      this.scheduleRetry();
    }
  }

  /**
   * Lee las credenciales temporales del *container credentials endpoint* (ECS/App
   * Runner). Devuelve null si no hay endpoint configurado (no estamos en ese entorno).
   */
  private async fetchContainerCredentials(): Promise<ResolvedCredentials | null> {
    const relativeUri = process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
    const fullUri = process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
    if (!relativeUri && !fullUri) return null;

    const url = fullUri ?? `${CONTAINER_CREDENTIALS_HOST}${relativeUri}`;
    const headers: Record<string, string> = {};
    const authToken = await this.readContainerAuthToken();
    if (authToken) headers.Authorization = authToken;

    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(CREDENTIALS_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`el container credentials endpoint respondió ${res.status}`);
    }
    const body = (await res.json()) as ContainerCredentialsResponse;
    if (!body.AccessKeyId || !body.SecretAccessKey) {
      throw new Error('respuesta de credenciales sin AccessKeyId/SecretAccessKey');
    }
    return {
      accessKeyId: body.AccessKeyId,
      secretAccessKey: body.SecretAccessKey,
      sessionToken: body.Token,
      expiresAt: body.Expiration ? Date.parse(body.Expiration) : undefined,
    };
  }

  /**
   * Token de autorización del endpoint (aplica al caso `FULL_URI`): puede venir inline
   * (`AWS_CONTAINER_AUTHORIZATION_TOKEN`) o en un archivo
   * (`AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE`).
   */
  private async readContainerAuthToken(): Promise<string | null> {
    const tokenFile = process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE;
    if (tokenFile) {
      try {
        return (await readFile(tokenFile, 'utf8')).trim();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`No se pudo leer AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE: ${msg}`);
        return null;
      }
    }
    return process.env.AWS_CONTAINER_AUTHORIZATION_TOKEN ?? null;
  }

  private scheduleRefresh(creds: ResolvedCredentials): void {
    this.clearRefreshTimer();
    if (!creds.expiresAt) return; // estáticas: no expiran
    const delay = Math.max(creds.expiresAt - Date.now() - REFRESH_LEAD_MS, MIN_REFRESH_MS);
    this.armTimer(delay);
  }

  private scheduleRetry(): void {
    this.clearRefreshTimer();
    this.armTimer(RETRY_MS);
  }

  private armTimer(delay: number): void {
    this.refreshTimer = setTimeout(() => {
      void this.refreshCredentials();
    }, Math.min(delay, MAX_TIMER_MS));
    // No mantener vivo el event loop sólo por este timer.
    this.refreshTimer.unref?.();
  }

  private clearRefreshTimer(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  /** Devuelve base + credenciales o lanza 503 si el almacenamiento no está resuelto. */
  private requireResolved(): { base: S3Base; credentials: ResolvedCredentials } {
    if (!this.base || !this.credentials) {
      throw new ServiceUnavailableException(
        'El almacenamiento de archivos (S3) no está configurado en este entorno',
      );
    }
    return { base: this.base, credentials: this.credentials };
  }

  // ── SigV4 presigning ───────────────────────────────────────────────────────

  private presign(args: {
    base: S3Base;
    credentials: ResolvedCredentials;
    method: 'GET' | 'PUT' | 'DELETE' | 'HEAD';
    key: string;
    expiresIn: number;
    extraQuery?: Record<string, string>;
  }): string {
    const { base, credentials, method, key, expiresIn } = args;
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${base.region}/s3/aws4_request`;
    const canonicalUri = `/${this.uriEncode(key, false)}`;

    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${credentials.accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': 'host',
      ...(credentials.sessionToken
        ? { 'X-Amz-Security-Token': credentials.sessionToken }
        : {}),
      ...(args.extraQuery ?? {}),
    };

    const canonicalQueryString = Object.keys(query)
      .sort()
      .map((k) => `${this.uriEncode(k, true)}=${this.uriEncode(query[k]!, true)}`)
      .join('&');

    const canonicalHeaders = `host:${base.host}\n`;
    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      'host',
      'UNSIGNED-PAYLOAD',
    ].join('\n');

    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      this.sha256Hex(canonicalRequest),
    ].join('\n');

    const signingKey = this.signingKey(credentials.secretAccessKey, dateStamp, base.region);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    return `${base.baseUrl}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
  }

  private signingKey(secretAccessKey: string, dateStamp: string, region: string): Buffer {
    const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(region).digest();
    const kService = createHmac('sha256', kRegion).update('s3').digest();
    return createHmac('sha256', kService).update('aws4_request').digest();
  }

  private sha256Hex(data: string): string {
    return createHash('sha256').update(data, 'utf8').digest('hex');
  }

  private amzDate(date: Date): string {
    return date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  /** URI-encode RFC3986 (AWS): deja `A-Za-z0-9-_.~` y opcionalmente `/`. */
  private uriEncode(input: string, encodeSlash: boolean): string {
    let out = '';
    for (const ch of input) {
      if (/[A-Za-z0-9\-_.~]/.test(ch)) {
        out += ch;
      } else if (ch === '/' && !encodeSlash) {
        out += '/';
      } else {
        const bytes = Buffer.from(ch, 'utf8');
        for (const b of bytes) out += `%${b.toString(16).toUpperCase().padStart(2, '0')}`;
      }
    }
    return out;
  }

  private clampExpiry(expiresIn?: number): number {
    if (!expiresIn || expiresIn <= 0) return DEFAULT_EXPIRES_IN;
    return Math.min(expiresIn, MAX_EXPIRES_IN);
  }

  private readBaseConfig(): S3Base | null {
    // `AWS_S3_BUCKET` es la variable que inyecta la infra AWS/SST al aprovisionar
    // el bucket; se deja como último fallback tras las overrides locales explícitas.
    const bucket =
      process.env.STORAGE_S3_BUCKET ??
      process.env.S3_BUCKET ??
      process.env.AWS_S3_BUCKET;
    const region = process.env.STORAGE_S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

    if (!bucket) return null;

    // Virtual-hosted style (S3 real de AWS, target de producción según CLAUDE.md §2).
    const host = `${bucket}.s3.${region}.amazonaws.com`;
    return {
      bucket,
      region,
      host,
      baseUrl: `https://${host}`,
    };
  }
}
