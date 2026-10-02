// test-contract-validation.js
// Automated CI Verification Suite for API Contract Compliance (openapi.yaml vs server.js)

import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runContractValidation() {
  console.log('=== Starting API Contract Validation Suite (OpenAPI 3.0 vs server.js) ===\n');

  const openapiPath = path.join(__dirname, 'contracts', 'openapi', 'openapi.yaml');
  assert.ok(fs.existsSync(openapiPath), 'contracts/openapi/openapi.yaml must exist');

  const openapiContent = fs.readFileSync(openapiPath, 'utf8');
  const openapiDoc = YAML.parse(openapiContent);

  assert.ok(openapiDoc.paths, 'OpenAPI spec must define paths');
  const serverPrefix = openapiDoc.servers?.[0]?.url || '/api/v1';
  console.log(`[CONTRACT] Base server prefix: ${serverPrefix}`);

  const serverJsPath = path.join(__dirname, 'server.js');
  assert.ok(fs.existsSync(serverJsPath), 'server.js must exist');
  const serverCode = fs.readFileSync(serverJsPath, 'utf8');

  // Extract all route registrations from server.js
  const routeRegex = /app\.(get|post|put|delete|patch)\(\s*(\[[^\]]+\]|'[^']+'|\"[^\"]+\")/g;
  let match;
  const registeredRoutes = new Map(); // key: "METHOD PATH", value: array of registered aliases

  while ((match = routeRegex.exec(serverCode)) !== null) {
    const method = match[1].toUpperCase();
    const rawPaths = match[2];
    let paths = [];

    if (rawPaths.startsWith('[')) {
      paths = rawPaths.slice(1, -1).split(',').map(s => s.trim().replace(/^['\"]|['\"]$/g, ''));
    } else {
      paths = [rawPaths.replace(/^['\"]|['\"]$/g, '')];
    }

    for (const p of paths) {
      // Normalize Express :param to OpenAPI {param}
      const normalizedPath = p.replace(/:([a-zA-Z0-9_]+)/g, (_, paramName) => `{${paramName}}`);
      const key = `${method} ${normalizedPath}`;
      if (!registeredRoutes.has(key)) {
        registeredRoutes.set(key, []);
      }
      registeredRoutes.get(key).push(p);
    }
  }

  console.log(`[ROUTER] Discovered ${registeredRoutes.size} distinct HTTP endpoint signatures in server.js`);

  const missingEndpoints = [];
  const validatedEndpoints = [];

  const openapiPaths = Object.keys(openapiDoc.paths);
  let totalContractOperations = 0;

  for (const contractPath of openapiPaths) {
    const pathItem = openapiDoc.paths[contractPath];
    const fullCanonicalPath = `${serverPrefix}${contractPath}`;

    for (const [method, operation] of Object.entries(pathItem)) {
      if (!['get', 'post', 'put', 'delete', 'patch'].includes(method.toLowerCase())) {
        continue;
      }
      totalContractOperations++;
      const httpMethod = method.toUpperCase();
      const endpointKey = `${httpMethod} ${fullCanonicalPath}`;

      if (registeredRoutes.has(endpointKey)) {
        validatedEndpoints.push({
          key: endpointKey,
          operationId: operation.operationId || operation.summary || 'unnamed',
          registeredAs: registeredRoutes.get(endpointKey)
        });
      } else {
        missingEndpoints.push({
          key: endpointKey,
          operationId: operation.operationId || operation.summary || 'unnamed'
        });
      }
    }
  }

  console.log(`\n[VALIDATION REPORT] Total Contract Operations: ${totalContractOperations}`);
  console.log(`[VALIDATION REPORT] Matched in server.js:      ${validatedEndpoints.length}`);
  console.log(`[VALIDATION REPORT] Missing in server.js:      ${missingEndpoints.length}`);

  if (missingEndpoints.length > 0) {
    console.error('\nFAIL: The following OpenAPI operations are defined in openapi.yaml but NOT registered in server.js:');
    for (const missing of missingEndpoints) {
      console.error(`  - [${missing.key}] (${missing.operationId})`);
    }
    process.exit(1);
  }

  console.log('\nSUCCESS: 100% of OpenAPI 3.0 contract operations are implemented and registered in server.js!');
  console.log('=== API CONTRACT VALIDATION PASSED ===');
}

runContractValidation().catch(err => {
  console.error('Fatal error during contract validation:', err);
  process.exit(1);
});
