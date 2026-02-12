import { useContext } from 'react';
import { Sphere } from '@unicitylabs/sphere-sdk';
import { SphereContext, type SphereContextValue } from '../../SphereContext';

export function useSphereContext(): SphereContextValue {
  const context = useContext(SphereContext);
  if (!context) {
    throw new Error('useSphereContext must be used within SphereProvider');
  }
  return context;
}

export function useSphere(): Sphere {
  const { sphere } = useSphereContext();
  if (!sphere) {
    throw new Error('Wallet not initialized');
  }
  return sphere;
}
