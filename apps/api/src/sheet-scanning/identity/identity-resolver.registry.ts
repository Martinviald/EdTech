import { Injectable } from '@nestjs/common';
import type { SheetIdentityMode } from '@soe/types';
import type { SheetIdentityResolver } from './identity-resolver.types';
import { ManualIdentityResolver } from './manual-identity.resolver';
import { QrIdentityResolver } from './qr-identity.resolver';
import { RutBubbleResolver } from './rut-bubble.resolver';

@Injectable()
export class SheetIdentityResolverRegistry {
  private readonly byMode: Map<SheetIdentityMode, SheetIdentityResolver>;

  constructor(
    qrResolver: QrIdentityResolver,
    rutBubbleResolver: RutBubbleResolver,
    manualResolver: ManualIdentityResolver,
  ) {
    const resolvers: SheetIdentityResolver[] = [qrResolver, rutBubbleResolver, manualResolver];
    this.byMode = new Map(resolvers.map((resolver) => [resolver.mode, resolver]));
  }

  forMode(mode: SheetIdentityMode): SheetIdentityResolver {
    const resolver = this.byMode.get(mode);
    if (!resolver) {
      throw new Error(`No hay resolver de identidad registrado para el modo "${mode}"`);
    }
    return resolver;
  }
}
