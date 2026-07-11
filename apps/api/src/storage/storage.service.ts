import { createHash, createHmac } from 'node:crypto';
import { Injectable, ServiceUnavailableException } from '@nestjs/common';

/**
 * Configuración de almacenamiento S3 leída desde el entorno (patrón `process.env`
 * como el resto de la API — sin ConfigService). Si el bucket o las credenciales
 * no están definidos, el servicio queda "no configurado" y los endpoints que lo
 * usan responden 503 en vez de 500 (el flujo de subida presigned no está disponible
 * hasta que se aprovisione el bucket en la infra AWS/SST).
 */
interface S3Config {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  /** Host virtual-hosted del bucket (ej. `mi-bucket.s3.us-east-1.amazonaws.com`). */
  host: string;
  /** Base URL (protocolo + host) para construir las URLs prefirmadas. */
  baseUrl: string;
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
  /** Fuerza `Content-Disposition: attachment; filename=...` al descargar. */
  downloadFileName?: string;
}

const DEFAULT_EXPIRES_IN = 900; // 15 min
const MAX_EXPIRES_IN = 7 * 24 * 3600; // límite S3 SigV4: 7 días

/**
 * Genera URLs prefirmadas (AWS Signature V4, query-string) para subir y descargar
 * objetos directamente contra S3, SIN que el backend reciba el archivo en memoria
 * (CLAUDE.md §11). Implementado con `node:crypto` — sin añadir el AWS SDK como
 * dependencia. Firma sólo el header `host` con payload `UNSIGNED-PAYLOAD`, así el
 * cliente puede hacer el PUT/GET directo con la URL sin headers firmados extra.
 */
@Injectable()
export class StorageService {
  private readonly config: S3Config | null = this.readConfig();

  isConfigured(): boolean {
    return this.config !== null;
  }

  /** Devuelve la config o lanza 503 si el almacenamiento no está aprovisionado. */
  private requireConfig(): S3Config {
    if (!this.config) {
      throw new ServiceUnavailableException(
        'El almacenamiento de archivos (S3) no está configurado en este entorno',
      );
    }
    return this.config;
  }

  createUploadUrl(params: CreateUploadUrlParams): PresignedUpload {
    const config = this.requireConfig();
    const expiresIn = this.clampExpiry(params.expiresIn);
    const uploadUrl = this.presign({
      config,
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
    const config = this.requireConfig();
    const expiresIn = this.clampExpiry(params.expiresIn);
    const extraQuery: Record<string, string> = {};
    if (params.downloadFileName) {
      extraQuery['response-content-disposition'] =
        `attachment; filename="${params.downloadFileName.replace(/"/g, '')}"`;
    }
    return this.presign({
      config,
      method: 'GET',
      key: params.key,
      expiresIn,
      extraQuery,
    });
  }

  // ── SigV4 presigning ───────────────────────────────────────────────────────

  private presign(args: {
    config: S3Config;
    method: 'GET' | 'PUT';
    key: string;
    expiresIn: number;
    extraQuery?: Record<string, string>;
  }): string {
    const { config, method, key, expiresIn } = args;
    const now = new Date();
    const amzDate = this.amzDate(now);
    const dateStamp = amzDate.slice(0, 8);
    const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;
    const canonicalUri = `/${this.uriEncode(key, false)}`;

    const query: Record<string, string> = {
      'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
      'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
      'X-Amz-Date': amzDate,
      'X-Amz-Expires': String(expiresIn),
      'X-Amz-SignedHeaders': 'host',
      ...(config.sessionToken ? { 'X-Amz-Security-Token': config.sessionToken } : {}),
      ...(args.extraQuery ?? {}),
    };

    const canonicalQueryString = Object.keys(query)
      .sort()
      .map((k) => `${this.uriEncode(k, true)}=${this.uriEncode(query[k]!, true)}`)
      .join('&');

    const canonicalHeaders = `host:${config.host}\n`;
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

    const signingKey = this.signingKey(config.secretAccessKey, dateStamp, config.region);
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

    return `${config.baseUrl}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
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

  private readConfig(): S3Config | null {
    const bucket = process.env.STORAGE_S3_BUCKET ?? process.env.S3_BUCKET;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    const region = process.env.STORAGE_S3_REGION ?? process.env.AWS_REGION ?? 'us-east-1';

    if (!bucket || !accessKeyId || !secretAccessKey) return null;

    // Virtual-hosted style (S3 real de AWS, target de producción según CLAUDE.md §2).
    const host = `${bucket}.s3.${region}.amazonaws.com`;
    return {
      bucket,
      region,
      accessKeyId,
      secretAccessKey,
      sessionToken: process.env.AWS_SESSION_TOKEN,
      host,
      baseUrl: `https://${host}`,
    };
  }
}
