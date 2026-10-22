import { describe, expect, it } from 'vitest';
import { generateForms, normalizeName, StreetIndex, stems, stemToken } from '../src/index.ts';

const norm = normalizeName;

describe('generateForms', () => {
  it('includes the name itself', () => {
    expect(generateForms('vojvode putnika')).toContain('vojvode putnika');
  });
  it('generates the genitive of a feminine adjective', () => {
    expect(generateForms('studenicka')).toContain('studenicke');
    expect(generateForms('gornjomatejevacka')).toContain('gornjomatejevacke');
  });
  it('generates the genitive of masculine adjective + noun, consistently', () => {
    expect(generateForms('matejevacki put')).toContain('matejevackog puta');
  });
  it('generates the genitive of adjective + feminine noun', () => {
    expect(generateForms('bubanjska dolina')).toContain('bubanjske doline');
  });
  it('generates dative/locative, accusative and instrumental forms', () => {
    const forms = generateForms('cegarska');
    expect(forms).toEqual(expect.arrayContaining(['cegarskoj', 'cegarsku', 'cegarskom']));
  });
  it('drops the fleeting a in -ac nouns', () => {
    expect(generateForms('gabrovac')).toContain('gabrovca');
  });
  it('leaves numbers and short words alone', () => {
    expect(generateForms('12 februara')).toContain('12 februare');
    expect(generateForms('i')).toEqual(['i']);
  });
  it('is bounded', () => {
    const forms = generateForms('prva druga treca cetvrta peta sesta sedma osma');
    expect(forms.length).toBeLessThan(300);
  });
});

describe('stemToken / stems', () => {
  it('strips case endings only from longer words', () => {
    expect(stemToken('studenicke')).toBe('studenick');
    expect(stemToken('matejevackog')).toBe('matejevack');
    expect(stemToken('puta')).toBe('put');
    expect(stemToken('dva')).toBe('dva');
    expect(stemToken('12')).toBe('12');
  });
  it('gives the same stems for a street and its genitive', () => {
    expect(stems('matejevackog puta')).toEqual(stems('matejevacki put'));
  });
});

describe('StreetIndex (case forms found in real EDS rows, 22 Oct 2026)', () => {
  const index = StreetIndex.fromNames([
    'Горњоматејевачка',
    'Студеничка',
    'Матејевачки пут',
    'Требињска',
    'Војводе Путника',
    'Космајска',
    'Бубањска долина',
    'Чегарска',
    'Генерала Транијеа',
    'Булевар Светог Цара Константина',
    'Александра Нагорног',
  ]);

  it.each([
    ['Студеничке', 'Студеничка'],
    ['Горњоматејевачке', 'Горњоматејевачка'],
    ['Матејевачког пута', 'Матејевачки пут'],
    ['Требињске', 'Требињска'],
    ['Космајске', 'Космајска'],
    ['Бубањске долине', 'Бубањска долина'],
    ['Чегарске', 'Чегарска'],
  ])('resolves the genitive %s to %s by a generated form', (text, nominative) => {
    const r = index.resolve(norm(text));
    expect(r.by).toBe('form');
    expect(r.street?.name).toBe(nominative);
  });

  it.each([
    ['Војводе Путника', 'Војводе Путника'],
    ['Генерала Транијеа', 'Генерала Транијеа'],
    ['Александра Нагорног', 'Александра Нагорног'],
    ['Бул. Светог Цара Константина', 'Булевар Светог Цара Константина'],
  ])('resolves the frozen/abbreviated name %s exactly', (text, name) => {
    const r = index.resolve(norm(text));
    expect(r.by).toBe('exact');
    expect(r.street?.name).toBe(name);
  });

  it('never resolves to a street that does not exist', () => {
    const r = index.resolve(norm('Непостојеће'));
    expect(r.by).toBe('unresolved');
    expect(r.street).toBeNull();
  });

  it('collects stem candidates for an unresolved segment but does not accept one', () => {
    const r = index.resolve(norm('Студеничкој улици'));
    expect(r.by).toBe('unresolved');
    expect(r.candidates[0]?.street.name).toBe('Студеничка');
  });

  it('reports ambiguity instead of guessing', () => {
    const dup = StreetIndex.fromNames(['Првомајска', 'Првомајска']);
    expect(dup.resolve(norm('Првомајска')).by).toBe('ambiguous');
  });
});
