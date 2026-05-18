import { config } from 'dotenv';
import { resolve } from 'path';
import { createDbClient } from '../client';
import { grades, subjects } from '../schema/academic';
import { curricula } from '../schema/curriculum';

config({ path: resolve(__dirname, '../../../../.env') });

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required');
  }

  const db = createDbClient(databaseUrl);

  console.log('Seeding grades...');
  await db
    .insert(grades)
    .values([
      { name: '1° Básico', shortName: '1B', code: '1RD_BASIC', cycle: 1, order: 1 },
      { name: '2° Básico', shortName: '2B', code: '2ND_BASIC', cycle: 1, order: 2 },
      { name: '3° Básico', shortName: '3B', code: '3RD_BASIC', cycle: 1, order: 3 },
      { name: '4° Básico', shortName: '4B', code: '4TH_BASIC', cycle: 1, order: 4 },
      { name: '5° Básico', shortName: '5B', code: '5TH_BASIC', cycle: 2, order: 5 },
      { name: '6° Básico', shortName: '6B', code: '6TH_BASIC', cycle: 2, order: 6 },
      { name: '7° Básico', shortName: '7B', code: '7TH_BASIC', cycle: 2, order: 7 },
      { name: '8° Básico', shortName: '8B', code: '8TH_BASIC', cycle: 2, order: 8 },
      { name: '1° Medio', shortName: '1M', code: '1ST_MEDIO', cycle: 3, order: 9 },
      { name: '2° Medio', shortName: '2M', code: '2ND_MEDIO', cycle: 3, order: 10 },
      { name: '3° Medio', shortName: '3M', code: '3RD_MEDIO', cycle: 3, order: 11 },
      { name: '4° Medio', shortName: '4M', code: '4TH_MEDIO', cycle: 3, order: 12 },
    ])
    .onConflictDoNothing();

  console.log('Seeding subjects...');
  await db
    .insert(subjects)
    .values([
      { name: 'Lenguaje y Comunicación', shortName: 'Lenguaje', code: 'LANG' },
      { name: 'Matemáticas', shortName: 'Matemáticas', code: 'MATH' },
      { name: 'Ciencias Naturales', shortName: 'Ciencias', code: 'SCI' },
      { name: 'Historia, Geografía y Cs. Sociales', shortName: 'Historia', code: 'HIST' },
      { name: 'Inglés', shortName: 'Inglés', code: 'ENG' },
    ])
    .onConflictDoNothing();

  console.log('Seeding curricula...');
  await db
    .insert(curricula)
    .values([
      { name: 'MINEDUC 2024', type: 'mineduc', isOfficial: true, version: '2024' },
      { name: 'DIA 2025', type: 'dia', isOfficial: true, version: '2025' },
    ])
    .onConflictDoNothing();

  console.log('Seed completed.');
  process.exit(0);
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
