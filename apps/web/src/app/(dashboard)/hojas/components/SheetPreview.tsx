import { SHEET_QR_IDENTITY_REGION, type LayoutField, type LayoutSpec } from '@soe/types';
import { cn } from '@/lib/utils';

/**
 * Vista previa de la hoja de respuesta, página por página, dibujada DESDE el
 * `LayoutSpec` — la misma verdad que consume el impresor (pdf-lib) y el lector
 * (servicio de visión). Nunca hay una segunda fuente de coordenadas: si esta
 * preview dibuja una burbuja en otro lado, el bug es de este componente, no
 * del spec.
 *
 * Matemática de coordenadas (D7): todas las coordenadas del spec son
 * fracciones 0–1 del rectángulo definido por los centros de los cuatro
 * fiduciales de esquina, NO de la página. Acá se dibuja la página con la
 * proporción del papel, se ubican los fiduciales con `marginRatio`/`sizeRatio`
 * (fracciones del ancho de página) y se escalan las coordenadas normalizadas a
 * ese rectángulo de referencia.
 */

const PAPER_DIMENSIONS: Record<LayoutSpec['paper'], { width: number; height: number }> = {
  letter: { width: 850, height: 1100 },
  a4: { width: 827, height: 1169 },
  legal: { width: 850, height: 1400 },
};


type ReferenceFrame = {
  originX: number;
  originY: number;
  spanX: number;
  spanY: number;
};

function scaleX(frame: ReferenceFrame, x: number): number {
  return frame.originX + x * frame.spanX;
}

function scaleY(frame: ReferenceFrame, y: number): number {
  return frame.originY + y * frame.spanY;
}

function groupFieldsByPage(fields: LayoutField[]): Map<number, LayoutField[]> {
  const byPage = new Map<number, LayoutField[]>();
  for (const field of fields) {
    const bucket = byPage.get(field.pageIndex);
    if (bucket) {
      bucket.push(field);
    } else {
      byPage.set(field.pageIndex, [field]);
    }
  }
  return byPage;
}

