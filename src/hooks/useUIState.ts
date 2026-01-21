import { useQuery, useQueryClient } from '@tanstack/react-query';

const UI_STATE_KEY = ['ui', 'state'] as const;

interface UIState {
  isFullscreen: boolean;
}

const defaultState: UIState = {
  isFullscreen: false,
};

export function useUIState() {
  const queryClient = useQueryClient();

  const { data: uiState = defaultState } = useQuery({
    queryKey: UI_STATE_KEY,
    queryFn: () => defaultState,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const setFullscreen = (value: boolean) => {
    queryClient.setQueryData<UIState>(UI_STATE_KEY, (prev) => ({
      ...prev,
      ...defaultState,
      isFullscreen: value,
    }));
  };

  const toggleFullscreen = () => {
    queryClient.setQueryData<UIState>(UI_STATE_KEY, (prev) => ({
      ...prev,
      ...defaultState,
      isFullscreen: !prev?.isFullscreen,
    }));
  };

  return {
    isFullscreen: uiState.isFullscreen,
    setFullscreen,
    toggleFullscreen,
  };
}
