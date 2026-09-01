import { MobileCaptureView } from './MobileCaptureView';

export default async function MobileCapturePage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <MobileCaptureView sessionId={sessionId} />;
}
