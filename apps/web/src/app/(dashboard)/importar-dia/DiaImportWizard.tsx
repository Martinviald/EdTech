'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type {
  DiaIngestionRequestDto,
  DiaPreviewResponse,
  DiaConfirmResponse,
} from '@soe/types';
import { previewDiaImport, confirmDiaImport } from './actions';
import { UploadStep } from './steps/UploadStep';
import { PreviewStep } from './steps/PreviewStep';
import { ConfirmStep } from './steps/ConfirmStep';

type Step = 'upload' | 'preview' | 'confirm';

export function DiaImportWizard() {
  const [step, setStep] = useState<Step>('upload');
  const [isPending, startTransition] = useTransition();
  const [fileData, setFileData] = useState<unknown>(null);
  const [metadata, setMetadata] = useState<DiaIngestionRequestDto | null>(null);
  const [previewResult, setPreviewResult] = useState<DiaPreviewResponse | null>(null);
  const [confirmResult, setConfirmResult] = useState<DiaConfirmResponse | null>(null);

  const handleUpload = (data: unknown, meta: DiaIngestionRequestDto) => {
    setFileData(data);
    setMetadata(meta);
    startTransition(async () => {
      const result = await previewDiaImport(data, meta);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setPreviewResult(result.data);
      setStep('preview');
    });
  };

  const handleConfirm = () => {
    if (!fileData || !metadata) return;
    startTransition(async () => {
      const result = await confirmDiaImport(fileData, metadata);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setConfirmResult(result.data);
      setStep('confirm');
      toast.success('Pauta importada correctamente');
    });
  };

  const handleReset = () => {
    setStep('upload');
    setFileData(null);
    setMetadata(null);
    setPreviewResult(null);
    setConfirmResult(null);
  };

  return (
    <div className="space-y-4">
      {step === 'upload' && (
        <UploadStep onSubmit={handleUpload} isPending={isPending} />
      )}
      {step === 'preview' && previewResult && (
        <PreviewStep
          preview={previewResult}
          onConfirm={handleConfirm}
          onCancel={handleReset}
          isPending={isPending}
        />
      )}
      {step === 'confirm' && confirmResult && (
        <ConfirmStep result={confirmResult} onReset={handleReset} />
      )}
    </div>
  );
}
