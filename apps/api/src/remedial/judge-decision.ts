import type { DecisionState, JsonObject } from '@soe/decisions';
import { choice, noul } from '@soe/decisions';

export const JUDGE_DECISION_VERSION = 'judge-decision-v1';

export interface JudgeDecisionStimulus {
  title?: string | null;
  text?: string | null;
}

export interface JudgeDecisionItem {
  stem: string;
  alternatives: { key: string; text: string }[];
}

export function buildJudgeDecision(
  stimulus: JudgeDecisionStimulus | null,
  item: JudgeDecisionItem,
) {
  const passageText = stimulus?.text?.trim();
  const hasPassage = Boolean(passageText);

  const alternativas: JsonObject = {};
  for (const alt of item.alternatives) alternativas[alt.key] = alt.text;

  const state: DecisionState = hasPassage
    ? {
        pasaje: { titulo: stimulus?.title ?? null, texto: passageText ?? '' },
        pregunta: item.stem.trim(),
        alternativas,
      }
    : { pregunta: item.stem.trim(), alternativas };

  const claveCriteria: Record<string, string> = {};
  for (const alt of item.alternatives) claveCriteria[alt.key] = alt.text;

  const questions = {
    clave: choice(
      hasPassage
        ? '¿Qué alternativa responde correctamente la `pregunta`, usando solo la información del `pasaje`?'
        : '¿Qué alternativa responde correctamente la `pregunta`?',
      claveCriteria,
    ),
    respuesta_unica: noul(
      '¿Exactamente una de las `alternativas` es una respuesta correcta a la `pregunta`?',
      {
        true: 'Hay una sola alternativa correcta y las demás son incorrectas.',
        false: 'Ninguna alternativa es correcta, o dos o más alternativas son correctas.',
      },
    ),
    factual: noul(
      hasPassage
        ? '¿El `pasaje`, la `pregunta` y las `alternativas` están libres de errores de hecho?'
        : '¿La `pregunta` y las `alternativas` están libres de errores de hecho?',
      {
        true: 'No hay ningún error de hecho.',
        false: 'Hay al menos un error de hecho.',
      },
    ),
    habilidad: noul(
      hasPassage
        ? '¿Para responder la `pregunta` hay que leer y comprender el `pasaje`?'
        : '¿La `pregunta` evalúa un contenido escolar de forma clara?',
    ),
  };

  return { state, questions };
}
