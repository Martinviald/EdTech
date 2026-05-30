'use client';

import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import type {
  DiaIngestionRequestDto,
  DiaPreviewResponse,
  DiaConfirmResponse,
} from '@soe/types';
import { Stepper } from '@/components/patterns';
import { previewDiaImport, confirmDiaImport } from './actions';
import { UploadStep, type CatalogOptions } from './steps/UploadStep';
import { PreviewStep } from './steps/PreviewStep';
import { ConfirmStep } from './steps/ConfirmStep';

type Step = 'upload' | 'preview' | 'confirm';

const WIZARD_STEPS = [
  { id: 'upload', label: 'Cargar archivo' },
  { id: 'preview', label: 'Previsualizar' },
  { id: 'confirm', label: 'Confirmar' },
];

const STEP_INDEX: Record<Step, number> = { upload: 0, preview: 1, confirm: 2 };

interface DiaImportWizardProps {
  catalogOptions: CatalogOptions;
}

export function DiaImportWizard({ catalogOptions }: DiaImportWizardProps) {
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
    <div className="space-y-6">
      <Stepper steps={WIZARD_STEPS} currentStep={STEP_INDEX[step]} />
      {step === 'upload' && (
        <UploadStep onSubmit={handleUpload} isPending={isPending} catalogOptions={catalogOptions} />
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
