import type { DocumentItemSnapshot, RemedialPracticeContent } from '@soe/types';
import {
  instrumentSectionsToBlocks,
  remedialGuideToBlocks,
  remedialPlanToBlocks,
  remedialPracticeToBlocks,
} from './document-import.helpers';

const snapshot: DocumentItemSnapshot = {
  type: 'multiple_choice',
  version: 1,
  content: { stem: '¿Cuánto es 2+2?' },
};

describe('remedialGuideToBlocks', () => {
  const guide = {
    objective: 'Reforzar fracciones',
    rootCauseSummary: 'Confunden numerador y denominador',
    strategy: 'Modelado con material concreto',
    classActivities: [
      { title: 'Plegado de papel', description: 'Doblar en mitades', durationMin: 15 },
    ],
    materials: ['Papel lustre'],
    successCriteria: ['Identifica numerador'],
  };

  it('arma la secuencia objetivo → diagnóstico → estrategia → actividades → listas', () => {
    const blocks = remedialGuideToBlocks(guide);
    expect(blocks.map((b) => b.type)).toEqual([
      'callout',
      'heading',
      'text',
      'heading',
      'text',
      'heading',
      'activity',
      'heading',
      'list',
      'heading',
      'list',
    ]);
  });

  it('omite las secciones de listas vacías', () => {
    const blocks = remedialGuideToBlocks({ ...guide, materials: [], successCriteria: [] });
    expect(blocks.some((b) => b.type === 'list')).toBe(false);
  });

  it('asigna ids únicos a cada bloque', () => {
    const blocks = remedialGuideToBlocks(guide);
    expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length);
  });
});

describe('remedialPracticeToBlocks', () => {
  const practice: RemedialPracticeContent = {
    skillFocus: 'Localizar información',
    itemCount: 2,
    items: [
      { itemId: '00000000-0000-4000-8000-000000000002', position: 2, stem: 'b' },
      { itemId: '00000000-0000-4000-8000-000000000001', position: 1, stem: 'a' },
    ],
    notes: 'Revisar en pareja',
    stimuli: [],
  };

  it('ordena los ítems por posición y salta los que no tienen snapshot', () => {
    const snapshots = new Map([
      ['00000000-0000-4000-8000-000000000001', snapshot],
      ['00000000-0000-4000-8000-000000000002', snapshot],
    ]);
    const blocks = remedialPracticeToBlocks(practice, snapshots, new Map());
    const itemBlocks = blocks.filter((b) => b.type === 'item');
    expect(itemBlocks.map((b) => (b.type === 'item' ? b.itemId : null))).toEqual([
      '00000000-0000-4000-8000-000000000001',
      '00000000-0000-4000-8000-000000000002',
    ]);

    const partial = remedialPracticeToBlocks(
      practice,
      new Map([['00000000-0000-4000-8000-000000000001', snapshot]]),
      new Map(),
    );
    expect(partial.filter((b) => b.type === 'item')).toHaveLength(1);
  });

  it('incluye el pasaje del estímulo antes de los ítems y las notas al final', () => {
    const withStimulus: RemedialPracticeContent = {
      ...practice,
      stimuli: [
        {
          sectionId: '00000000-0000-4000-8000-00000000000a',
          kind: 'passage',
          source: 'official',
          title: 'El zorro',
          textPreview: null,
        },
      ],
    };
    const blocks = remedialPracticeToBlocks(
      withStimulus,
      new Map(),
      new Map([
        [
          '00000000-0000-4000-8000-00000000000a',
          { passageTitle: 'El zorro', passageText: 'Había una vez…' },
        ],
      ]),
    );
    expect(blocks.map((b) => b.type)).toEqual(['callout', 'heading', 'text', 'callout']);
    const last = blocks[blocks.length - 1];
    expect(last?.type === 'callout' && last.title).toBe('Notas para el docente');
  });

});

describe('remedialPlanToBlocks', () => {
  it('ordena la secuencia por orden y arma la meta del grupo', () => {
    const blocks = remedialPlanToBlocks({
      groupLabel: 'Grupo A',
      studentCount: 6,
      sharedGap: 'Comprensión inferencial',
      sequence: [
        { order: 2, title: 'Paso dos', description: 'd2', linkedNodeId: null },
        { order: 1, title: 'Paso uno', description: 'd1', linkedNodeId: null },
      ],
      estimatedSessions: 3,
    });
    const activities = blocks.filter((b) => b.type === 'activity');
    expect(activities.map((b) => (b.type === 'activity' ? b.title : null))).toEqual([
      'Paso uno',
      'Paso dos',
    ]);
    const meta = blocks.find((b) => b.type === 'text');
    expect(meta?.type === 'text' && meta.markdown).toContain('6 estudiantes');
    expect(meta?.type === 'text' && meta.markdown).toContain('3');
  });
});

describe('instrumentSectionsToBlocks', () => {
  const section = {
    id: 's1',
    name: 'Comprensión',
    instructions: 'Lee con atención',
    passageTitle: 'El texto',
    passageText: 'Contenido del pasaje',
    items: [{ id: 'i1', snapshot }],
  };

  it('con una sola sección omite el encabezado de sección', () => {
    const blocks = instrumentSectionsToBlocks([section]);
    expect(blocks.map((b) => b.type)).toEqual(['callout', 'heading', 'text', 'item']);
  });

  it('con varias secciones antepone un heading por sección', () => {
    const blocks = instrumentSectionsToBlocks([
      section,
      { ...section, id: 's2', name: 'Vocabulario', instructions: null, passageTitle: null, passageText: null },
    ]);
    const headings = blocks.filter((b) => b.type === 'heading' && b.level === 2);
    expect(headings.map((b) => (b.type === 'heading' ? b.text : null))).toEqual([
      'Comprensión',
      'Vocabulario',
    ]);
  });
});
