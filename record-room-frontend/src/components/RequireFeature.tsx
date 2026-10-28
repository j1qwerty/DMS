import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useFeatures, type Features } from '../lib/features';

/** Sends people home when a page belongs to a feature that is switched off. */
export function RequireFeature({
  feature,
  children,
}: {
  feature: keyof Features;
  children: ReactNode;
}) {
  const features = useFeatures();
  return features[feature] ? <>{children}</> : <Navigate to="/files" replace />;
}
