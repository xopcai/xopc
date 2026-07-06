import { createContext, useContext } from 'react';

export type GatewayConnectLandingControls = {
  openGatewayConnectLanding: () => void;
};

const defaultControls: GatewayConnectLandingControls = {
  openGatewayConnectLanding: () => {},
};

export const GatewayConnectLandingContext =
  createContext<GatewayConnectLandingControls>(defaultControls);

export function useGatewayConnectLanding(): GatewayConnectLandingControls {
  return useContext(GatewayConnectLandingContext);
}
