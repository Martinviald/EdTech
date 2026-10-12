import { TRANSCRIPTION_OUTPUT_KEYS, type ResponseFormat } from '@soe/types';
import { fakeOutput } from '../fake/fake-transcriber';
import {
  TRANSCRIPTION_OUTPUT_SCHEMA_ID,
  baseTranscriptionJsonSchema,
  transcriptionJsonSchema,
  transcriptionZodSchema,
} from './transcription-json-schema';

const PAIR: ResponseFormat = { kind: 'ordered_tuple', arity: 2, componentKind: 'integer' };
const INTEGER: ResponseFormat = { kind: 'integer', maxChars: 4, allowNegative: false };

describe('transcriptionJsonSchema', () => {
  it('respeta el orden del contrato: characters antes de literal', () => {
    const { schema, propertyOrder } = transcriptionJsonSchema(PAIR);
    expect(propertyOrder).toEqual([...TRANSCRIPTION_OUTPUT_KEYS]);
    expect(Object.keys(schema.properties)).toEqual([...TRANSCRIPTION_OUTPUT_KEYS]);
    expect(schema.required).toEqual([...TRANSCRIPTION_OUTPUT_KEYS]);
    expect(schema.additionalProperties).toBe(false);
  });

  it('las partes dependen del formato y entran al identificador', () => {
    expect(transcriptionJsonSchema(PAIR).schemaId).toBe('transcription-output.ordered_tuple.2@1');
    expect(transcriptionJsonSchema(PAIR).schema.properties.parts).toMatchObject({
      type: 'object',
      required: ['c1', 'c2'],
    });
    expect(transcriptionJsonSchema(INTEGER).schemaId).toBe('transcription-output.integer@1');
    expect(transcriptionJsonSchema(INTEGER).schema.properties.parts).toMatchObject({
      type: 'null',
    });
  });

  it('el esquema base es la familia que declaran los prompts', () => {
    expect(baseTranscriptionJsonSchema().schemaId).toBe(TRANSCRIPTION_OUTPUT_SCHEMA_ID);
  });

  it('es JSON plano (serializable sin pérdida)', () => {
    const { schema } = transcriptionJsonSchema(PAIR);
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  });
});

describe('transcriptionZodSchema', () => {
  it('exige las partes del formato', () => {
    const schema = transcriptionZodSchema(PAIR);
    expect(schema.safeParse(fakeOutput('(7;3)', { parts: { c1: '7', c2: '3' } })).success).toBe(
      true,
    );
    expect(schema.safeParse(fakeOutput('(7;3)', { parts: { c1: '7' } })).success).toBe(false);
    expect(transcriptionZodSchema(INTEGER).safeParse(fakeOutput('12')).success).toBe(true);
  });
});
