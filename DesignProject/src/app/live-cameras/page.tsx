import { PageHeader } from '@/components/page-header';
import LiveCameraView from './components/live-camera-view';

export default function LiveCamerasPage() {
  return (
    <>
      <PageHeader
        title="Live Cameras"
        description="Monitor classrooms and manage attendance in real-time."
      />
      <div className="w-full">
        <LiveCameraView />
      </div>
    </>
  );
}
