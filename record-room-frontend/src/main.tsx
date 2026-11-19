import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import './styles/global.css';
import { App } from './App';
import { initLocalDocumentStorage } from './services/impl/document-storage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, refetchOnWindowFocus: false },
  },
});

/**
 * Demo mode persists document bytes in IndexedDB; the store's rows are already
 * in localStorage. Hydrating before the first render keeps every synchronous
 * blob accessor (scan preview, document download) working straight after a
 * refresh. In http mode the API serves the bytes, so this is skipped.
 */
async function boot() {
  if (import.meta.env.VITE_API_MODE !== 'http') {
    try {
      await initLocalDocumentStorage();
    } catch {
      // IndexedDB unavailable: demo storage stays session-only, as before.
    }
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void boot();
