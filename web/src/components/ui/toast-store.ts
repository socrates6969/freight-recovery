import { createStore, type StoreApi } from 'zustand/vanilla';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
}

export interface ToastState {
  toasts: Toast[];
  push: (message: string, tone?: Toast['tone']) => void;
  dismiss: (id: number) => void;
}

export const TOAST_TTL_MS = 5000;

export function createToastStore(): StoreApi<ToastState> {
  let next = 1;
  return createStore<ToastState>()((set, get) => ({
    toasts: [],
    push: (message, tone = 'info') => {
      const id = next++;
      set({ toasts: [...get().toasts, { id, message, tone }].slice(-4) });
      setTimeout(() => get().dismiss(id), TOAST_TTL_MS);
    },
    dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
  }));
}
