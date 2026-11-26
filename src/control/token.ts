/*
*      __                      __  ___
*     / /   ____  ____  ____ _/  |/  /__  ____ ___  ____  _______  __
*    / /   / __ \/ __ \/ __ `/ /|_/ / _ \/ __ `__ \/ __ \/ ___/ / / /
*   / /___/ /_/ / / / / /_/ / /  / /  __/ / / / / / /_/ / /  / /_/ /
*  /_____/\____/_/ /_/\__, /_/  /_/\___/_/ /_/ /_/\____/_/   \__, /
                     /____/                                 /____/
*
*  cavira oss (c) 2026  -  nullure (c) 2026
*  ----------------------------------------------------------
*  file  : src/control/token.ts
*  usage : creates, parses, and hashes control plane tokens
*/

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
const token_pattern = /^lm_([a-z2-7]{12})_([A-Za-z0-9_-]{43})$/;

const random_id = (): string => {
    let value = '';
    while (value.length < 12) value += alphabet[randomBytes(1)[0] & 31];
    return value;
};

export const hash_secret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

export const create_token_value = () => {
    const id = random_id();
    const secret = randomBytes(32).toString('base64url');
    return { id, token: `lm_${id}_${secret}`, secret_hash: hash_secret(secret) };
};

export const parse_token = (value: string): { id: string; secret: string } | null => {
    const match = value.match(token_pattern);
    return match ? { id: match[1], secret: match[2] } : null;
};

export const secret_matches = (secret: string, stored_hash: string): boolean => {
    const candidate = Buffer.from(hash_secret(secret));
    const stored = Buffer.from(stored_hash);
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
};
