import { Controller, Get } from '@nestjs/common';
import { asc } from 'drizzle-orm';
import { subjects, grades } from '@soe/db';
import { Public } from '../common/decorators/public.decorator';
import { InjectDb, type Database } from '../database/database.types';

@Controller('catalog')
export class CatalogController {
  constructor(@InjectDb() private readonly db: Database) {}

  @Public()
  @Get('subjects')
  async getSubjects() {
    return this.db.select().from(subjects);
  }

  @Public()
  @Get('grades')
  async getGrades() {
    return this.db.select().from(grades).orderBy(asc(grades.order));
  }
}
