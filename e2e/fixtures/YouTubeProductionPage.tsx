import { createRoot } from 'react-dom/client';
import { VeloxaYouTubeProductionStudio } from '../../src/components/VeloxaYouTubeProductionStudio';
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-6xl p-4"><VeloxaYouTubeProductionStudio workspaceId="fixture" businessId="primary" businessName="Dafini Code" ready onBusyChange={() => {}} onDirtyChange={() => {}} onManageConnection={() => {}} /></main>);
