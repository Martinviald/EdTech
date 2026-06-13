import { z } from 'zod';

// Participación en benchmarking (F2 S0 — H19.24). networkOrgId NO se almacena:
// se deriva de organizations.parent_id (foundation/sostenedor).

export const updateBenchmarkSettingsSchema = z.object({
  optOutGlobalPool: z.boolean(),
});
export type UpdateBenchmarkSettingsDto = z.infer<typeof updateBenchmarkSettingsSchema>;

export type BenchmarkSettingsModel = {
  orgId: string;
  optOutGlobalPool: boolean;
  consentGrantedAt: string | null;
  networkOrgId: string | null; // derivado de organizations.parent_id
  updatedAt: string;
};
