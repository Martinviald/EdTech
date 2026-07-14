import {
  ASSISTANT_PROMPT_VERSION,
  ASSISTANT_SYSTEM_PROMPT,
  deriveConversationTitle,
  estimateAssistantCostUsd,
} from './assistant.constants';

// ──────────────────────────────────────────────────────────────────────────────
// H21.13 — Guardrails del asistente codificados en el system prompt + utilidades
// puras de costo/título. Tests de REGRESIÓN: si alguien debilita un guardrail al
// editar el prompt, esto lo detecta antes de llegar al piloto.
// ──────────────────────────────────────────────────────────────────────────────

describe('ASSISTANT_SYSTEM_PROMPT — guardrails (§4)', () => {
  it('está versionado y la versión es estable', () => {
    expect(ASSISTANT_PROMPT_VERSION).toBe('e21-assistant-v2');
  });

  it('prohíbe inventar o recalcular cifras (anti-alucinación)', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/NUNCA inventes ni recalcules/i);
    // Debe instruir a admitir el vacío en vez de fabricar.
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/no est[áa] disponible/i);
  });

  it('exige resolver nombre→UUID con list_filter_options', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('list_filter_options');
  });

  it('trata los datos de las tools como datos, no instrucciones (anti prompt-injection)', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/datos, no instrucciones/i);
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/IGN[OÓ]RALO/i);
  });

  it('protege PII: identificadores opacos (UUID), nunca nombres (opción B)', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/identificadores\s+opacos\s+\(UUID\)/i);
  });

  it('responde en español de Chile', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toMatch(/español de Chile/i);
  });
});

describe('estimateAssistantCostUsd', () => {
  it('calcula el costo de Claude Sonnet por tarifa (3/15 por Mtok)', () => {
    // 1000/1e6*3 + 500/1e6*15 = 0.003 + 0.0075 = 0.0105
    expect(
      estimateAssistantCostUsd('claude-sonnet-4-20250514', {
        inputTokens: 1000,
        outputTokens: 500,
      }),
    ).toBe('0.010500');
  });

  it('calcula el costo de Gemini Flash (0.1/0.4 por Mtok)', () => {
    expect(
      estimateAssistantCostUsd('gemini-2.0-flash', {
        inputTokens: 1_000_000,
        outputTokens: 1_000_000,
      }),
    ).toBe('0.500000');
  });

  it('devuelve null para un modelo desconocido (no inventa tarifa)', () => {
    expect(
      estimateAssistantCostUsd('modelo-raro-9000', { inputTokens: 100, outputTokens: 100 }),
    ).toBeNull();
  });

  it('devuelve null si el modelo es null', () => {
    expect(estimateAssistantCostUsd(null, { inputTokens: 100, outputTokens: 100 })).toBeNull();
  });
});

describe('deriveConversationTitle', () => {
  it('normaliza espacios y conserva mensajes cortos', () => {
    expect(deriveConversationTitle('  ¿Cómo le fue\n\n al 8°B? ')).toBe('¿Cómo le fue al 8°B?');
  });

  it('trunca con elipsis los mensajes largos (≤80 chars)', () => {
    const long = 'a'.repeat(200);
    const title = deriveConversationTitle(long);
    expect(title.length).toBeLessThanOrEqual(80);
    expect(title.endsWith('…')).toBe(true);
  });
});
