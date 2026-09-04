import type { OmrAssessRequest, OmrAssessResult, OmrReadRequest, ScanResult } from '@soe/types';
import {
  OmrPageTimeoutError,
  OmrServiceUnavailableError,
  OmrSourceUnreadableError,
} from './omr-client.types';
import {
  HttpOmrClient,
  OmrInvalidResponseError,
  OmrRequestRejectedError,
  type OmrFetchFn,
  type OmrFetchResponse,
} from './omr-http.client';

const REQUEST = {
  layoutSpec: { specVersion: 1 },
  captureProfile: { source: 'scanner' },
  source: { kind: 'pdf', pdfUrl: 'https://signed.example/lote.pdf', imageUrls: null },
} as unknown as OmrReadRequest;

const VALID_RESULT: ScanResult = {
  pages: [
    {
      pageIndex: 0,
      imageSha256: 'a'.repeat(64),
      quality: { ok: true, sharpness: 0.9, glare: 0.05, fiducialsFound: 4, rejectReason: null },
      identity: { mode: 'qr', raw: null, confidence: 0 },
      marks: [],
      pageThumbJpegBase64: null,
    },
  ],
};

function jsonResponse(status: number, body: unknown): OmrFetchResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function makeFetch(responses: (OmrFetchResponse | Error)[]): {
  fetchFn: OmrFetchFn;
  calls: { url: string; body: string; headers: Record<string, string> }[];
} {
  const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
  const fetchFn: OmrFetchFn = (url, init) => {
    calls.push({ url, body: init.body, headers: init.headers });
    const next = responses.shift();
    if (!next) return Promise.reject(new Error('sin respuestas encoladas'));
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve(next);
  };
  return { fetchFn, calls };
}

function makeClient(fetchFn: OmrFetchFn, timeoutMs = 5000): HttpOmrClient {
  return new HttpOmrClient({ serviceUrl: 'http://omr.test:8090', timeoutMs, fetchFn });
}

