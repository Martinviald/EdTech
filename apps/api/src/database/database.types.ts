import { Inject } from '@nestjs/common';
import type { Database } from '@soe/db';
import { DATABASE_CONNECTION } from './database.module';

export type { Database };

export const InjectDb = () => Inject(DATABASE_CONNECTION);
