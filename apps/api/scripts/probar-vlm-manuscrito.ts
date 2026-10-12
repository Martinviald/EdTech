import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenAI, MediaResolution, Type } from '@google/genai';
import { config as loadEnv } from 'dotenv';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const DEFAULT_WORKDIR = resolve(REPO_ROOT, '..', 'pruebas-vlm-manuscrito');

loadEnv({ path: join(REPO_ROOT, '.env') });

type Provider = 'anthropic' | 'gemini';

interface ModelSpec {
  id: string;
  provider: Provider;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

const MODELS: Record<string, ModelSpec> = {
  'claude-haiku-5-5': {
    id: 'claude-haiku-5-5',
    provider: 'anthropic',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.5,
  },
  'gemini-2.5-flash-lite': {
    id: 'gemini-2.5-flash-lite',
    provider: 'gemini',
    inputUsdPerMTok: 0.1,
    outputUsdPerMTok: 0.4,
  },
  'gemini-3.1-flash-lite': {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    inputUsdPerMTok: 0.25,
    outputUsdPerMTok: 1.5,
  },
  'gemini-3.5-flash-lite': {
    id: 'gemini-3.5-flash-lite',
    provider: 'gemini',
    inputUsdPerMTok: 0.3,
    outputUsdPerMTok: 2.5,
  },
};

const DEFAULT_MODEL_IDS = ['claude-haiku-5-5', 'gemini-3.1-flash-lite', 'gemini-3.5-flash-lite'];

const MIME_BY_EXT: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const CONVERTIBLE_EXTS = new Set(['.heic', '.heif', '.tif', '.tiff', '.bmp']);

const READING_STATES = [
  'answered',
  'blank',
  'illegible',
  'crossed_out_only',
  'multiple_answers',
] as const;

type PromptVersion = 'v1' | 'v2';

interface PromptSet {
  system: string;
  userInstruction: string;
  formatLine: (hint: string) => string;
  jsonSchema: Record<string, unknown>;
  geminiSchema: Record<string, unknown>;
}

const ALTERNATIVES_JSON = {
  type: 'array',
  items: {
    type: 'object',
    properties: { literal: { type: 'string' }, plausibility: { type: 'number' } },
    required: ['literal', 'plausibility'],
    additionalProperties: false,
  },
};

const ALTERNATIVES_GEMINI = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: { literal: { type: Type.STRING }, plausibility: { type: Type.NUMBER } },
    required: ['literal', 'plausibility'],
  },
};

const PROMPT_V1: PromptSet = {
  system: [
    'Eres un transcriptor de respuestas manuscritas de estudiantes chilenos de 7 a 16 años.',
    'Tu única tarea es copiar EXACTAMENTE lo que está escrito en la imagen, carácter por carácter.',
    'No corrijas, no completes, no simplifiques, no conviertas formatos y no evalúes si la respuesta es correcta.',
    'Conserva la coma decimal tal como está escrita (por ejemplo "3,5" se transcribe "3,5", nunca "3.5").',
    'Si un carácter es dudoso, transcribe la lectura más probable y registra las otras lecturas plausibles en "alternativeReadings".',
    'Si no hay nada escrito, usa el estado "blank". Si hay trazos pero no se pueden leer, usa "illegible".',
    'Si todo lo escrito está tachado, usa "crossed_out_only". Si hay más de una respuesta sin tachar, usa "multiple_answers".',
  ].join(' '),
  userInstruction: 'Transcribe literalmente la respuesta manuscrita de la imagen.',
  formatLine: (hint) =>
    `Formato esperado de la respuesta: ${hint}. Úsalo solo para ubicar la respuesta, no para corregirla.`,
  jsonSchema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: [...READING_STATES] },
      literal: {
        type: 'string',
        description: 'Transcripción literal; vacío si no hay respuesta legible',
      },
      alternativeReadings: ALTERNATIVES_JSON,
      confidence: {
        type: 'number',
        description: 'Confianza entre 0 y 1 en la transcripción principal',
      },
      notes: { type: 'string' },
    },
    required: ['status', 'literal', 'alternativeReadings', 'confidence', 'notes'],
    additionalProperties: false,
  },
  geminiSchema: {
    type: Type.OBJECT,
    properties: {
      status: { type: Type.STRING, enum: [...READING_STATES] },
      literal: { type: Type.STRING },
      alternativeReadings: ALTERNATIVES_GEMINI,
      confidence: { type: Type.NUMBER },
      notes: { type: Type.STRING },
    },
    required: ['status', 'literal', 'alternativeReadings', 'confidence', 'notes'],
    propertyOrdering: ['status', 'literal', 'alternativeReadings', 'confidence', 'notes'],
  },
};

