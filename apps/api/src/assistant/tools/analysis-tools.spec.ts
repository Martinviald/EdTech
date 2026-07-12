import type {
  AssessmentReportResponse,
  GenerationalComparisonResponse,
  ProgressionResponse,
  StudentResultDetail,
} from '@soe/types';
import type { JwtPayload } from '../../auth/jwt-payload.types';
import type { AnalyticsService } from '../../analytics/analytics.service';
import type { AssessmentReportService } from '../../assessment-report/assessment-report.service';
import type { AssessmentResultsService } from '../../assessment-results/assessment-results.service';
import { GetProgressionTool } from './get-progression.tool';
import { GetGenerationalTool } from './get-generational.tool';
import { GetAssessmentReportTool } from './get-assessment-report.tool';
import { GetStudentDetailTool } from './get-student-detail.tool';

// ──────────────────────────────────────────────────────────────────────────────
// Identidad del caller. Las tools deben pasar ESTE user a los services (nunca
// derivar identidad del input del modelo).
// ──────────────────────────────────────────────────────────────────────────────

const USER: JwtPayload = {
  userId: 'user-1',
  orgId: 'org-1',
  email: 'dir@colegio.cl',
  name: 'Directora',
  isPlatformAdmin: false,
  roles: ['academic_director'],
  activeRole: 'academic_director',
  role: 'academic_director',
};

const CTX = { user: USER };

// Datos PII que NUNCA deben aparecer en la salida serializada.
const SECRET_NAME = 'Juan Pérez González';
const SECRET_RUT = '12.345.678-9';
const STUDENT_ID = '11111111-1111-1111-1111-111111111111';
const ASSESSMENT_ID = '22222222-2222-2222-2222-222222222222';

// ──────────────────────────────────────────────────────────────────────────────
// get_progression
// ──────────────────────────────────────────────────────────────────────────────

describe('GetProgressionTool', () => {
  function makeAnalytics(response: ProgressionResponse) {
    const progression = jest.fn().mockResolvedValue(response);
    return { service: { progression } as unknown as AnalyticsService, progression };
  }

  it('llama al service con ctx.user y serializa la respuesta', async () => {
    const response: ProgressionResponse = {
      scope: 'class',
      subjectId: null,
      entityId: 'cg-1',
      entityLabel: '4°A',
      points: [],
    };
    const { service, progression } = makeAnalytics(response);
    const tool = new GetProgressionTool(service);

    const result = await tool.execute(
      { scope: 'class', classGroupId: '33333333-3333-3333-3333-333333333333' },
      CTX,
    );

    expect(progression).toHaveBeenCalledTimes(1);
    expect(progression.mock.calls[0][0]).toBe(USER);
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content)).toEqual(response);
  });

  it('reemplaza el entityLabel por el studentId cuando scope=student (PII-free)', async () => {
    const response: ProgressionResponse = {
      scope: 'student',
      subjectId: null,
      entityId: STUDENT_ID,
      entityLabel: SECRET_NAME, // el service devuelve el nombre del alumno
      points: [],
    };
    const { service } = makeAnalytics(response);
    const tool = new GetProgressionTool(service);

    const result = await tool.execute({ scope: 'student', studentId: STUDENT_ID }, CTX);

    expect(result.content).not.toContain(SECRET_NAME);
    const parsed = JSON.parse(result.content) as ProgressionResponse;
    expect(parsed.entityLabel).toBe(STUDENT_ID);
    expect(parsed.entityId).toBe(STUDENT_ID);
  });

  it('input inválido → isError sin llamar al service', async () => {
    const { service, progression } = makeAnalytics({} as ProgressionResponse);
    const tool = new GetProgressionTool(service);

    const result = await tool.execute({ scope: 'student' }, CTX); // falta studentId

    expect(progression).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content).error).toBe('Parámetros inválidos');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// get_generational
// ──────────────────────────────────────────────────────────────────────────────

