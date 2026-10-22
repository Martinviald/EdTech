import sharp from 'sharp';

import { choice } from '../questions';
import {
  JEV_IMAGES_HEADER,
  JevDecisionEngine,
  type JevEngineConfig,
  type JevFetch,
} from './jev-engine';
import { JEV_LIMITS } from './jev-limits';

const questions = {
  respuesta: choice('¿Qué respondió?', { A: null, B: null, blank: null, null: null }),
};

const okBody = {
  model: 'jev-1.14.0',
  answers: {
    respuesta: {
      type: 'choice',
      choice: 'B',
      probabilities: { A: 0.02, B: 0.95, blank: 0.02, null: 0.01 },
      confidence: 0.93,
    },
  },
  usage: { input_tokens: 1531, output_tokens: 59 },
};

const API_URL_PREFIX = 'https://api.typesafe.ai';

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  json: Record<string, unknown>;
  parts: Map<string, Buffer>;
}

async function blankJpegBase64(width: number, height: number): Promise<string> {
  const buffer = await sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .jpeg()
    .toBuffer();
  return buffer.toString('base64');
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function bodyBytes(body: RequestInit['body']): Promise<Buffer> {
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  if (typeof body === 'string') return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  throw new Error('cuerpo de request no soportado en el test');
}

function parseMultipart(bytes: Buffer, contentType: string): Map<string, Buffer> {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
  if (!boundary) throw new Error('sin boundary');
  const parts = new Map<string, Buffer>();
  const delimiter = Buffer.from(`--${boundary}`);
  let cursor = bytes.indexOf(delimiter);
  while (cursor !== -1) {
    const next = bytes.indexOf(delimiter, cursor + delimiter.length);
    if (next === -1) break;
    const chunk = bytes.subarray(cursor + delimiter.length + 2, next - 2);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    const header = chunk.subarray(0, headerEnd).toString('utf8');
    const name = /name="([^"]+)"/.exec(header)?.[1];
    if (name) parts.set(name, chunk.subarray(headerEnd + 4));
    cursor = next;
  }
  return parts;
}

function recordingFetch(options: { imageResponse?: () => Response } = {}) {
  const requests: CapturedRequest[] = [];
  const downloads: string[] = [];
  const fetch: jest.MockedFunction<JevFetch> = jest.fn(async (url, init) => {
    if (!url.startsWith(API_URL_PREFIX)) {
      downloads.push(url);
      return options.imageResponse ? options.imageResponse() : new Response('', { status: 404 });
    }
    const headers = Object.fromEntries(new Headers(init?.headers).entries());
    const bytes = await bodyBytes(init?.body);
    const contentType = headers['content-type'] ?? '';
    if (contentType.startsWith('multipart/form-data')) {
      const parts = parseMultipart(bytes, contentType);
      const request = parts.get('request');
      if (!request) throw new Error('sin parte request');
      requests.push({ url, headers, json: JSON.parse(request.toString('utf8')), parts });
    } else {
      requests.push({ url, headers, json: JSON.parse(bytes.toString('utf8')), parts: new Map() });
    }
    return jsonResponse(200, okBody);
  });
  return { fetch, requests, downloads };
}

function engineWith(fetch: JevFetch, extra: Partial<JevEngineConfig> = {}): JevDecisionEngine {
  return new JevDecisionEngine({
    apiKey: 'test-key',
    fetch,
    maxRetries: 0,
    compression: false,
    experimentalImages: true,
    ...extra,
  });
}

function onlyRequest(requests: CapturedRequest[]): CapturedRequest {
  const [request] = requests;
  if (request === undefined || requests.length !== 1) throw new Error('se esperaba un request');
  return request;
}

