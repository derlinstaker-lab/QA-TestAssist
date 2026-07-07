/**
 * data/mockCollection.js — Simulated Postman collection requests
 *
 * In a real integration this would be replaced by live Postman API
 * results returned from your backend or Newman CLI output.
 */

/**
 * @typedef {{
 *   name       : string,
 *   method     : 'GET'|'POST'|'PUT'|'DELETE'|'PATCH',
 *   status     : number,
 *   ms         : number,
 *   pass       : boolean,
 *   assertions : string[]
 * }} MockRequest
 */

/** @type {MockRequest[]} */
export const MOCK_COLLECTION = [
  {
    name: 'GET /health', method: 'GET', status: 200, ms: 112, pass: true,
    assertions: ['Status code is 200', 'Response time < 500ms'],
  },
  {
    name: 'POST /auth/login', method: 'POST', status: 200, ms: 287, pass: true,
    assertions: ['Status code is 200', 'Token exists in response', 'Token is non-empty string'],
  },
  {
    name: 'GET /users/me', method: 'GET', status: 200, ms: 94, pass: true,
    assertions: ['Status code is 200', 'userId matches expected value'],
  },
  {
    name: 'POST /products/search', method: 'POST', status: 200, ms: 341, pass: true,
    assertions: ['Status code is 200', 'Results array not empty'],
  },
  {
    name: 'GET /cart', method: 'GET', status: 401, ms: 56, pass: false,
    assertions: ['Status code is 200 — FAILED (got 401)', 'Cart items present — FAILED'],
  },
  {
    name: 'POST /orders', method: 'POST', status: 201, ms: 512, pass: true,
    assertions: ['Status code is 201', 'orderId returned', 'Order status is pending'],
  },
  {
    name: 'GET /orders/:id', method: 'GET', status: 200, ms: 133, pass: true,
    assertions: ['Status code is 200', 'Order data schema valid'],
  },
  {
    name: 'PUT /users/me/profile', method: 'PUT', status: 200, ms: 208, pass: true,
    assertions: ['Status code is 200', 'Profile updated successfully'],
  },
  {
    name: 'DELETE /sessions/current', method: 'DELETE', status: 500, ms: 1204, pass: false,
    assertions: ['Status code is 204 — FAILED (got 500)', 'No body on success — FAILED'],
  },
  {
    name: 'GET /products/:id', method: 'GET', status: 200, ms: 78, pass: true,
    assertions: ['Status code is 200', 'Product schema matches spec'],
  },
];