const PROMPT_V2: PromptSet = {
  system: `Eres un transcriptor experto de respuestas manuscritas en pruebas escolares chilenas (matemática, lenguaje, ciencias). La imagen es el recorte de UNA casilla de respuesta, escrita a mano por un estudiante de 7 a 16 años. Tu transcripción la usará después otro sistema para corregir; tu trabajo NO es corregir, sino leer con exactitud.

REGLAS DE FIDELIDAD
- Copia exactamente lo que el estudiante escribió, aunque sea un error matemático o tenga un formato raro. No corrijas, no completes, no simplifiques, no calcules y no evalúes.
- Conserva los ceros a la izquierda y a la derecha tal como están ("02,5" se transcribe "02,5"; "3,50" se transcribe "3,50").
- Conserva el separador tal como está escrito, sea coma o punto: "1.82" se transcribe "1.82" y "2,5" se transcribe "2,5". Nunca cambies uno por otro.
- Un trazo corto cerca de la línea base, entre dos dígitos, es un separador (coma o punto): transcríbelo siempre, no lo omitas.

CÓMO LEER
Primero analiza cada carácter de izquierda a derecha en "characters": describe brevemente la forma del trazo, tu lectura y las lecturas alternativas plausibles. Solo después escribe "literal", que debe coincidir con ese análisis.

VARIANTES FRECUENTES EN ESCRITURA INFANTIL
- 8: a veces queda abierto arriba o se dibuja como un lazo con cola; puede parecer γ, y, P o un 7 con lazo.
- 1: puede tener un trazo inicial largo y parecer ^, Λ, A o 7.
- 2: puede parecer Z, z o una curva sin base.
- 3: puede parecer ʒ o una S invertida.
- 4: puede quedar abierto arriba y parecer u o y.
- 5: puede parecer S.
- 9: puede parecer g o q.
- 0: puede parecer o; 7 y 1 se confunden entre sí.
Si un trazo puede ser un dígito o una letra y la respuesta es numérica (no hay otras letras que indiquen una expresión algebraica), léelo como dígito y registra la letra como alternativa.

NOTACIÓN DE SALIDA (sin espacios)
- Exponentes con ^ y paréntesis si tienen más de un carácter: a^2, 8^(1/4).
- Raíz cuadrada: sqrt(...). Raíz cúbica: cbrt(...).
- Fracciones, tanto diagonales como verticales: numerador/denominador, por ejemplo 3/4.
- Conserva los signos =, +, -, ×, : y paréntesis tal como aparecen.

ESTADOS
- "blank": no hay nada escrito.
- "illegible": hay trazos, pero no se pueden leer.
- "crossed_out_only": todo lo escrito está tachado.
- "multiple_answers": hay más de una respuesta sin tachar.
- "answered": en cualquier otro caso.

CONFIANZA
"confidence" es la probabilidad de que "literal" sea exactamente correcto, carácter por carácter. Si algún carácter tiene una alternativa plausible, la confianza debe ser 0,7 o menos y debes incluir en "alternativeReadings" la transcripción completa con esa alternativa.

Escribe "notes" en español, en una frase breve.`,
  userInstruction:
    'Transcribe la respuesta manuscrita de esta casilla siguiendo las instrucciones.',
  formatLine: (hint) =>
    `Tipo de respuesta que pide la pregunta: ${hint}. Úsalo para interpretar los trazos ambiguos, pero transcribe lo que el estudiante escribió aunque no calce con ese tipo.`,
  jsonSchema: {
    type: 'object',
    properties: {
      characters: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            shape: { type: 'string' },
            reading: { type: 'string' },
            alternatives: { type: 'array', items: { type: 'string' } },
          },
          required: ['shape', 'reading', 'alternatives'],
          additionalProperties: false,
        },
      },
      status: { type: 'string', enum: [...READING_STATES] },
      literal: { type: 'string' },
      alternativeReadings: ALTERNATIVES_JSON,
      confidence: { type: 'number' },
      notes: { type: 'string' },
    },
    required: ['characters', 'status', 'literal', 'alternativeReadings', 'confidence', 'notes'],
    additionalProperties: false,
  },
  geminiSchema: {
    type: Type.OBJECT,
    properties: {
      characters: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            shape: { type: Type.STRING },
            reading: { type: Type.STRING },
            alternatives: { type: Type.ARRAY, items: { type: Type.STRING } },
          },
          required: ['shape', 'reading', 'alternatives'],
          propertyOrdering: ['shape', 'reading', 'alternatives'],
        },
      },
      status: { type: Type.STRING, enum: [...READING_STATES] },
      literal: { type: Type.STRING },
      alternativeReadings: ALTERNATIVES_GEMINI,
      confidence: { type: Type.NUMBER },
      notes: { type: Type.STRING },
    },
    required: ['characters', 'status', 'literal', 'alternativeReadings', 'confidence', 'notes'],
    propertyOrdering: [
      'characters',
      'status',
      'literal',
      'alternativeReadings',
      'confidence',
      'notes',
    ],
  },
};

