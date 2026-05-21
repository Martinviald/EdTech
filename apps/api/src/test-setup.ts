import { config } from 'dotenv';
import { resolve } from 'path';

// Carga el .env del root del monorepo para todos los tests
config({ path: resolve(__dirname, '../../../.env') });