describe('HttpOmrClient.read', () => {
  it('postea el OmrReadRequest a /v1/read y devuelve el ScanResult validado', async () => {
    const { fetchFn, calls } = makeFetch([jsonResponse(200, VALID_RESULT)]);
    const client = makeClient(fetchFn);

    const result = await client.read(REQUEST);

    expect(result.pages).toHaveLength(1);
    expect(result.pages[0].imageSha256).toBe('a'.repeat(64));
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://omr.test:8090/v1/read');
    expect(JSON.parse(calls[0].body)).toEqual(REQUEST);
  });

  it('una respuesta 200 bien formada pero inválida lanza OmrInvalidResponseError', async () => {
    const { fetchFn } = makeFetch([jsonResponse(200, { pages: [{ pageIndex: 'no-un-numero' }] })]);
    const client = makeClient(fetchFn);

    await expect(client.read(REQUEST)).rejects.toBeInstanceOf(OmrInvalidResponseError);
  });

  it('un 200 con cuerpo no-JSON lanza OmrInvalidResponseError', async () => {
    const { fetchFn } = makeFetch([
      {
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('unexpected token')),
        text: () => Promise.resolve('<html>'),
      },
    ]);
    const client = makeClient(fetchFn);

    await expect(client.read(REQUEST)).rejects.toBeInstanceOf(OmrInvalidResponseError);
  });

  it('reintenta UNA vez tras un 502 y devuelve el resultado del segundo intento', async () => {
    const { fetchFn, calls } = makeFetch([jsonResponse(502, {}), jsonResponse(200, VALID_RESULT)]);
    const client = makeClient(fetchFn);

    const result = await client.read(REQUEST);

    expect(result.pages).toHaveLength(1);
    expect(calls).toHaveLength(2);
  });

  it('dos 502 seguidos lanzan OmrSourceUnreadableError, no un fallo de disponibilidad', async () => {
    const { fetchFn, calls } = makeFetch([jsonResponse(502, {}), jsonResponse(502, {})]);
    const client = makeClient(fetchFn);

    const error = await client.read(REQUEST).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(OmrSourceUnreadableError);
    expect(error).not.toBeInstanceOf(OmrServiceUnavailableError);
    expect(calls).toHaveLength(2);
  });

  it('un 503 (servicio realmente caído) sigue lanzando OmrServiceUnavailableError', async () => {
    const { fetchFn } = makeFetch([jsonResponse(503, {}), jsonResponse(503, {})]);
    const client = makeClient(fetchFn);

    await expect(client.read(REQUEST)).rejects.toBeInstanceOf(OmrServiceUnavailableError);
  });

  it('un error de red reintenta una vez y luego lanza OmrServiceUnavailableError', async () => {
    const { fetchFn, calls } = makeFetch([new Error('ECONNREFUSED'), new Error('ECONNREFUSED')]);
    const client = makeClient(fetchFn);

    await expect(client.read(REQUEST)).rejects.toBeInstanceOf(OmrServiceUnavailableError);
    expect(calls).toHaveLength(2);
  });

  it('un 504 lanza OmrPageTimeoutError sin reintentar', async () => {
    const { fetchFn, calls } = makeFetch([jsonResponse(504, {})]);
    const client = makeClient(fetchFn);

    await expect(client.read(REQUEST)).rejects.toBeInstanceOf(OmrPageTimeoutError);
    expect(calls).toHaveLength(1);
  });

  it('un 422 lanza OmrRequestRejectedError con el detalle, sin reintentar', async () => {
    const { fetchFn, calls } = makeFetch([jsonResponse(422, { detail: 'layoutSpec inválido' })]);
    const client = makeClient(fetchFn);

    const promise = client.read(REQUEST);
    await expect(promise).rejects.toBeInstanceOf(OmrRequestRejectedError);
    await expect(promise).rejects.toThrow('layoutSpec inválido');
    expect(calls).toHaveLength(1);
  });

  it('el timeout total aborta la llamada y lanza OmrPageTimeoutError', async () => {
    const fetchFn: OmrFetchFn = (_url, init) =>
      new Promise((_resolve, reject) => {
        init.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
    const client = makeClient(fetchFn, 20);

    await expect(client.read(REQUEST)).rejects.toBeInstanceOf(OmrPageTimeoutError);
  });
});

describe('HttpOmrClient.assess (CD-11)', () => {
  const ASSESS_REQUEST = {
    layoutSpec: { specVersion: 1 },
    captureProfile: { source: 'phone' },
    imageBase64: 'Zm90by1qcGVn',
  } as unknown as OmrAssessRequest;

  const VALID_ASSESS_RESULT: OmrAssessResult = {
    imageSha256: 'b'.repeat(64),
    quality: { ok: true, sharpness: 0.7, glare: 0.1, fiducialsFound: 4, rejectReason: null },
    identity: { mode: 'rut_bubbles', raw: '123456785', confidence: 0.8 },
  };

  it('postea el OmrAssessRequest a /v1/assess y devuelve el OmrAssessResult validado', async () => {
    const { fetchFn, calls } = makeFetch([jsonResponse(200, VALID_ASSESS_RESULT)]);
    const client = makeClient(fetchFn);

    const result = await client.assess(ASSESS_REQUEST);

    expect(result).toEqual(VALID_ASSESS_RESULT);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('http://omr.test:8090/v1/assess');
    expect(JSON.parse(calls[0].body)).toEqual(ASSESS_REQUEST);
  });

  it('un 200 con cuerpo inválido lanza OmrInvalidResponseError', async () => {
    const { fetchFn } = makeFetch([jsonResponse(200, { quality: {} })]);
    const client = makeClient(fetchFn);

    await expect(client.assess(ASSESS_REQUEST)).rejects.toBeInstanceOf(OmrInvalidResponseError);
  });

  it('un 422 lanza OmrRequestRejectedError sin reintentar', async () => {
    const { fetchFn, calls } = makeFetch([jsonResponse(422, { detail: 'imageBase64 inválido' })]);
    const client = makeClient(fetchFn);

    await expect(client.assess(ASSESS_REQUEST)).rejects.toBeInstanceOf(OmrRequestRejectedError);
    expect(calls).toHaveLength(1);
  });

  it('reintenta UNA vez tras un 502 y luego lanza OmrSourceUnreadableError', async () => {
    const { fetchFn, calls } = makeFetch([jsonResponse(502, {}), jsonResponse(502, {})]);
    const client = makeClient(fetchFn);

    await expect(client.assess(ASSESS_REQUEST)).rejects.toBeInstanceOf(OmrSourceUnreadableError);
    expect(calls).toHaveLength(2);
  });
});

describe('HttpOmrClient — token de servicio (M5)', () => {
  it('manda x-omr-token cuando el cliente tiene serviceToken', async () => {
    const { fetchFn, calls } = makeFetch([jsonResponse(200, VALID_RESULT)]);
    const client = new HttpOmrClient({
      serviceUrl: 'http://omr.test:8090',
      timeoutMs: 5000,
      fetchFn,
      serviceToken: 'secreto-compartido',
    });

    await client.read(REQUEST);

    expect(calls[0].headers['x-omr-token']).toBe('secreto-compartido');
  });

  it('no manda el header cuando no hay token configurado', async () => {
    const previous = process.env.OMR_SERVICE_TOKEN;
    delete process.env.OMR_SERVICE_TOKEN;
    try {
      const { fetchFn, calls } = makeFetch([jsonResponse(200, VALID_RESULT)]);
      const client = makeClient(fetchFn);

      await client.read(REQUEST);

      expect(calls[0].headers).not.toHaveProperty('x-omr-token');
    } finally {
      if (previous !== undefined) process.env.OMR_SERVICE_TOKEN = previous;
    }
  });

  it('toma el token de OMR_SERVICE_TOKEN cuando no viene por opciones', async () => {
    const previous = process.env.OMR_SERVICE_TOKEN;
    process.env.OMR_SERVICE_TOKEN = 'token-de-env';
    try {
      const { fetchFn, calls } = makeFetch([jsonResponse(200, VALID_RESULT)]);
      const client = makeClient(fetchFn);

      await client.read(REQUEST);

      expect(calls[0].headers['x-omr-token']).toBe('token-de-env');
    } finally {
      if (previous === undefined) delete process.env.OMR_SERVICE_TOKEN;
      else process.env.OMR_SERVICE_TOKEN = previous;
    }
  });
});
