// MCP bridge — JWT Debugger tool (`jwt`). Pure functions of their arguments,
// no persisted state, so — like codecMcpBridge.ts — this is mounted
// unconditionally at the app root (McpUtilityBridge.tsx), gated only by the
// per-tool MCP toggle.
//
// `jwt_decode` stays decode-only; `jwt_sign` and `jwt_verify` take the key in
// the call, and run the exact same code the UI does (jwt/jwtCrypto.ts) so an
// agent and a human get the same answer for the same token — including the
// refusal to read the algorithm off the token's own header.

import {
  decodeToken, inspectClaims, isJwtAlgorithm, signToken, verifyToken,
  type JwtAlgorithm, type SecretEncoding,
} from './jwt/jwtCrypto';

type ToolHandler = (args: Record<string, unknown>) => Promise<unknown>;

function requireString(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`"${name}" is required and must be a string`);
  return v;
}

function requireAlgorithm(v: unknown): JwtAlgorithm {
  const alg = requireString(v, 'algorithm');
  if (!isJwtAlgorithm(alg)) throw new Error(`Unknown algorithm "${alg}"`);
  return alg;
}

function optionalString(v: unknown, name: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new Error(`"${name}" must be a string`);
  return v;
}

export function buildJwtHandlers(): Record<string, ToolHandler> {
  return {
    jwt_decode: async (args) => {
      const token = requireString(args.token, 'token');
      try {
        const { header, payload } = decodeToken(token);
        const claims = inspectClaims(payload);
        // `expired` is the question most decode calls are really asking, and
        // an agent shouldn't have to do epoch arithmetic to answer it.
        return { header, payload, expired: claims.expired, notYetValid: claims.notYetValid };
      } catch (e) {
        throw new Error((e as Error).message || 'Invalid JWT token');
      }
    },

    jwt_sign: async (args) => {
      const algorithm = requireAlgorithm(args.algorithm);
      const payload = args.payload;
      if (typeof payload !== 'string' && (typeof payload !== 'object' || payload === null || Array.isArray(payload))) {
        throw new Error('"payload" is required and must be a JSON object (or a JSON string)');
      }
      const key = optionalString(args.key, 'key');
      if (algorithm !== 'none' && !key) throw new Error(`"key" is required for ${algorithm}`);

      return {
        token: await signToken({
          algorithm,
          payload: payload as string | Record<string, unknown>,
          expiresIn: optionalString(args.expiresIn, 'expiresIn'),
          notBefore: optionalString(args.notBefore, 'notBefore'),
          issuedAt: args.issuedAt !== false,
          header: optionalString(args.kid, 'kid') ? { kid: args.kid } : undefined,
          key: key ? { material: key, encoding: (optionalString(args.keyEncoding, 'keyEncoding') ?? 'utf8') as SecretEncoding } : undefined,
        }),
      };
    },

    jwt_verify: async (args) => {
      const token = requireString(args.token, 'token');
      const algorithm = requireAlgorithm(args.algorithm);
      const key = optionalString(args.key, 'key') ?? '';
      const tolerance = args.clockTolerance;
      if (tolerance !== undefined && typeof tolerance !== 'number') throw new Error('"clockTolerance" must be a number of seconds');

      // A failed verification is an ANSWER, not a tool error: the caller asked
      // whether the signature holds, and "no, because it expired" is the
      // result. Only malformed arguments throw.
      const outcome = await verifyToken({
        token,
        algorithm,
        key: { material: key, encoding: (optionalString(args.keyEncoding, 'keyEncoding') ?? 'utf8') as SecretEncoding },
        issuer: optionalString(args.issuer, 'issuer'),
        audience: optionalString(args.audience, 'audience'),
        subject: optionalString(args.subject, 'subject'),
        clockToleranceSec: tolerance,
      });
      return {
        valid: outcome.valid,
        reason: outcome.code ?? null,
        message: outcome.message,
        header: outcome.header ?? null,
        payload: outcome.payload ?? null,
      };
    },
  };
}