export function SheetPreview({ spec, className }: { spec: LayoutSpec; className?: string }) {
  const paper = PAPER_DIMENSIONS[spec.paper];
  const fiducialSide = spec.fiducials.sizeRatio * paper.width;
  const fiducialMargin = spec.fiducials.marginRatio * paper.width;
  const fiducialCenterOffset = fiducialMargin + fiducialSide / 2;

  const frame: ReferenceFrame = {
    originX: fiducialCenterOffset,
    originY: fiducialCenterOffset,
    spanX: paper.width - 2 * fiducialCenterOffset,
    spanY: paper.height - 2 * fiducialCenterOffset,
  };

  const fieldsByPage = groupFieldsByPage(spec.fields);
  const pages = Array.from({ length: spec.pageCount }, (_, pageIndex) => pageIndex);

  return (
    <div className={cn('grid gap-4 sm:grid-cols-2', className)}>
      {pages.map((pageIndex) => (
        <figure key={pageIndex} className="space-y-2">
          <SheetPage
            paper={paper}
            frame={frame}
            fiducialSide={fiducialSide}
            fiducialMargin={fiducialMargin}
            identity={spec.identity}
            fields={fieldsByPage.get(pageIndex) ?? []}
          />
          <figcaption className="text-center text-xs text-muted-foreground">
            Página {pageIndex + 1} de {spec.pageCount}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

function SheetPage({
  paper,
  frame,
  fiducialSide,
  fiducialMargin,
  identity,
  fields,
}: {
  paper: { width: number; height: number };
  frame: ReferenceFrame;
  fiducialSide: number;
  fiducialMargin: number;
  identity: LayoutSpec['identity'];
  fields: LayoutField[];
}) {
  const fiducialPositions = [
    { x: fiducialMargin, y: fiducialMargin },
    { x: paper.width - fiducialMargin - fiducialSide, y: fiducialMargin },
    { x: fiducialMargin, y: paper.height - fiducialMargin - fiducialSide },
    {
      x: paper.width - fiducialMargin - fiducialSide,
      y: paper.height - fiducialMargin - fiducialSide,
    },
  ];

  return (
    <svg
      viewBox={`0 0 ${paper.width} ${paper.height}`}
      role="img"
      aria-label="Vista previa de la hoja de respuesta"
      className="h-auto w-full rounded-md border border-border bg-card shadow-sm"
    >
      {fiducialPositions.map((pos, index) => (
        <rect
          key={index}
          x={pos.x}
          y={pos.y}
          width={fiducialSide}
          height={fiducialSide}
          className="fill-foreground"
        />
      ))}

      <IdentityMarks identity={identity} frame={frame} />

      {fields.map((field) => (
        <FieldMarks key={field.fieldId} field={field} frame={frame} />
      ))}
    </svg>
  );
}

function IdentityMarks({
  identity,
  frame,
}: {
  identity: LayoutSpec['identity'];
  frame: ReferenceFrame;
}) {
  const identityX = scaleX(frame, identity.region.topLeft.x);
  const identityY = scaleY(frame, identity.region.topLeft.y);
  const identityWidth = scaleX(frame, identity.region.bottomRight.x) - identityX;
  const identityHeight = scaleY(frame, identity.region.bottomRight.y) - identityY;

  const rutBubbles = identity.bubbles ?? [];
  if (rutBubbles.length === 0) {
    return (
      <>
        <rect
          x={identityX}
          y={identityY}
          width={identityWidth}
          height={identityHeight}
          strokeDasharray="8 6"
          strokeWidth={2}
          className="fill-primary/5 stroke-primary"
        />
        <text
          x={identityX + identityWidth / 2}
          y={identityY + identityHeight / 2}
          textAnchor="middle"
          dominantBaseline="central"
          fontSize={Math.max(14, identityHeight * 0.28)}
          className="fill-primary"
        >
          Identidad / QR
        </text>
      </>
    );
  }

  const qrX = scaleX(frame, SHEET_QR_IDENTITY_REGION.topLeft.x);
  const qrY = scaleY(frame, SHEET_QR_IDENTITY_REGION.topLeft.y);
  const qrWidth = scaleX(frame, SHEET_QR_IDENTITY_REGION.bottomRight.x) - qrX;
  const qrHeight = scaleY(frame, SHEET_QR_IDENTITY_REGION.bottomRight.y) - qrY;

  return (
    <g>
      <text
        x={identityX}
        y={identityY - 14}
        fontSize={16}
        className="fill-foreground"
      >
        Nombre: ______________________________
      </text>
      <rect
        x={identityX}
        y={identityY}
        width={identityWidth}
        height={identityHeight}
        strokeDasharray="8 6"
        strokeWidth={2}
        className="fill-primary/5 stroke-primary"
      />
      {rutBubbles.map((bubble, index) => {
        const cx = scaleX(frame, bubble.center.x);
        const cy = scaleY(frame, bubble.center.y);
        const r = bubble.radius * frame.spanX;
        return (
          <g key={`identity-${bubble.group ?? 0}-${bubble.value}-${index}`}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              strokeWidth={1.5}
              className="fill-transparent stroke-muted-foreground"
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={r * 1.1}
              className="fill-muted-foreground"
            >
              {bubble.value}
            </text>
          </g>
        );
      })}
      <rect
        x={qrX}
        y={qrY}
        width={qrWidth}
        height={qrHeight}
        strokeDasharray="8 6"
        strokeWidth={2}
        className="fill-primary/5 stroke-primary"
      />
      <text
        x={qrX + qrWidth / 2}
        y={qrY + qrHeight / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={Math.max(14, qrHeight * 0.28)}
        className="fill-primary"
      >
        QR
      </text>
    </g>
  );
}

function FieldMarks({ field, frame }: { field: LayoutField; frame: ReferenceFrame }) {
  if (field.kind === 'crop_region') return <CropRegionMarks field={field} frame={frame} />;
  if (field.kind === 'digit_grid') return <DigitGridMarks field={field} frame={frame} />;

  let firstBubble = field.bubbles[0];
  if (!firstBubble) return null;
  for (const bubble of field.bubbles) {
    if (bubble.center.x < firstBubble.center.x) firstBubble = bubble;
  }
  const radius = firstBubble.radius * frame.spanX;
  const labelX = scaleX(frame, firstBubble.center.x) - radius * 2.6;
  const labelY = scaleY(frame, firstBubble.center.y);

  return (
    <g>
      <text
        x={labelX}
        y={labelY}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={radius * 1.3}
        fontWeight={600}
        className="fill-foreground"
      >
        {field.printedNumber}
      </text>
      {field.bubbles.map((bubble) => {
        const cx = scaleX(frame, bubble.center.x);
        const cy = scaleY(frame, bubble.center.y);
        const r = bubble.radius * frame.spanX;
        return (
          <g key={`${field.fieldId}-${bubble.value}`}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              strokeWidth={1.5}
              className="fill-transparent stroke-muted-foreground"
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={r * 1.1}
              className="fill-muted-foreground"
            >
              {bubble.value}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function DigitGridMarks({ field, frame }: { field: LayoutField; frame: ReferenceFrame }) {
  const firstBubble = field.bubbles[0];
  if (!firstBubble) return null;

  let minX = firstBubble.center.x;
  let minY = firstBubble.center.y;
  let maxX = firstBubble.center.x;
  let maxY = firstBubble.center.y;
  let maxRadius = firstBubble.radius;
  for (const bubble of field.bubbles) {
    if (bubble.center.x < minX) minX = bubble.center.x;
    if (bubble.center.y < minY) minY = bubble.center.y;
    if (bubble.center.x > maxX) maxX = bubble.center.x;
    if (bubble.center.y > maxY) maxY = bubble.center.y;
    if (bubble.radius > maxRadius) maxRadius = bubble.radius;
  }

  const radius = maxRadius * frame.spanX;
  const pad = radius * 1.6;
  const boxX = scaleX(frame, minX) - pad;
  const boxY = scaleY(frame, minY) - pad;
  const boxWidth = scaleX(frame, maxX) + pad - boxX;
  const boxHeight = scaleY(frame, maxY) + pad - boxY;

  return (
    <g>
      <rect
        x={boxX}
        y={boxY}
        width={boxWidth}
        height={boxHeight}
        rx={4}
        strokeWidth={1}
        className="fill-muted/40 stroke-border"
      />
      <text
        x={boxX - radius * 1.2}
        y={boxY + boxHeight / 2}
        textAnchor="end"
        dominantBaseline="central"
        fontSize={radius * 1.3}
        fontWeight={600}
        className="fill-foreground"
      >
        {field.printedNumber}
      </text>
      {field.bubbles.map((bubble, index) => {
        const cx = scaleX(frame, bubble.center.x);
        const cy = scaleY(frame, bubble.center.y);
        const r = bubble.radius * frame.spanX;
        return (
          <g key={`${field.fieldId}-${bubble.group ?? 0}-${bubble.value}-${index}`}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              strokeWidth={1.5}
              className="fill-transparent stroke-muted-foreground"
            />
            <text
              x={cx}
              y={cy}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={r * 1.1}
              className="fill-muted-foreground"
            >
              {bubble.value}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function CropRegionMarks({ field, frame }: { field: LayoutField; frame: ReferenceFrame }) {
  if (!field.region) return null;

  const x = scaleX(frame, field.region.topLeft.x);
  const y = scaleY(frame, field.region.topLeft.y);
  const width = scaleX(frame, field.region.bottomRight.x) - x;
  const height = scaleY(frame, field.region.bottomRight.y) - y;
  const labelSize = Math.max(12, Math.min(18, height * 0.2));

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        strokeDasharray="6 5"
        strokeWidth={1.5}
        className="fill-muted/30 stroke-muted-foreground"
      />
      <text
        x={x + labelSize * 0.6}
        y={y + labelSize * 1.2}
        fontSize={labelSize}
        fontWeight={600}
        className="fill-foreground"
      >
        {field.printedNumber}
      </text>
      <text
        x={x + width / 2}
        y={y + height / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={labelSize}
        className="fill-muted-foreground"
      >
        Respuesta escrita
      </text>
    </g>
  );
}