const PROMPTS: Record<PromptVersion, PromptSet> = { v1: PROMPT_V1, v2: PROMPT_V2 };

interface CliOptions {
  photosDir: string;
  outputDir: string;
  models: ModelSpec[];
  expectedPath: string | null;
  repetitions: number;
  formatHint: string | null;
  formatsPath: string | null;
  promptVersion: PromptVersion;
  maxSide: number;
  geminiResolution: 'low' | 'medium' | 'high';
}

interface Usage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  imageTokens: number | null;
}

interface RunResult {
  photo: string;
  model: string;
  promptVersion: PromptVersion;
  formatHint: string | null;
  repetition: number;
  ok: boolean;
  error: string | null;
  status: string | null;
  literal: string | null;
  confidence: number | null;
  alternatives: string;
  notes: string | null;
  expected: string | null;
  matchesExpected: boolean | null;
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  imageTokens: number | null;
  costUsd: number;
  latencyMs: number;
}

interface PreparedImage {
  name: string;
  mimeType: string;
  base64: string;
  width: number | null;
  height: number | null;
}

function parseArgs(argv: string[]): CliOptions {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help' || key === '-h') {
      printHelp();
      process.exit(0);
    }
    if (key.startsWith('--')) {
      args.set(key.slice(2), argv[i + 1] ?? '');
      i++;
    }
  }

  const modelIds = (args.get('modelos') ?? DEFAULT_MODEL_IDS.join(','))
    .split(',')
    .map((m) => m.trim());
  const models = modelIds.map((id) => {
    const spec = MODELS[id];
    if (!spec)
      throw new Error(`Modelo desconocido: ${id}. Disponibles: ${Object.keys(MODELS).join(', ')}`);
    return spec;
  });

  const resolution = args.get('resolucion-gemini') ?? 'medium';
  if (resolution !== 'low' && resolution !== 'medium' && resolution !== 'high') {
    throw new Error('--resolucion-gemini debe ser low, medium o high');
  }

  const promptVersion = args.get('prompt') ?? 'v2';
  if (promptVersion !== 'v1' && promptVersion !== 'v2')
    throw new Error('--prompt debe ser v1 o v2');

  const photosDir = resolve(args.get('fotos') ?? join(DEFAULT_WORKDIR, 'fotos'));
  const defaultExpected = join(photosDir, 'esperado.json');

  return {
    photosDir,
    outputDir: resolve(args.get('salida') ?? join(DEFAULT_WORKDIR, 'resultados')),
    models,
    expectedPath: args.get('esperado') ?? (existsSync(defaultExpected) ? defaultExpected : null),
    repetitions: Math.max(1, Number(args.get('repeticiones') ?? '1')),
    formatHint: args.get('formato') ?? null,
    formatsPath: args.get('formatos') ?? null,
    promptVersion,
    maxSide: Number(args.get('max-lado') ?? '1568'),
    geminiResolution: resolution,
  };
}

