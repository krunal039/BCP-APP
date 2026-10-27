/**
 * Local API URL for Expo.
 * - iOS simulator / web: http://localhost:3001
 * - Android emulator: http://10.0.2.2:3001
 * - Physical device: http://<your-lan-ip>:3001
 */
export function getApiBaseUrl(): string {
  return (
    process.env.EXPO_PUBLIC_API_URL?.replace(/\/$/, "") ||
    "http://localhost:3001"
  );
}
