import { useContext } from 'react';
import { ServicesContext } from './ServicesContext';
import type { ServicesContextType } from './ServicesContext';

export const useServices = (): ServicesContextType => {
  const context = useContext(ServicesContext);
  if (!context) {
    throw new Error('useServices must be used within ServicesProvider');
  }
  return context;
};
