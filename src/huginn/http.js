// -----------------------------------------------------------------------------
// The one function that talks to the network: an HTTP(S) request on node:http /
// node:https. Not on fetch: fetch cannot accept the self-signed certificate of
// one server only (a Huginn behind a home reverse proxy often has
// one), node:https can, per request. Redirects are not followed: Huginn
// answers a lost session with a redirect to its sign-in page.
//
// The client takes this function as a parameter: the tests replace it with an
// in-memory Huginn (test/helpers/fakeHuginn.js).
// (Adapted from guim31/gladys-changedetection.)
// -----------------------------------------------------------------------------

import http from 'node:http';
import https from 'node:https';

// A page of 25 agents carries their options and memory, a page of events their
// payloads: a few hundred KB at most, usually.
export const MAX_BODY_BYTES = 8 * 1024 * 1024;

/**
 * @param {string} url absolute URL
 * @param {object} [options]
 * @param {string} [options.method] GET by default
 * @param {Record<string, string>} [options.headers]
 * @param {string} [options.body] request body (JSON text)
 * @param {boolean} [options.insecure] accept a certificate that does not verify (HTTPS only)
 * @param {number} [options.timeoutMs]
 * @returns {Promise<{ status: number, headers: Record<string, string>, body: string }>}
 */
export function httpRequest(
  url,
  { method = 'GET', headers = {}, body, insecure = false, timeoutMs = 10_000 } = {},
) {
  const target = new URL(url);
  const isHttps = target.protocol === 'https:';
  const allHeaders =
    body === undefined ? headers : { ...headers, 'content-length': Buffer.byteLength(body) };

  return new Promise((resolve, reject) => {
    const request = (isHttps ? https : http).request(
      target,
      {
        method,
        headers: allHeaders,
        timeout: timeoutMs,
        ...(isHttps ? { rejectUnauthorized: !insecure } : {}),
      },
      (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_BODY_BYTES) {
            request.destroy(new Error('Response too large'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => {
      const error = new Error(`Timed out after ${timeoutMs} ms`);
      error.code = 'ETIMEDOUT';
      request.destroy(error);
    });
    request.on('error', reject);
    request.end(body);
  });
}
