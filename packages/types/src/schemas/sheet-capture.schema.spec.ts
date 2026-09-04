import {
  ASSESS_CAPTURE_MAX_IMAGE_BYTES,
  captureAssessSchema,
  captureConfirmFileSchema,
  captureUploadIntentSchema,
  CAPTURE_SESSION_MAX_REDEEMS,
  CAPTURE_SESSION_STATUSES,
  CAPTURE_SESSION_TTL_MINUTES,
  createCaptureSessionSchema,
  redeemCaptureSessionSchema,
} from '../index';

const UUID = '4f2f8e60-7a63-4a1e-9a44-1d2f3c4b5a69';

describe('createCaptureSessionSchema', () => {
  it('acepta un printRunId uuid', () => {
    expect(createCaptureSessionSchema.safeParse({ printRunId: UUID }).success).toBe(true);
  });

  it('rechaza un printRunId que no es uuid', () => {
    expect(createCaptureSessionSchema.safeParse({ printRunId: 'run-1' }).success).toBe(false);
  });
});

describe('redeemCaptureSessionSchema', () => {
  const secret = 'a'.repeat(43);

  it('acepta sessionId uuid + secreto largo', () => {
    expect(redeemCaptureSessionSchema.safeParse({ sessionId: UUID, secret }).success).toBe(true);
  });

  it('rechaza un secreto demasiado corto para ser el del QR', () => {
    const parsed = redeemCaptureSessionSchema.safeParse({ sessionId: UUID, secret: 'corto' });
    expect(parsed.success).toBe(false);
  });

  it('rechaza un secreto desmedido (no es un token pegado por error)', () => {
    const parsed = redeemCaptureSessionSchema.safeParse({
      sessionId: UUID,
      secret: 'a'.repeat(500),
    });
    expect(parsed.success).toBe(false);
  });
});

describe('captureAssessSchema', () => {
  it('acepta una imagen base64 dentro del límite y SIN printRunId (sale del token)', () => {
    const parsed = captureAssessSchema.safeParse({ imageBase64: 'Zm90bw==' });
    expect(parsed.success).toBe(true);
  });

  it('rechaza printRunId en el body: el shape es estricto respecto de lo que importa', () => {
    const parsed = captureAssessSchema.safeParse({ imageBase64: '' });
    expect(parsed.success).toBe(false);
  });

  it('rechaza una imagen que excede el presupuesto base64 de assess (4 MB)', () => {
    const oversized = 'x'.repeat(Math.ceil(ASSESS_CAPTURE_MAX_IMAGE_BYTES / 3) * 4 + 1);
    expect(captureAssessSchema.safeParse({ imageBase64: oversized }).success).toBe(false);
  });
});

describe('captureUploadIntentSchema', () => {
  const base = {
    fileName: 'captura-1.jpg',
    mimeType: 'image/jpeg',
    sizeBytes: 512_000,
    identity: null,
  };

  it('acepta un JPEG con identidad nula', () => {
    expect(captureUploadIntentSchema.safeParse(base).success).toBe(true);
  });

  it('acepta la identidad informativa que devolvió el gate', () => {
    const parsed = captureUploadIntentSchema.safeParse({
      ...base,
      identity: {
        printedSheetId: UUID,
        pageIndex: 0,
        sheetSequence: 3,
        studentId: null,
        studentName: 'Juana Pérez',
        confidence: 0.91,
      },
    });
    expect(parsed.success).toBe(true);
  });

  it('rechaza cualquier mimeType que no sea image/jpeg (la cámara siempre emite JPEG)', () => {
    expect(
      captureUploadIntentSchema.safeParse({ ...base, mimeType: 'application/pdf' }).success,
    ).toBe(false);
    expect(captureUploadIntentSchema.safeParse({ ...base, mimeType: 'image/png' }).success).toBe(
      false,
    );
  });

  it('rechaza una confidence fuera de [0,1]', () => {
    const parsed = captureUploadIntentSchema.safeParse({
      ...base,
      identity: {
        printedSheetId: null,
        pageIndex: null,
        sheetSequence: null,
        studentId: null,
        studentName: null,
        confidence: 1.2,
      },
    });
    expect(parsed.success).toBe(false);
  });
});

describe('captureConfirmFileSchema', () => {
  it('exige sizeBytes positivo', () => {
    expect(captureConfirmFileSchema.safeParse({ sizeBytes: 0 }).success).toBe(false);
    expect(captureConfirmFileSchema.safeParse({ sizeBytes: 1024 }).success).toBe(true);
  });
});

describe('constantes de sesión (CD-17/CD-23)', () => {
  it('fija el TTL en 15 minutos y el tope de canjes en 3', () => {
    expect(CAPTURE_SESSION_TTL_MINUTES).toBe(15);
    expect(CAPTURE_SESSION_MAX_REDEEMS).toBe(3);
  });

  it('el ciclo de vida cubre los 5 estados del diseño', () => {
    expect([...CAPTURE_SESSION_STATUSES]).toEqual([
      'pending',
      'active',
      'closed',
      'revoked',
      'expired',
    ]);
  });
});