function printHelp(): void {
  console.log(`
Prueba de transcripción manuscrita con modelos de visión.

Uso (desde apps/api):
  pnpm exec tsx scripts/probar-vlm-manuscrito.ts [opciones]

Opciones:
  --fotos <dir>               Carpeta con las fotos (default: ../pruebas-vlm-manuscrito/fotos)
  --esperado <archivo.json>   {"foto1.jpg": "3,5", ...} para medir aciertos (default: fotos/esperado.json si existe)
  --modelos <a,b,c>           Default: ${DEFAULT_MODEL_IDS.join(',')}. Disponibles: ${Object.keys(MODELS).join(', ')}
  --repeticiones <n>          Veces que se envía cada foto a cada modelo (mide estabilidad). Default 1
  --prompt <v1|v2>            Versión del prompt. Default v2
  --formato <texto>           Pista del formato esperado para TODAS las fotos, p. ej. "fracción"
  --formatos <archivo.json>   {"foto1.jpg": "número", ...} pista por foto (tiene prioridad sobre --formato)
  --max-lado <px>             Reduce la foto a este lado máximo antes de enviarla. Default 1568 (0 = sin reducir)
  --resolucion-gemini <nivel> low | medium | high. Default medium
  --salida <dir>              Carpeta de resultados (default: ../pruebas-vlm-manuscrito/resultados)
`);
}

function listPhotos(dir: string): string[] {
  if (!existsSync(dir)) throw new Error(`No existe la carpeta de fotos: ${dir}`);
  const files = readdirSync(dir)
    .filter((f) => !f.startsWith('.'))
    .filter((f) => {
      const ext = extname(f).toLowerCase();
      return ext in MIME_BY_EXT || CONVERTIBLE_EXTS.has(ext);
    })
    .sort();
  if (files.length === 0) throw new Error(`No hay fotos (jpg, png, webp, heic) en ${dir}`);
  return files.map((f) => join(dir, f));
}

function readDimensions(path: string): { width: number | null; height: number | null } {
  try {
    const out = execFileSync('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', path], {
      encoding: 'utf8',
    });
    const width = Number(/pixelWidth: (\d+)/.exec(out)?.[1]);
    const height = Number(/pixelHeight: (\d+)/.exec(out)?.[1]);
    return {
      width: Number.isFinite(width) ? width : null,
      height: Number.isFinite(height) ? height : null,
    };
  } catch {
    return { width: null, height: null };
  }
}

function prepareImage(path: string, maxSide: number, scratchDir: string): PreparedImage {
  const ext = extname(path).toLowerCase();
  const needsConversion = CONVERTIBLE_EXTS.has(ext);
  const original = readDimensions(path);
  const needsResize =
    maxSide > 0 &&
    original.width !== null &&
    original.height !== null &&
    Math.max(original.width, original.height) > maxSide;

  let finalPath = path;
  let mimeType = MIME_BY_EXT[ext] ?? 'image/jpeg';

  if (needsConversion || needsResize) {
    finalPath = join(scratchDir, `${basename(path, extname(path))}.jpg`);
    const sipsArgs = ['-s', 'format', 'jpeg', '-s', 'formatOptions', '90'];
    if (needsResize) sipsArgs.push('-Z', String(maxSide));
    execFileSync('sips', [...sipsArgs, path, '--out', finalPath], { stdio: 'ignore' });
    mimeType = 'image/jpeg';
  }

  const dims = readDimensions(finalPath);
  return {
    name: basename(path),
    mimeType,
    base64: readFileSync(finalPath).toString('base64'),
    width: dims.width,
    height: dims.height,
  };
}

