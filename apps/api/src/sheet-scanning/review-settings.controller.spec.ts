import 'reflect-metadata';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { REVIEW_SETTINGS_ROLES, type OrgReviewSettingsResponse } from '@soe/types';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import type { JwtPayload } from '../auth/jwt-payload.types';
import { ReviewSettingsController } from './review-settings.controller';
import type { ReviewSettingsService } from './review-settings.service';

const RESPONSE: OrgReviewSettingsResponse = { orgId: 'org-1', review: {} };

function makeController(): {
  controller: ReviewSettingsController;
  getSettings: jest.Mock;
  updateSettings: jest.Mock;
} {
  const getSettings = jest.fn().mockResolvedValue(RESPONSE);
  const updateSettings = jest.fn().mockResolvedValue(RESPONSE);
  const service = { getSettings, updateSettings } as unknown as ReviewSettingsService;
  return { controller: new ReviewSettingsController(service), getSettings, updateSettings };
}

function makeUser(overrides: Partial<JwtPayload> = {}): JwtPayload {
  return {
    userId: 'user-1',
    orgId: 'org-1',
    email: 'admin@colegio.cl',
    name: 'Admin',
    isPlatformAdmin: false,
    roles: ['school_admin'],
    activeRole: 'school_admin',
    role: 'school_admin',
    ...overrides,
  };
}

describe('ReviewSettingsController', () => {
  it('protege GET y PATCH con REVIEW_SETTINGS_ROLES', () => {
    const getRoles = Reflect.getMetadata(
      ROLES_KEY,
      ReviewSettingsController.prototype.getSettings,
    ) as string[];
    const patchRoles = Reflect.getMetadata(
      ROLES_KEY,
      ReviewSettingsController.prototype.updateSettings,
    ) as string[];
    expect(getRoles).toEqual([...REVIEW_SETTINGS_ROLES]);
    expect(patchRoles).toEqual([...REVIEW_SETTINGS_ROLES]);
  });

  it('lee los ajustes con el orgId del JWT del caller', async () => {
    const { controller, getSettings } = makeController();

    await expect(controller.getSettings(makeUser())).resolves.toEqual(RESPONSE);
    expect(getSettings).toHaveBeenCalledWith('org-1');
  });

  it('PATCH válido pasa el dto parseado al servicio', async () => {
    const { controller, updateSettings } = makeController();

    await controller.updateSettings(
      { quickConfirm: true, autoAnnulMinConfidence: null },
      makeUser(),
    );

    expect(updateSettings).toHaveBeenCalledWith('org-1', {
      quickConfirm: true,
      autoAnnulMinConfidence: null,
    });
  });

  it('PATCH con umbral fuera de 0–1 responde 400 sin tocar el servicio', () => {
    const { controller, updateSettings } = makeController();

    expect(() => controller.updateSettings({ autoAnnulMinConfidence: 1.5 }, makeUser())).toThrow(
      BadRequestException,
    );
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('rechaza a un usuario normal que opera sobre otra org', () => {
    const { controller, updateSettings } = makeController();

    expect(() =>
      controller.updateSettings({ quickConfirm: true }, makeUser(), 'org-ajena'),
    ).toThrow(ForbiddenException);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it('exige orgId explícito a un platform_admin', () => {
    const { controller } = makeController();
    const admin = makeUser({ isPlatformAdmin: true, orgId: null });

    expect(() => controller.getSettings(admin)).toThrow(BadRequestException);
  });
});
