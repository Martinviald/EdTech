import sharp from 'sharp';

import { DecisionError } from '../contracts';
import { JEV_IMAGE_CONSTRAINTS, JEV_IMAGE_TARGET_MIN_SIDE_PX } from '../jev/jev-limits';
import { FIT_IMAGE_JPEG_QUALITY, fitImage, planFit } from './fit-image';

async function blankJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: '#ffffff' } })
    .jpeg()
    .toBuffer();
}

describe('planFit', () => {
  it('lleva el lado menor a 300 px: 250×68 → 1103×300', () => {
    expect(planFit(250, 68, JEV_IMAGE_CONSTRAINTS, JEV_IMAGE_TARGET_MIN_SIDE_PX)).toEqual({
      width: 1103,
      height: 300,
      padWidth: 0,
      padHeight: 0,
    });
  });

  it('con relación de aspecto > 5,6 reduce el lado mayor a 1568 y rellena el menor hasta 280', () => {
    expect(planFit(1000, 100, JEV_IMAGE_CONSTRAINTS, JEV_IMAGE_TARGET_MIN_SIDE_PX)).toEqual({
      width: 1568,
      height: 157,
      padWidth: 0,
      padHeight: 123,
    });
  });

  it('también reduce una imagen grande hasta el lado menor objetivo', () => {
    expect(planFit(3000, 2000, JEV_IMAGE_CONSTRAINTS, JEV_IMAGE_TARGET_MIN_SIDE_PX)).toEqual({
      width: 450,
      height: 300,
      padWidth: 0,
      padHeight: 0,
    });
  });

  it('funciona igual con imágenes verticales', () => {
    expect(planFit(68, 250, JEV_IMAGE_CONSTRAINTS, JEV_IMAGE_TARGET_MIN_SIDE_PX)).toMatchObject({
      width: 300,
      height: 1103,
    });
  });

  it('rechaza una imagen sin tamaño', () => {
    expect(() => planFit(0, 10, JEV_IMAGE_CONSTRAINTS, 300)).toThrow(DecisionError);
  });
});

describe('fitImage', () => {
  it('devuelve un JPEG de 1103×300 para el recorte del OMR', async () => {
    const fitted = await fitImage(await blankJpeg(250, 68), JEV_IMAGE_CONSTRAINTS, 300);
    const meta = await sharp(fitted.data).metadata();
    expect(fitted).toMatchObject({ mimeType: 'image/jpeg', width: 1103, height: 300 });
    expect(meta).toMatchObject({ format: 'jpeg', width: 1103, height: 300 });
    expect(FIT_IMAGE_JPEG_QUALITY).toBe(92);
  });

  it('rellena en blanco cuando la relación de aspecto es muy alargada', async () => {
    const fitted = await fitImage(await blankJpeg(1000, 100), JEV_IMAGE_CONSTRAINTS, 300);
    const meta = await sharp(fitted.data).metadata();
    expect(meta).toMatchObject({ width: 1568, height: 280 });
  });

  it('convierte un PNG con transparencia a JPEG', async () => {
    const png = await sharp({
      create: { width: 250, height: 68, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const fitted = await fitImage(png, JEV_IMAGE_CONSTRAINTS, 300);
    expect((await sharp(fitted.data).metadata()).format).toBe('jpeg');
  });

  it('rechaza bytes que no son una imagen', async () => {
    await expect(
      fitImage(Buffer.from('no soy una imagen'), JEV_IMAGE_CONSTRAINTS, 300),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('rechaza el resultado si supera maxBytes', async () => {
    await expect(
      fitImage(await blankJpeg(250, 68), { ...JEV_IMAGE_CONSTRAINTS, maxBytes: 10 }, 300),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
