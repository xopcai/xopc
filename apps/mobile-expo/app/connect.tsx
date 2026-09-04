import { Redirect } from 'expo-router';

/** Keeps pairing deep links on a valid route while the root layout consumes their payload. */
export default function ConnectRoute() {
  return <Redirect href="/" />;
}
