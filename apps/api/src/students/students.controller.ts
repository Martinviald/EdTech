import {
  BadRequestException,
  Body,
  Controller,
  ParseFilePipeBuilder,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { getEffectiveOrgId } from '../common/helpers/org-context.helper';
import { studentImportCommitBodySchema } from '@soe/types';
import { StudentsImportService } from './students-import.service';

type UploadedCsv = {
  buffer: Buffer;
  originalname: string;
};

const MAX_CSV_BYTES = 5 * 1024 * 1024; // 5 MB

const csvFilePipe = new ParseFilePipeBuilder()
  .addMaxSizeValidator({ maxSize: MAX_CSV_BYTES, message: 'El archivo excede el tamaño máximo (5 MB)' })
  .addFileTypeValidator({ fileType: /(csv|plain|excel)/ })
  .build({ fileIsRequired: true });

@Controller('students')
@UseGuards(RolesGuard)
export class StudentsController {
  constructor(private readonly importService: StudentsImportService) {}

  /** POST /api/students/import/preview — valida el CSV y reporta filas, errores y cursos. */
  @Post('import/preview')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  @UseInterceptors(FileInterceptor('file'))
  preview(
    @CurrentUser() user: JwtPayload,
    @UploadedFile(csvFilePipe) file: UploadedCsv,
  ) {
    const orgId = getEffectiveOrgId(user);
    return this.importService.preview(orgId, file.buffer);
  }

  /** POST /api/students/import/commit — persiste la nómina e instancia el import_job. */
  @Post('import/commit')
  @Roles('school_admin', 'academic_director', 'platform_admin')
  @UseInterceptors(FileInterceptor('file'))
  commit(
    @CurrentUser() user: JwtPayload,
    @UploadedFile(csvFilePipe) file: UploadedCsv,
    @Body() body: unknown,
  ) {
    const orgId = getEffectiveOrgId(user);
    const parsedBody = studentImportCommitBodySchema.safeParse(body ?? {});
    if (!parsedBody.success) {
      throw new BadRequestException(parsedBody.error.flatten());
    }
    return this.importService.commit(
      orgId,
      user.userId,
      file.buffer,
      file.originalname,
      parsedBody.data.confirmCreateMissingCourses,
    );
  }
}
