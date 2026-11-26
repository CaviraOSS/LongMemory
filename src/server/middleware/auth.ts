/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ `/ __ `/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
 *
 *  cavira oss (c) 2026  -  nullure (c) 2026
 *  ----------------------------------------------------------
 *  file  : src/server/middleware/auth.ts
 *  usage : resolves the request identity from a bearer token or the legacy API key
 */


import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { catalog_identity, space_catalog } from '../../control/space_catalog.js';
import type { server_config } from '../config.js';
import { api_error } from './errors.js';

const equal = (left: string, right: string) => {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
};

const bearer = (request: IncomingMessage): string | undefined =>
    request.headers.authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

const header_value = (request: IncomingMessage, key: string): string | undefined => {
    const value = request.headers[key];
    return Array.isArray(value) ? value[0] : value;
};

export async function authenticate(request: IncomingMessage, config: server_config, catalog: space_catalog): Promise<catalog_identity> {
    const supplied = bearer(request);
    if (config.control_db_path) {
        if (!supplied) throw new api_error(401, 'unauthorized', 'A bearer token is required');
        const result = catalog.authenticate_token(supplied);
        if (!result.ok) throw new api_error(401, result.code, 'Authentication failed');
        return result.identity;
    }
    if (!config.api_key) return catalog.legacy_identity();
    const candidate = supplied ?? header_value(request, 'x-api-key');
    if (!candidate || !equal(candidate, config.api_key)) throw new api_error(401, 'unauthorized', 'A valid API key is required');
    return catalog.legacy_identity();
}
