import { FilterBarSkeleton, CardSkeleton } from '@/components/shared';

export default function TrayectoriaLoading() {
  return (
    <>
      <FilterBarSkeleton fields={5} />
      <CardSkeleton rows={6} />
    </>
  );
}