function buildUserPrompt(prompt: PromptSet, formatHint: string | null): string {
  const lines = [prompt.userInstruction];
  if (formatHint) lines.push(prompt.formatLine(formatHint));
  lines.push('Responde únicamente con el JSON pedido.');
  return lines.join('\n');
}

async function callAnthropic(
  client: Anthropic,
  spec: ModelSpec,
  image: PreparedImage,
  prompt: PromptSet,
  userPrompt: string,
): Promise<{ text: string; usage: Usage }> {
  const request = {
    model: spec.id,
    max_tokens: 2048,
    thinking: { type: 'disabled' },
    output_config: { format: { type: 'json_schema', schema: prompt.jsonSchema } },
    system: prompt.system,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: image.mimeType, data: image.base64 },
          },
          { type: 'text', text: userPrompt },
        ],
      },
    ],
  } as unknown as Anthropic.MessageCreateParamsNonStreaming;

  const response = await client.messages.create(request);
  if (response.stop_reason === 'refusal')
    throw new Error('El modelo rechazó la solicitud (refusal)');
  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === 'text');
  return {
    text: textBlock?.text ?? '',
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      thinkingTokens: 0,
      imageTokens: null,
    },
  };
}

function geminiMediaResolution(level: CliOptions['geminiResolution']): MediaResolution {
  if (level === 'low') return MediaResolution.MEDIA_RESOLUTION_LOW;
  if (level === 'high') return MediaResolution.MEDIA_RESOLUTION_HIGH;
  return MediaResolution.MEDIA_RESOLUTION_MEDIUM;
}

async function callGemini(
  client: GoogleGenAI,
  spec: ModelSpec,
  image: PreparedImage,
  prompt: PromptSet,
  userPrompt: string,
  resolution: CliOptions['geminiResolution'],
): Promise<{ text: string; usage: Usage }> {
  const response = await client.models.generateContent({
    model: spec.id,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { mimeType: image.mimeType, data: image.base64 } },
          { text: userPrompt },
        ],
      },
    ],
    config: {
      systemInstruction: prompt.system,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: prompt.geminiSchema,
      mediaResolution: geminiMediaResolution(resolution),
      ...(spec.id.startsWith('gemini-2.5') ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
    },
  });

  const meta = response.usageMetadata;
  const imageTokens =
    meta?.promptTokensDetails?.find((d) => String(d.modality).toUpperCase() === 'IMAGE')
      ?.tokenCount ?? null;
  return {
    text: response.text ?? '',
    usage: {
      inputTokens: meta?.promptTokenCount ?? 0,
      outputTokens: meta?.candidatesTokenCount ?? 0,
      thinkingTokens: meta?.thoughtsTokenCount ?? 0,
      imageTokens,
    },
  };
}

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
};

function normalizeForComparison(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\$/g, '')
    .replace(/\s+/g, '')
    .replace(/[−–—]/g, '-')
    .replace(/\\left|\\right/g, '')
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '($1)/($2)')
    .replace(/\\sqrt\[3\]\{([^{}]*)\}/g, 'cbrt($1)')
    .replace(/\\sqrt\{([^{}]*)\}/g, 'sqrt($1)')
    .replace(/\\cdot|\\times/g, '*')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, (sup) => `^${[...sup].map((c) => SUPERSCRIPT_DIGITS[c]).join('')}`)
    .replace(/(?:∛|³√)\(?([0-9a-z]+)\)?/gi, 'cbrt($1)')
    .replace(/√\(?([0-9a-z]+)\)?/gi, 'sqrt($1)')
    .replace(/\{/g, '(')
    .replace(/\}/g, ')')
    .replace(/\^\(([0-9a-z]+)\)/gi, '^$1')
    .replace(/\(([0-9a-z]+)\)\/\(([0-9a-z]+)\)/gi, '$1/$2')
    .toLowerCase();
}

