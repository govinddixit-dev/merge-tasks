/**
 * Data API stub — not used in production.
 * This file is kept to avoid breaking any imports.
 * If you need to call external APIs, implement them directly in the relevant router.
 */
export type DataApiCallOptions = {
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  pathParams?: Record<string, unknown>;
  formData?: Record<string, unknown>;
};

export async function callDataApi(
  apiId: string,
  _options: DataApiCallOptions = {}
): Promise<unknown> {
  throw new Error(
    `callDataApi("${apiId}") is not implemented. Implement the API call directly in your router.`
  );
}
