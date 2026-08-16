import type { Database } from '../../database/database.types';
import { DbMcpAuditLogger } from './db-mcp-audit-logger';
import type { McpAuditEntry } from '../core/mcp-audit-logger';

const baseEntry: McpAuditEntry = {
  orgId: 'org-1',
  userId: 'user-1',
  tool: 'get_skill_gaps',
  argsHash: 'a'.repeat(64),
  channel: 'mcp-external',
  ok: true,
};

function makeDb(values: jest.Mock) {
  const tx = { insert: () => ({ values }), execute: async () => undefined };
  return {
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
}

describe('DbMcpAuditLogger', () => {
  it('inserta una fila de auditoría dentro del contexto de org', async () => {
    const values = jest.fn().mockResolvedValue(undefined);
    const logger = new DbMcpAuditLogger(makeDb(values));

    await logger.record(baseEntry);

    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', tool: 'get_skill_gaps', ok: true }),
    );
  });

  it('no intenta escribir cuando el principal no tiene org (platform_admin global)', async () => {
    const values = jest.fn();
    const logger = new DbMcpAuditLogger(makeDb(values));

    await logger.record({ ...baseEntry, orgId: null });

    expect(values).not.toHaveBeenCalled();
  });

  it('nunca propaga errores de escritura (la auditoría no rompe la tool)', async () => {
    const values = jest.fn().mockRejectedValue(new Error('db caída'));
    const logger = new DbMcpAuditLogger(makeDb(values));

    await expect(logger.record(baseEntry)).resolves.toBeUndefined();
  });
});
