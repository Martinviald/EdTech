import {
  buildTaggingPrompt,
  parseAiResponse,
  type PromptItem,
  type PromptNode,
} from './prompt-builder';

describe('prompt-builder', () => {
  const sampleNodes: PromptNode[] = [
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'OA 1 — Leer comprensivamente',
      type: 'learning_objective',
      code: 'OA1',
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Extraer información explícita',
      type: 'skill',
      code: 'H1',
    },
  ];

  const sampleItem: PromptItem = {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    type: 'multiple_choice',
    content: {
      stem: '¿Cuál es la idea principal del texto?',
      alternatives: [
        { label: 'A', text: 'La contaminación del agua', correct: true },
        { label: 'B', text: 'El ciclo del agua', correct: false },
        { label: 'C', text: 'Los peces del río', correct: false },
        { label: 'D', text: 'La evaporación', correct: false },
      ],
    },
  };

  describe('buildTaggingPrompt', () => {
    it('should return system and user prompts', () => {
      const { system, user } = buildTaggingPrompt(sampleItem, sampleNodes);

      expect(system).toBeDefined();
      expect(user).toBeDefined();
      expect(typeof system).toBe('string');
      expect(typeof user).toBe('string');
    });

    it('should include taxonomy alignment context in system prompt', () => {
      const { system } = buildTaggingPrompt(sampleItem, sampleNodes);

      expect(system).toContain('curricular');
      expect(system).toContain('MINEDUC');
      expect(system).toContain('JSON array');
      expect(system).toContain('nodeId');
      expect(system).toContain('confidence');
      expect(system).toContain('reasoning');
    });

    it('should include node data in user prompt', () => {
      const { user } = buildTaggingPrompt(sampleItem, sampleNodes);

      expect(user).toContain('OA 1 — Leer comprensivamente');
      expect(user).toContain('11111111-1111-1111-1111-111111111111');
      expect(user).toContain('learning_objective');
      expect(user).toContain('OA1');
      expect(user).toContain('Extraer información explícita');
    });

    it('should include item content in user prompt', () => {
      const { user } = buildTaggingPrompt(sampleItem, sampleNodes);

      expect(user).toContain('multiple_choice');
      expect(user).toContain('idea principal del texto');
      expect(user).toContain('La contaminación del agua');
    });

    it('should handle items with minimal content', () => {
      const minimalItem: PromptItem = {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        type: 'open_ended',
        content: { stem: 'Describe the water cycle.' },
      };

      const { user } = buildTaggingPrompt(minimalItem, sampleNodes);

      expect(user).toContain('open_ended');
      expect(user).toContain('Describe the water cycle.');
    });

    it('should handle empty nodes array', () => {
      const { user } = buildTaggingPrompt(sampleItem, []);

      expect(user).toContain('[]');
    });
  });

  describe('parseAiResponse', () => {
    it('should parse a valid JSON array response', () => {
      const raw = JSON.stringify([
        {
          nodeId: '11111111-1111-1111-1111-111111111111',
          confidence: 0.9,
          reasoning: 'La pregunta evalúa la comprensión lectora',
        },
        {
          nodeId: '22222222-2222-2222-2222-222222222222',
          confidence: 0.7,
          reasoning: 'Requiere extraer la idea principal',
        },
      ]);

      const result = parseAiResponse(raw);

      expect(result).toHaveLength(2);
      expect(result[0].nodeId).toBe('11111111-1111-1111-1111-111111111111');
      expect(result[0].confidence).toBe(0.9);
      expect(result[0].reasoning).toBe('La pregunta evalúa la comprensión lectora');
      expect(result[1].confidence).toBe(0.7);
    });

    it('should filter out suggestions with confidence below 0.5', () => {
      const raw = JSON.stringify([
        {
          nodeId: '11111111-1111-1111-1111-111111111111',
          confidence: 0.3,
          reasoning: 'Weak alignment',
        },
        {
          nodeId: '22222222-2222-2222-2222-222222222222',
          confidence: 0.8,
          reasoning: 'Strong alignment',
        },
      ]);

      const result = parseAiResponse(raw);

      expect(result).toHaveLength(1);
      expect(result[0].nodeId).toBe('22222222-2222-2222-2222-222222222222');
    });

    it('should filter out suggestions with confidence above 1', () => {
      const raw = JSON.stringify([
        {
          nodeId: '11111111-1111-1111-1111-111111111111',
          confidence: 1.5,
          reasoning: 'Invalid confidence',
        },
      ]);

      const result = parseAiResponse(raw);

      expect(result).toHaveLength(0);
    });

    it('should return empty array for invalid JSON', () => {
      const result = parseAiResponse('This is not JSON at all.');
      expect(result).toEqual([]);
    });

    it('should return empty array for empty string', () => {
      const result = parseAiResponse('');
      expect(result).toEqual([]);
    });

    it('should return empty array for JSON that is not an array', () => {
      const result = parseAiResponse('{"nodeId": "abc", "confidence": 0.9}');
      expect(result).toEqual([]);
    });

    it('should extract JSON from markdown code blocks', () => {
      const raw = `Here are the suggestions:

\`\`\`json
[
  {
    "nodeId": "11111111-1111-1111-1111-111111111111",
    "confidence": 0.85,
    "reasoning": "Directly tests reading comprehension"
  }
]
\`\`\``;

      const result = parseAiResponse(raw);

      expect(result).toHaveLength(1);
      expect(result[0].nodeId).toBe('11111111-1111-1111-1111-111111111111');
      expect(result[0].confidence).toBe(0.85);
    });

    it('should handle response with surrounding text', () => {
      const raw = `Based on the content, here are my suggestions:
[{"nodeId": "11111111-1111-1111-1111-111111111111", "confidence": 0.9, "reasoning": "Test"}]
These are my recommendations.`;

      const result = parseAiResponse(raw);

      expect(result).toHaveLength(1);
      expect(result[0].nodeId).toBe('11111111-1111-1111-1111-111111111111');
    });

    it('should filter items with missing required fields', () => {
      const raw = JSON.stringify([
        { nodeId: '11111111-1111-1111-1111-111111111111', confidence: 0.9 },
        {
          nodeId: '22222222-2222-2222-2222-222222222222',
          confidence: 0.8,
          reasoning: 'Valid',
        },
        { confidence: 0.7, reasoning: 'Missing nodeId' },
      ]);

      const result = parseAiResponse(raw);

      expect(result).toHaveLength(1);
      expect(result[0].nodeId).toBe('22222222-2222-2222-2222-222222222222');
    });

    it('should handle an empty JSON array', () => {
      const result = parseAiResponse('[]');
      expect(result).toEqual([]);
    });

    it('should accept confidence exactly at boundaries (0.5 and 1.0)', () => {
      const raw = JSON.stringify([
        {
          nodeId: '11111111-1111-1111-1111-111111111111',
          confidence: 0.5,
          reasoning: 'Boundary low',
        },
        {
          nodeId: '22222222-2222-2222-2222-222222222222',
          confidence: 1.0,
          reasoning: 'Boundary high',
        },
      ]);

      const result = parseAiResponse(raw);

      expect(result).toHaveLength(2);
    });
  });
});
