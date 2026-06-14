import type { RemedialCurriculumContext } from '../remedial-context.service';

/**
 * Serializa el contexto curricular RAG a un bloque de texto legible para el
 * prompt. Es la "evidencia recuperada" del RAG: OA objetivo + ancestros +
 * descriptores + hermanos + ítems reales de ejemplo. NO contiene PII.
 *
 * Compartido por los tres generadores para no duplicar el formato.
 */
export function renderCurriculumContext(ctx: RemedialCurriculumContext): string {
  const lines: string[] = [];

  lines.push('OBJETIVO DE APRENDIZAJE OBJETIVO (la brecha a remediar):');
  lines.push(renderNode(ctx.target));

  if (ctx.ancestors.length > 0) {
    lines.push('');
    lines.push('UBICACIÓN EN EL CURRÍCULO (de eje/dominio a padre):');
    for (const node of ctx.ancestors) {
      lines.push(`- ${renderNodeInline(node)}`);
    }
  }

  if (ctx.descriptors.length > 0) {
    lines.push('');
    lines.push('SUB-HABILIDADES / DESCRIPTORES (hijos directos):');
    for (const node of ctx.descriptors) {
      lines.push(`- ${renderNodeInline(node)}`);
    }
  }

  if (ctx.siblings.length > 0) {
    lines.push('');
    lines.push('HABILIDADES RELACIONADAS (hermanas, para contexto):');
    for (const node of ctx.siblings) {
      lines.push(`- ${renderNodeInline(node)}`);
    }
  }

  if (ctx.fewShotItems.length > 0) {
    lines.push('');
    lines.push('ÍTEMS REALES YA EVALUADOS EN ESTA HABILIDAD (referencia de estilo y nivel):');
    ctx.fewShotItems.forEach((item, idx) => {
      lines.push(`${idx + 1}. [${item.type}] ${item.stem}`);
    });
  }

  return lines.join('\n');
}

function renderNode(node: {
  code: string | null;
  name: string;
  description: string | null;
}): string {
  const code = node.code ? `${node.code} — ` : '';
  const desc = node.description ? `\n  ${node.description}` : '';
  return `${code}${node.name}${desc}`;
}

function renderNodeInline(node: {
  code: string | null;
  name: string;
  description: string | null;
}): string {
  const code = node.code ? `${node.code} — ` : '';
  const desc = node.description ? `: ${node.description}` : '';
  return `${code}${node.name}${desc}`;
}

/** Quita fences ```json … ``` que algunos modelos añaden alrededor del JSON. */
export function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced?.[1] ?? trimmed;
}

/** Parsea texto del modelo a JSON tolerando fences. Lanza si no es JSON válido. */
export function parseModelJson(raw: string): unknown {
  try {
    return JSON.parse(stripCodeFences(raw));
  } catch {
    throw new Error('La salida del modelo no es JSON válido');
  }
}