describe('JevDecisionEngine con imágenes', () => {
  it('con experimentalImages declara capabilities.images', () => {
    expect(engineWith(jest.fn()).capabilities.images).toBe(true);
  });

  it('envía el header de imágenes solo cuando hay imágenes', async () => {
    const { fetch, requests } = recordingFetch();
    const engine = engineWith(fetch);

    await engine.evaluate({ state: { descripcion: 'x' }, questions });
    await engine.evaluate({
      state: { descripcion: 'x' },
      images: [{ mimeType: 'image/jpeg', data: await blankJpegBase64(250, 68) }],
      questions,
    });

    expect(requests[0]?.headers[JEV_IMAGES_HEADER.toLowerCase()]).toBeUndefined();
    expect(requests[1]?.headers[JEV_IMAGES_HEADER.toLowerCase()]).toBe('true');
  });

  it('agrega la referencia de la imagen al estado bajo `imagen` y la declara en assets', async () => {
    const { fetch, requests } = recordingFetch();
    const result = await engineWith(fetch).evaluate({
      state: { descripcion: 'Recorte de una pregunta.' },
      images: [{ mimeType: 'image/jpeg', data: await blankJpegBase64(250, 68) }],
      questions,
    });

    const request = onlyRequest(requests);
    const state = request.json.state as Record<string, unknown>;
    const assets = request.json.assets as Record<string, { type: string; part: string }>;
    expect(state.descripcion).toBe('Recorte de una pregunta.');
    expect(typeof state.imagen).toBe('string');
    const reference = state.imagen as string;
    expect(assets[reference]).toEqual({ type: 'image', part: 'asset-0' });
    expect(result.answers.respuesta.choice).toBe('B');
  });

  it('reescala el recorte de 250×68 a 1103×300 antes de enviarlo', async () => {
    const { fetch, requests } = recordingFetch();
    await engineWith(fetch).evaluate({
      state: { descripcion: 'x' },
      images: [{ mimeType: 'image/jpeg', data: await blankJpegBase64(250, 68) }],
      questions,
    });

    const asset = onlyRequest(requests).parts.get('asset-0');
    if (!asset) throw new Error('sin parte de imagen');
    expect(await sharp(asset).metadata()).toMatchObject({
      format: 'jpeg',
      width: 1103,
      height: 300,
    });
  });

  it('con relación de aspecto > 5,6 reduce a 1568 y rellena hasta 280', async () => {
    const { fetch, requests } = recordingFetch();
    await engineWith(fetch).evaluate({
      state: { descripcion: 'x' },
      images: [{ mimeType: 'image/jpeg', data: await blankJpegBase64(1000, 100) }],
      questions,
    });

    const asset = onlyRequest(requests).parts.get('asset-0');
    if (!asset) throw new Error('sin parte de imagen');
    expect(await sharp(asset).metadata()).toMatchObject({ width: 1568, height: 280 });
  });

  it('envuelve un estado de texto en { texto, imagen }', async () => {
    const { fetch, requests } = recordingFetch();
    await engineWith(fetch).evaluate({
      state: 'Recorte de una pregunta.',
      images: [{ mimeType: 'image/jpeg', data: await blankJpegBase64(250, 68) }],
      questions,
    });

    const state = onlyRequest(requests).json.state as Record<string, unknown>;
    expect(state.texto).toBe('Recorte de una pregunta.');
    expect(typeof state.imagen).toBe('string');
  });

  it('rechaza un estado que ya trae la clave reservada `imagen` sin llamar a la red', async () => {
    const { fetch } = recordingFetch();
    await expect(
      engineWith(fetch).evaluate({
        state: { imagen: 'mía' },
        images: [{ mimeType: 'image/jpeg', data: await blankJpegBase64(250, 68) }],
        questions,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('descarga una imagen { url } y la envía como bytes', async () => {
    const jpeg = Buffer.from(await blankJpegBase64(250, 68), 'base64');
    const { fetch, requests, downloads } = recordingFetch({
      imageResponse: () => new Response(jpeg, { status: 200 }),
    });
    await engineWith(fetch).evaluate({
      state: { descripcion: 'x' },
      images: [{ url: 'https://files.test/recorte.jpg?firma=1' }],
      questions,
    });

    expect(downloads).toEqual(['https://files.test/recorte.jpg?firma=1']);
    expect(onlyRequest(requests).parts.get('asset-0')).toBeDefined();
  });

  it('traduce un 404 al descargar la imagen a upstream', async () => {
    const { fetch, requests } = recordingFetch();
    await expect(
      engineWith(fetch).evaluate({
        state: { descripcion: 'x' },
        images: [{ url: 'https://files.test/no-existe.jpg' }],
        questions,
      }),
    ).rejects.toMatchObject({ code: 'upstream' });
    expect(requests).toHaveLength(0);
  });

  it('sin experimentalImages rechaza imágenes con invalid_request', async () => {
    const { fetch } = recordingFetch();
    const engine = engineWith(fetch, { experimentalImages: false });
    expect(engine.capabilities.images).toBe(false);
    await expect(
      engine.evaluate({
        state: { descripcion: 'x' },
        images: [{ mimeType: 'image/jpeg', data: await blankJpegBase64(250, 68) }],
        questions,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('cuenta tokensPerImage al validar el contexto', async () => {
    const { fetch } = recordingFetch();
    const engine = engineWith(fetch);
    const stateTokens = JEV_LIMITS.maxStatePlusQuestionTokens - JEV_LIMITS.tokensPerImage + 100;
    const state = 'x'.repeat(stateTokens * JEV_LIMITS.charsPerToken - 10);

    await expect(
      engine.evaluate({ state, questions: {} as typeof questions }),
    ).rejects.toBeTruthy();
    await expect(
      engine.evaluate({ state: state.slice(0, 3_000 * 3), questions }),
    ).resolves.toBeTruthy();
    await expect(
      engine.evaluate({
        state,
        images: [{ mimeType: 'image/jpeg', data: await blankJpegBase64(250, 68) }],
        questions,
      }),
    ).rejects.toMatchObject({ code: 'context_exceeded' });
    expect(JEV_LIMITS.tokensPerImage).toBe(3_000);
  });
});