describe('GetGenerationalTool', () => {
  it('llama al service con ctx.user y serializa la respuesta agregada', async () => {
    const response: GenerationalComparisonResponse = {
      gradeId: 'g-1',
      gradeName: '3° básico',
      subjectId: null,
      subjectName: null,
      nodeId: null,
      nodeName: null,
      series: [],
    };
    const generational = jest.fn().mockResolvedValue(response);
    const tool = new GetGenerationalTool({
      generational,
    } as unknown as AnalyticsService);

    const result = await tool.execute(
      { gradeId: '44444444-4444-4444-4444-444444444444' },
      CTX,
    );

    expect(generational).toHaveBeenCalledTimes(1);
    expect(generational.mock.calls[0][0]).toBe(USER);
    expect(JSON.parse(result.content)).toEqual(response);
  });

  it('input inválido → isError sin llamar al service', async () => {
    const generational = jest.fn();
    const tool = new GetGenerationalTool({
      generational,
    } as unknown as AnalyticsService);

    const result = await tool.execute({ gradeId: 'not-a-uuid' }, CTX);

    expect(generational).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// get_assessment_report
// ──────────────────────────────────────────────────────────────────────────────

describe('GetAssessmentReportTool', () => {
  function makeReport(): AssessmentReportResponse {
    return {
      meta: {
        assessmentId: ASSESSMENT_ID,
        assessmentName: 'DIA Lenguaje',
        instrumentId: 'inst-1',
        instrumentName: 'DIA',
        instrumentType: 'dia',
        subjectName: 'Lenguaje',
        gradeName: '3° básico',
        administeredAt: null,
        classGroups: [],
        itemsCount: 0,
      },
      summary: {
        studentsEvaluated: 1,
        studentsEnrolled: 1,
        coverageRate: 100,
        averageAchievement: 50,
        hasGradingScale: true,
        averageGrade: 4,
        passingGrade: 4,
        passingRate: 100,
        performanceLevel: 'elementary',
      },
      distribution: [],
      courseComparison: [],
      skills: [],
      highlights: { strengths: [], gaps: [] },
      items: [],
      studentsAtRisk: [
        {
          studentId: STUDENT_ID,
          studentRut: SECRET_RUT,
          studentFullName: SECRET_NAME,
          classGroupName: '4°A',
          achievement: 30,
          performanceLevel: 'insufficient',
          weakestSkill: 'Comprensión lectora',
        },
      ],
      recommendations: [],
    };
  }

  it('llama al service con ctx.user y remueve nombre/RUT de studentsAtRisk', async () => {
    const getReport = jest.fn().mockResolvedValue(makeReport());
    const tool = new GetAssessmentReportTool({
      getReport,
    } as unknown as AssessmentReportService);

    const result = await tool.execute({ assessmentId: ASSESSMENT_ID }, CTX);

    expect(getReport).toHaveBeenCalledTimes(1);
    expect(getReport.mock.calls[0][0]).toBe(USER);

    // PII fuera, studentId dentro.
    expect(result.content).not.toContain(SECRET_NAME);
    expect(result.content).not.toContain(SECRET_RUT);
    expect(result.content).toContain(STUDENT_ID);

    const parsed = JSON.parse(result.content) as AssessmentReportResponse;
    const risk = parsed.studentsAtRisk[0] as Record<string, unknown>;
    expect(risk.studentId).toBe(STUDENT_ID);
    expect(risk).not.toHaveProperty('studentFullName');
    expect(risk).not.toHaveProperty('studentRut');
    expect(risk.weakestSkill).toBe('Comprensión lectora');
  });

  it('input inválido → isError sin llamar al service', async () => {
    const getReport = jest.fn();
    const tool = new GetAssessmentReportTool({
      getReport,
    } as unknown as AssessmentReportService);

    const result = await tool.execute({ assessmentId: 'nope' }, CTX);

    expect(getReport).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// get_student_detail
// ──────────────────────────────────────────────────────────────────────────────

describe('GetStudentDetailTool', () => {
  function makeDetail(): StudentResultDetail {
    return {
      result: {
        id: 'r-1',
        assessmentId: ASSESSMENT_ID,
        studentId: STUDENT_ID,
        studentRut: SECRET_RUT,
        studentFullName: SECRET_NAME,
        totalScore: '10',
        maxScore: '20',
        percentage: '50',
        grade: '4',
        performanceLevel: 'elementary',
        isComplete: true,
        completedAt: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      skillResults: [],
      responses: [
        {
          itemId: 'i-1',
          itemPosition: 1,
          rawAnswer: 'B',
          isCorrect: true,
          rawScore: '1',
          finalScore: '1',
          maxScore: '1',
        },
      ],
    };
  }

  it('llama al service con ctx.user + ambos ids y remueve nombre/RUT del result', async () => {
    const getStudentDetail = jest.fn().mockResolvedValue(makeDetail());
    const tool = new GetStudentDetailTool({
      getStudentDetail,
    } as unknown as AssessmentResultsService);

    const result = await tool.execute(
      { assessmentId: ASSESSMENT_ID, studentId: STUDENT_ID },
      CTX,
    );

    expect(getStudentDetail).toHaveBeenCalledTimes(1);
    expect(getStudentDetail).toHaveBeenCalledWith(USER, ASSESSMENT_ID, STUDENT_ID);

    // PII fuera, studentId + métricas dentro.
    expect(result.content).not.toContain(SECRET_NAME);
    expect(result.content).not.toContain(SECRET_RUT);
    expect(result.content).toContain(STUDENT_ID);

    const parsed = JSON.parse(result.content) as StudentResultDetail;
    const res = parsed.result as Record<string, unknown>;
    expect(res.studentId).toBe(STUDENT_ID);
    expect(res).not.toHaveProperty('studentFullName');
    expect(res).not.toHaveProperty('studentRut');
    expect(res.percentage).toBe('50');
    expect(res.grade).toBe('4');
    expect(res.performanceLevel).toBe('elementary');
    expect(parsed.responses[0].itemId).toBe('i-1');
    expect(parsed.responses[0].isCorrect).toBe(true);
  });

  it('input inválido → isError sin llamar al service', async () => {
    const getStudentDetail = jest.fn();
    const tool = new GetStudentDetailTool({
      getStudentDetail,
    } as unknown as AssessmentResultsService);

    const result = await tool.execute(
      { assessmentId: ASSESSMENT_ID, studentId: 'not-a-uuid' },
      CTX,
    );

    expect(getStudentDetail).not.toHaveBeenCalled();
    expect(result.isError).toBe(true);
  });
});
