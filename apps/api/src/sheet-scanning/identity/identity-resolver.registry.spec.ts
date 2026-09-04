import type { ManualIdentityResolver } from './manual-identity.resolver';
import type { QrIdentityResolver } from './qr-identity.resolver';
import type { RutBubbleResolver } from './rut-bubble.resolver';
import { SheetIdentityResolverRegistry } from './identity-resolver.registry';

const qr = { mode: 'qr', resolve: jest.fn() } as unknown as QrIdentityResolver;
const rut = { mode: 'rut_bubbles', resolve: jest.fn() } as unknown as RutBubbleResolver;
const manual = { mode: 'none', resolve: jest.fn() } as unknown as ManualIdentityResolver;

describe('SheetIdentityResolverRegistry', () => {
  it('selecciona el resolver por modo de identidad, sin if-chain en el caller', () => {
    const registry = new SheetIdentityResolverRegistry(qr, rut, manual);

    expect(registry.forMode('qr')).toBe(qr);
    expect(registry.forMode('rut_bubbles')).toBe(rut);
    expect(registry.forMode('none')).toBe(manual);
  });

  it('un modo sin resolver registrado lanza con el modo en el mensaje', () => {
    const registry = new SheetIdentityResolverRegistry(qr, rut, manual);

    expect(() => registry.forMode('otro' as never)).toThrow('otro');
  });
});
