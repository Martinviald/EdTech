import { ITEM_TYPES, type ItemType } from '../enums';
import { isDichotomousItem } from './item-scoring';

describe('isDichotomousItem', () => {
  it('rubric_scored nunca es dicotómico, cualquiera sea su configuración', () => {
    expect(isDichotomousItem('rubric_scored')).toBe(false);
    expect(isDichotomousItem('rubric_scored', { points: 1 })).toBe(false);
  });

  it('matching es dicotómico salvo que declare crédito parcial', () => {
    expect(isDichotomousItem('matching')).toBe(true);
    expect(isDichotomousItem('matching', { partialCredit: false })).toBe(true);
    expect(isDichotomousItem('matching', { partialCredit: true })).toBe(false);
  });

  it('multi_select es dicotómico salvo que apague requireExact', () => {
    expect(isDichotomousItem('multi_select')).toBe(true);
    expect(isDichotomousItem('multi_select', { multiSelect: { requireExact: true } })).toBe(true);
    expect(isDichotomousItem('multi_select', { multiSelect: { requireExact: false } })).toBe(false);
  });

  it('el resto de los tipos es dicotómico por defecto', () => {
    const polytomous: ItemType[] = ['rubric_scored'];
    const configurable: ItemType[] = ['matching', 'multi_select'];
    for (const type of ITEM_TYPES) {
      if (polytomous.includes(type) || configurable.includes(type)) continue;
      expect(isDichotomousItem(type)).toBe(true);
    }
  });
});
