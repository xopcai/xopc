import type { DesktopGatewayTarget } from './desktop-transport.js';

let selected: DesktopGatewayTarget | undefined;
export function setSelectedDesktopGateway(target: DesktopGatewayTarget): void { selected = Object.freeze({ ...target }); }
export function getSelectedDesktopGateway(): DesktopGatewayTarget | undefined { return selected; }
