'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ASSESS_CAPTURE_MAX_IMAGE_BYTES } from '@soe/types';

export type CameraStatus = 'idle' | 'starting' | 'active' | 'unsupported' | 'denied' | 'error';

export type CapturedJpeg = { blob: Blob; imageBase64: string };

const MAX_CAPTURE_DIMENSION = 2200;
const JPEG_QUALITY_STEPS = [0.85, 0.7, 0.55] as const;

export function isCameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

function isPermissionError(err: unknown): boolean {
  return (
    err instanceof DOMException &&
    (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError')
  );
}

function drawScaled(
  source: CanvasImageSource,
  width: number,
  height: number,
): HTMLCanvasElement | null {
  const scale = Math.min(1, MAX_CAPTURE_DIMENSION / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      resolve(dataUrl.slice(dataUrl.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('No se pudo codificar la foto'));
    reader.readAsDataURL(blob);
  });
}

async function canvasToJpeg(canvas: HTMLCanvasElement | null): Promise<CapturedJpeg | null> {
  if (!canvas) return null;
  for (const quality of JPEG_QUALITY_STEPS) {
    const blob = await canvasToBlob(canvas, quality);
    if (blob && blob.size <= ASSESS_CAPTURE_MAX_IMAGE_BYTES) {
      return { blob, imageBase64: await blobToBase64(blob) };
    }
  }
  return null;
}

export async function fileToCapturedJpeg(file: File): Promise<CapturedJpeg | null> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' }).catch(
    () => null,
  );
  if (!bitmap) return null;
  const jpeg = await canvasToJpeg(drawScaled(bitmap, bitmap.width, bitmap.height));
  bitmap.close();
  return jpeg;
}

export function useCameraCapture() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const disposedRef = useRef(false);
  const startingRef = useRef(false);
  const [status, setStatus] = useState<CameraStatus>('idle');

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setStatus('idle');
  }, []);

  const start = useCallback(async () => {
    if (startingRef.current) return;
    if (!isCameraSupported()) {
      setStatus('unsupported');
      return;
    }
    startingRef.current = true;
    setStatus('starting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 2560 },
          height: { ideal: 1920 },
        },
        audio: false,
      });
      if (disposedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
      }
      setStatus('active');
    } catch (err) {
      setStatus(isPermissionError(err) ? 'denied' : 'error');
    } finally {
      startingRef.current = false;
    }
  }, []);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const captureJpeg = useCallback(async (): Promise<CapturedJpeg | null> => {
    const video = videoRef.current;
    if (!video || video.videoWidth === 0) return null;
    return canvasToJpeg(drawScaled(video, video.videoWidth, video.videoHeight));
  }, []);

  return { videoRef, status, start, stop, captureJpeg };
}
