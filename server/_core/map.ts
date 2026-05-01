/**
 * Google Maps API utility — stub.
 * Not currently used in production. Implement with GOOGLE_MAPS_API_KEY when needed.
 */
export type LatLng = { lat: number; lng: number };

export async function geocodeAddress(_address: string): Promise<LatLng | null> {
  throw new Error("Google Maps geocoding is not configured. Set GOOGLE_MAPS_API_KEY in .env.");
}
