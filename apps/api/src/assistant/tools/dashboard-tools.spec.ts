import type {
  DashboardFilterOptionsResponse,
  DashboardOverviewResponse,
  DashboardPerformanceResponse,
  DashboardSkillsResponse,
  HeatmapResponse,
} from '@soe/types';
import type { JwtPayload } from '../../auth/jwt-payload.types';
import type { DashboardsService } from '../../dashboards/dashboards.service';
import type { HeatmapService } from '../../heatmap/heatmap.service';
import type { ItemAnalysisService } from '../../item-analysis/item-analysis.service';
import type { AssistantToolContext } from './assistant-tool.types';
import { ListFilterOptionsTool } from './list-filter-options.tool';
import { ListAssessmentsTool } from './list-assessments.tool';
import { GetDashboardOverviewTool } from './get-dashboard-overview.tool';
import { GetDashboardSkillsTool } from './get-dashboard-skills.tool';
import { GetDashboardPerformanceTool } from './get-dashboard-performance.tool';
import { GetHeatmapTool } from './get-heatmap.tool';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers: identidad del JWT (ctx.user) + un UUID válido para inputs válidos.
// ──────────────────────────────────────────────────────────────────────────────

const USER: JwtPayload = {
  userId: '11111111-1111-1111-1111-111111111111',
  orgId: '22222222-2222-2222-2222-222222222222',
  email: 'dir@colegio.cl',
  name: 'Dir',
  isPlatformAdmin: false,
  roles: ['school_admin'],
  activeRole: 'school_admin',
  role: 'school_admin',
};
const CTX: AssistantToolContext = { user: USER };
const UUID = '33333333-3333-3333-3333-333333333333';

describe('list_filter_options tool', () => {
  it('valida e invoca getFilterOptions con ctx.user y serializa', async () => {
    const response: DashboardFilterOptionsResponse = {
      subjects: [{ id: UUID, label: 'Matemática' }],
      grades: [],
      classGroups: [],
      periods: [],
      instruments: [],
    };
    const getFilterOptions = jest.fn().mockResolvedValue(response);
    const tool = new ListFilterOptionsTool({
      getFilterOptions,
    } as unknown as DashboardsService);

    const result = await tool.execute({}, CTX);

    expect(getFilterOptions).toHaveBeenCalledWith(USER, expect.any(Object));
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual(response);
  });

  it('input inválido → isError', async () => {
    const tool = new ListFilterOptionsTool({
      getFilterOptions: jest.fn(),
    } as unknown as DashboardsService);

    const result = await tool.execute({ subjectId: 'no-es-uuid' }, CTX);

    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toBe('Parámetros inválidos');
  });
});

describe('get_dashboard_overview tool', () => {
  it('valida e invoca getOverview con ctx.user', async () => {
    const response = { scope: 'org' } as unknown as DashboardOverviewResponse;
    const getOverview = jest.fn().mockResolvedValue(response);
    const tool = new GetDashboardOverviewTool({
      getOverview,
    } as unknown as DashboardsService);

    const result = await tool.execute({ classGroupId: UUID }, CTX);

    expect(getOverview).toHaveBeenCalledWith(USER, expect.objectContaining({ classGroupId: UUID }));
    expect(JSON.parse(result.content)).toEqual(response);
  });

  it('input inválido → isError', async () => {
    const getOverview = jest.fn();
    const tool = new GetDashboardOverviewTool({
      getOverview,
    } as unknown as DashboardsService);

    const result = await tool.execute({ gradeId: 'x' }, CTX);

    expect(result.isError).toBe(true);
    expect(getOverview).not.toHaveBeenCalled();
  });
});

describe('get_dashboard_skills tool', () => {
  it('valida e invoca getSkills con ctx.user', async () => {
    const response: DashboardSkillsResponse = { skills: [] };
    const getSkills = jest.fn().mockResolvedValue(response);
    const tool = new GetDashboardSkillsTool({
      getSkills,
    } as unknown as DashboardsService);

    const result = await tool.execute({ subjectId: UUID }, CTX);

    expect(getSkills).toHaveBeenCalledWith(USER, expect.objectContaining({ subjectId: UUID }));
    expect(JSON.parse(result.content)).toEqual(response);
  });

  it('input inválido → isError', async () => {
    const getSkills = jest.fn();
    const tool = new GetDashboardSkillsTool({
      getSkills,
    } as unknown as DashboardsService);

    const result = await tool.execute({ subjectId: 123 }, CTX);

    expect(result.isError).toBe(true);
    expect(getSkills).not.toHaveBeenCalled();
  });
});

