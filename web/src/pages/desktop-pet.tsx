import { ResourceUnavailable } from '@/components/ui/resource-unavailable';
import { DesktopPetRoot } from '@/features/desktop-pet/desktop-pet-root';

export function DesktopPetPage() {
  return window.electronAPI?.pet ? <DesktopPetRoot /> : <ResourceUnavailable kind="desktop" backTo="/" />;
}

