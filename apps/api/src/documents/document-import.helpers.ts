import { randomUUID } from 'node:crypto';
import type {
  Block,
  DocumentItemSnapshot,
  RemedialGuideContent,
  RemedialPlanContent,
  RemedialPracticeContent,
} from '@soe/types';

type SnapshotById = Map<string, DocumentItemSnapshot>;

type PassageLike = {
  passageTitle: string | null;
  passageText: string | null;
};

function heading(level: 1 | 2 | 3, text: string): Block {
  return { id: randomUUID(), type: 'heading', level, text };
}

function text(markdown: string): Block {
  return { id: randomUUID(), type: 'text', markdown };
}

function bulletList(items: string[]): Block {
  return { id: randomUUID(), type: 'list', style: 'bullet', items };
}

function callout(tone: 'info' | 'tip' | 'warning', title: string, markdown: string): Block {
  return { id: randomUUID(), type: 'callout', tone, title, markdown };
}

function activity(title: string, description: string, durationMin: number | null): Block {
  return { id: randomUUID(), type: 'activity', title, description, durationMin };
}

function itemBlock(itemId: string, snapshot: DocumentItemSnapshot): Block {
  return { id: randomUUID(), type: 'item', itemId, showAnswer: false, snapshot };
}

export function remedialGuideToBlocks(content: RemedialGuideContent): Block[] {
  const blocks: Block[] = [
    callout('info', 'Objetivo', content.objective),
    heading(2, 'Diagnóstico'),
    text(content.rootCauseSummary),
    heading(2, 'Estrategia'),
    text(content.strategy),
    heading(2, 'Actividades de clase'),
    ...content.classActivities.map((entry) =>
      activity(entry.title, entry.description, entry.durationMin),
    ),
  ];
  if (content.materials.length > 0) {
    blocks.push(heading(2, 'Materiales'), bulletList(content.materials));
  }
  if (content.successCriteria.length > 0) {
    blocks.push(heading(2, 'Criterios de logro'), bulletList(content.successCriteria));
  }
  return blocks;
}

export function remedialPracticeToBlocks(
  content: RemedialPracticeContent,
  snapshotsByItemId: SnapshotById,
  passagesBySectionId: Map<string, PassageLike>,
): Block[] {
  const blocks: Block[] = [callout('info', 'Habilidad trabajada', content.skillFocus)];

  for (const stimulus of content.stimuli) {
    const passage = passagesBySectionId.get(stimulus.sectionId);
    if (!passage?.passageText) continue;
    if (passage.passageTitle) blocks.push(heading(3, passage.passageTitle));
    blocks.push(text(passage.passageText));
  }

  const sortedRefs = [...content.items].sort((a, b) => a.position - b.position);
  for (const ref of sortedRefs) {
    const snapshot = snapshotsByItemId.get(ref.itemId);
    if (!snapshot) continue;
    blocks.push(itemBlock(ref.itemId, snapshot));
  }

  if (content.notes) {
    blocks.push(callout('tip', 'Notas para el docente', content.notes));
  }
  return blocks;
}

export function remedialPlanToBlocks(content: RemedialPlanContent): Block[] {
  const metaParts = [
    `**Grupo:** ${content.groupLabel} (${content.studentCount} estudiantes)`,
    content.estimatedSessions ? `**Sesiones estimadas:** ${content.estimatedSessions}` : null,
  ].filter((part): part is string => part !== null);

  return [
    callout('info', 'Brecha compartida', content.sharedGap),
    text(metaParts.join(' · ')),
    heading(2, 'Secuencia de trabajo'),
    ...[...content.sequence]
      .sort((a, b) => a.order - b.order)
      .map((step) => activity(step.title, step.description, null)),
  ];
}

export function instrumentSectionsToBlocks(
  sections: Array<
    PassageLike & {
      id: string;
      name: string;
      instructions: string | null;
      items: Array<{ id: string; snapshot: DocumentItemSnapshot }>;
    }
  >,
): Block[] {
  const blocks: Block[] = [];
  const multipleSections = sections.length > 1;

  for (const section of sections) {
    if (multipleSections) blocks.push(heading(2, section.name));
    if (section.instructions) blocks.push(callout('info', 'Instrucciones', section.instructions));
    if (section.passageText) {
      if (section.passageTitle) blocks.push(heading(3, section.passageTitle));
      blocks.push(text(section.passageText));
    }
    for (const item of section.items) {
      blocks.push(itemBlock(item.id, item.snapshot));
    }
  }
  return blocks;
}