describe('get_dashboard_performance tool (guardrail PII)', () => {
  function makeResponse(): DashboardPerformanceResponse {
    return {
      distribution: [],
      thresholds: { elementary: 0.4, adequate: 0.7, advanced: 0.85 },
      students: {
        data: [
          {
            studentId: UUID,
            studentRut: '12.345.678-9',
            studentFullName: 'Juan Pérez',
            classGroupId: UUID,
            classGroupName: '4°A',
            achievement: 72,
            grade: '5.50',
            performanceLevel: 'adequate',
          },
        ],
        total: 1,
        page: 1,
        limit: 50,
      },
    };
  }

  it('proyecta filas SIN studentFullName/studentRut pero CON studentId', async () => {
    const getPerformance = jest.fn().mockResolvedValue(makeResponse());
    const tool = new GetDashboardPerformanceTool({
      getPerformance,
    } as unknown as DashboardsService);

    const result = await tool.execute({}, CTX);

    expect(result.isError).toBeUndefined();
    // El JSON serializado NO debe contener PII en absoluto.
    expect(result.content).not.toContain('studentFullName');
    expect(result.content).not.toContain('studentRut');
    expect(result.content).not.toContain('Juan Pérez');
    expect(result.content).not.toContain('12.345.678-9');

    const parsed = JSON.parse(result.content);
    const row = parsed.students.data[0];
    expect(row.studentId).toBe(UUID);
    expect(row.achievement).toBe(72);
    expect(row.grade).toBe('5.50');
    expect(row.performanceLevel).toBe('adequate');
    expect(row.classGroupName).toBe('4°A');
    expect(row).not.toHaveProperty('studentFullName');
    expect(row).not.toHaveProperty('studentRut');
  });

  it('aplica limit por defecto e informa truncado', async () => {
    const response = makeResponse();
    response.students.total = 120; // hay más filas de las devueltas
    const getPerformance = jest.fn().mockResolvedValue(response);
    const tool = new GetDashboardPerformanceTool({
      getPerformance,
    } as unknown as DashboardsService);

    const result = await tool.execute({}, CTX);

    // El default limit=50 se pasó al service.
    expect(getPerformance).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ page: 1, limit: 50 }),
    );
    const parsed = JSON.parse(result.content);
    expect(parsed.students.truncated).toBe(true);
    expect(parsed.students.returned).toBe(1);
    expect(parsed.students.total).toBe(120);
  });

  it('input inválido → isError', async () => {
    const getPerformance = jest.fn();
    const tool = new GetDashboardPerformanceTool({
      getPerformance,
    } as unknown as DashboardsService);

    const result = await tool.execute({ performanceLevel: 'no-existe' }, CTX);

    expect(result.isError).toBe(true);
    expect(getPerformance).not.toHaveBeenCalled();
  });
});

describe('get_heatmap tool', () => {
  it('valida e invoca getHeatmap con ctx.user', async () => {
    const response: HeatmapResponse = { subjects: [], rows: [] };
    const getHeatmap = jest.fn().mockResolvedValue(response);
    const tool = new GetHeatmapTool({
      getHeatmap,
    } as unknown as HeatmapService);

    const result = await tool.execute({ gradeId: UUID }, CTX);

    expect(getHeatmap).toHaveBeenCalledWith(USER, expect.objectContaining({ gradeId: UUID }));
    expect(JSON.parse(result.content)).toEqual(response);
  });

  it('input inválido → isError', async () => {
    const getHeatmap = jest.fn();
    const tool = new GetHeatmapTool({
      getHeatmap,
    } as unknown as HeatmapService);

    const result = await tool.execute({ instrumentId: 'nope' }, CTX);

    expect(result.isError).toBe(true);
    expect(getHeatmap).not.toHaveBeenCalled();
  });
});

describe('list_assessments tool', () => {
  it('valida e invoca listAssessments con ctx.user y serializa', async () => {
    const response = {
      data: [
        {
          assessmentId: UUID,
          name: 'DIA Matemática diagnóstico',
          instrumentName: 'DIA Mat',
          instrumentType: 'dia',
          subjectName: 'Matemática',
          gradeName: '8° básico',
          administeredAt: '2026-03-01',
          studentsCount: 30,
        },
      ],
    };
    const listAssessments = jest.fn().mockResolvedValue(response);
    const tool = new ListAssessmentsTool({
      listAssessments,
    } as unknown as ItemAnalysisService);

    const result = await tool.execute({ instrumentType: 'dia' }, CTX);

    expect(listAssessments).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({ instrumentType: 'dia' }),
    );
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual(response);
  });

  it('input inválido (UUID malformado) → isError sin invocar el service', async () => {
    const listAssessments = jest.fn();
    const tool = new ListAssessmentsTool({
      listAssessments,
    } as unknown as ItemAnalysisService);

    const result = await tool.execute({ subjectId: 'no-uuid' }, CTX);

    expect(result.isError).toBe(true);
    expect(listAssessments).not.toHaveBeenCalled();
  });
});
