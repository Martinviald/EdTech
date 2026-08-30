import { Injectable } from '@nestjs/common';
import {
  unresolvedIdentityCandidate,
  type IdentityCandidate,
  type SheetIdentityResolver,
} from './identity-resolver.types';

@Injectable()
export class ManualIdentityResolver implements SheetIdentityResolver {
  readonly mode = 'none' as const;

  resolve(): Promise<IdentityCandidate> {
    return Promise.resolve(unresolvedIdentityCandidate({ motivo: 'asignacion_manual' }));
  }
}
