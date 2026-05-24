import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { PrivacyModule } from './privacy/privacy.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { TaxonomiesModule } from './taxonomies/taxonomies.module';
import { AdminModule } from './admin/admin.module';
import { StaffModule } from './staff/staff.module';
import { TeacherAssignmentsModule } from './teacher-assignments/teacher-assignments.module';
import { ClassGroupsModule } from './class-groups/class-groups.module';
import { StudentsModule } from './students/students.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env', '../../.env'],
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    PrivacyModule,
    OrganizationsModule,
    TaxonomiesModule,
    AdminModule,
    StaffModule,
    TeacherAssignmentsModule,
    ClassGroupsModule,
    StudentsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      // AuthGuard aplicado globalmente: toda ruta requiere JWT salvo @Public().
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
  ],
})
export class AppModule {}
