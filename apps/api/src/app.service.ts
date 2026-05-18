import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  getInfo() {
    return {
      name: 'Sistema Operativo Educativo API',
      version: '0.1.0',
      phase: 'F1 — Caballo de Troya',
      sprint: 'S0 — Cimientos arquitectónicos',
      docs: '/api/docs',
    };
  }
}