function costOf(spec: ModelSpec, usage: Usage): number {
  return (
    (usage.inputTokens / 1_000_000) * spec.inputUsdPerMTok +
    ((usage.outputTokens + usage.thinkingTokens) / 1_000_000) * spec.outputUsdPerMTok
  );
}

function parseReading(text: string): {
  status: string | null;
  literal: string | null;
  confidence: number | null;
  alternatives: string;
  notes: string | null;
} {
  const parsed = JSON.parse(text) as {
    status?: string;
    literal?: string;
    confidence?: number;
    notes?: string;
    alternativeReadings?: Array<{ literal: string; plausibility: number }>;
  };
  return {
    status: parsed.status ?? null,
    literal: parsed.literal ?? null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
    alternatives: (parsed.alternativeReadings ?? [])
      .map((a) => `${a.literal} (${a.plausibility})`)
      .join(' | '),
    notes: parsed.notes ?? null,
  };
}

async function runOne(
  spec: ModelSpec,
  image: PreparedImage,
  repetition: number,
  expected: string | null,
  formatHint: string | null,
  options: CliOptions,
  clients: { anthropic: Anthropic | null; gemini: GoogleGenAI | null },
): Promise<RunResult> {
  const prompt = PROMPTS[options.promptVersion];
  const userPrompt = buildUserPrompt(prompt, formatHint);
  const base = {
    photo: image.name,
    model: spec.id,
    promptVersion: options.promptVersion,
    formatHint,
    repetition,
    expected,
  };
  const started = performance.now();
  try {
    const { text, usage } =
      spec.provider === 'anthropic'
        ? await callAnthropic(
            requireClient(clients.anthropic, 'ANTHROPIC_API_KEY'),
            spec,
            image,
            prompt,
            userPrompt,
          )
        : await callGemini(
            requireClient(clients.gemini, 'GEMINI_API_KEY'),
            spec,
            image,
            prompt,
            userPrompt,
            options.geminiResolution,
          );
    const latencyMs = Math.round(performance.now() - started);
    const reading = parseReading(text);
    return {
      ...base,
      ok: true,
      error: null,
      ...reading,
      matchesExpected:
        expected === null || reading.literal === null
          ? null
          : normalizeForComparison(reading.literal) === normalizeForComparison(expected),
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      thinkingTokens: usage.thinkingTokens,
      imageTokens: usage.imageTokens,
      costUsd: costOf(spec, usage),
      latencyMs,
    };
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      status: null,
      literal: null,
      confidence: null,
      alternatives: '',
      notes: null,
      matchesExpected: null,
      inputTokens: 0,
      outputTokens: 0,
      thinkingTokens: 0,
      imageTokens: null,
      costUsd: 0,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

function requireClient<T>(client: T | null, envName: string): T {
  if (!client) throw new Error(`Falta ${envName} en el .env del repositorio`);
  return client;
}

function loadExpected(path: string | null): Map<string, string> {
  if (!path) return new Map();
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, string>;
  return new Map(Object.entries(raw));
}

function printSummary(results: RunResult[], models: ModelSpec[]): void {
  console.log('\n=== Detalle por foto ===');
  console.table(
    results.map((r) => ({
      foto: r.photo,
      modelo: r.model,
      rep: r.repetition,
      estado: r.ok ? r.status : 'ERROR',
      transcripcion: r.ok ? r.literal : r.error?.slice(0, 60),
      esperado: r.expected ?? '',
      acierto: r.matchesExpected === null ? '' : r.matchesExpected ? '✓' : '✗',
      confianza: r.confidence,
      tok_in: r.inputTokens,
      tok_img: r.imageTokens ?? '',
      tok_out: r.outputTokens,
      tok_razon: r.thinkingTokens,
      usd: r.costUsd.toFixed(6),
      ms: r.latencyMs,
    })),
  );

  console.log('\n=== Resumen por modelo ===');
  console.table(
    models.map((spec) => {
      const own = results.filter((r) => r.model === spec.id);
      const ok = own.filter((r) => r.ok);
      const graded = ok.filter((r) => r.matchesExpected !== null);
      const hits = graded.filter((r) => r.matchesExpected).length;
      const avg = (pick: (r: RunResult) => number) =>
        ok.length === 0 ? 0 : ok.reduce((s, r) => s + pick(r), 0) / ok.length;
      const avgCost = avg((r) => r.costUsd);
      return {
        modelo: spec.id,
        llamadas: own.length,
        errores: own.length - ok.length,
        aciertos: graded.length === 0 ? '' : `${hits}/${graded.length}`,
        tok_in_prom: Math.round(avg((r) => r.inputTokens)),
        tok_out_prom: Math.round(avg((r) => r.outputTokens)),
        tok_razon_prom: Math.round(avg((r) => r.thinkingTokens)),
        usd_por_recorte: avgCost.toFixed(6),
        usd_100k_sin_batch: (avgCost * 100_000).toFixed(2),
        usd_100k_batch: (avgCost * 100_000 * 0.5).toFixed(2),
        ms_prom: Math.round(avg((r) => r.latencyMs)),
      };
    }),
  );
}

function toCsv(results: RunResult[]): string {
  const header = Object.keys(results[0] ?? {}) as Array<keyof RunResult>;
  const escape = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header.join(','), ...results.map((r) => header.map((h) => escape(r[h])).join(','))].join(
    '\n',
  );
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const photos = listPhotos(options.photosDir);
  const expected = loadExpected(options.expectedPath);
  const formats = loadExpected(options.formatsPath);
  const scratchDir = mkdtempSync(join(tmpdir(), 'vlm-manuscrito-'));

  const clients = {
    anthropic: process.env.ANTHROPIC_API_KEY
      ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
      : null,
    gemini: process.env.GEMINI_API_KEY
      ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY })
      : null,
  };

  console.log(`Fotos: ${photos.length} en ${options.photosDir}`);
  console.log(`Modelos: ${options.models.map((m) => m.id).join(', ')}`);
  console.log(
    `Prompt: ${options.promptVersion} · pistas de formato: ${options.formatsPath ?? options.formatHint ?? 'ninguna'}`,
  );
  console.log(
    `Repeticiones: ${options.repetitions} · resolución Gemini: ${options.geminiResolution} · lado máximo: ${options.maxSide || 'sin reducir'}`,
  );

  const images = photos.map((p) => prepareImage(p, options.maxSide, scratchDir));
  for (const img of images)
    console.log(`  ${img.name}: ${img.width ?? '?'}×${img.height ?? '?'} px (${img.mimeType})`);

  const results: RunResult[] = [];
  for (const image of images) {
    for (const spec of options.models) {
      for (let rep = 1; rep <= options.repetitions; rep++) {
        const formatHint = formats.get(image.name) ?? options.formatHint;
        const result = await runOne(
          spec,
          image,
          rep,
          expected.get(image.name) ?? null,
          formatHint,
          options,
          clients,
        );
        results.push(result);
        const label = result.ok ? `${result.status} "${result.literal}"` : `ERROR ${result.error}`;
        console.log(`  · ${image.name} × ${spec.id} #${rep}: ${label}`);
      }
    }
  }

  printSummary(results, options.models);

  mkdirSync(options.outputDir, { recursive: true });
  const stamp = `${options.promptVersion}${formats.size > 0 || options.formatHint ? '-formato' : ''}-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const jsonPath = join(options.outputDir, `resultados-${stamp}.json`);
  const csvPath = join(options.outputDir, `resultados-${stamp}.csv`);
  writeFileSync(
    jsonPath,
    JSON.stringify(
      { options: { ...options, models: options.models.map((m) => m.id) }, results },
      null,
      2,
    ),
  );
  writeFileSync(csvPath, toCsv(results));
  console.log(`\nResultados guardados en:\n  ${jsonPath}\n  ${csvPath}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
