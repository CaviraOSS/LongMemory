const is_record = (value: unknown): value is Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

export type kilo_mcp_local = { type: 'local'; command: string[]; enabled: boolean };

export const longmemory_mcp_server = (): kilo_mcp_local => ({
    type: 'local',
    command: ['longmemory', 'mcp', '--project', 'current'],
    enabled: true,
});

export function ensure_longmemory_mcp(config: unknown): boolean {
    if (!is_record(config)) return false;
    if (config.mcp === undefined) config.mcp = {};
    const mcp = config.mcp;
    if (!is_record(mcp)) return false;
    if (Object.hasOwn(mcp, 'longmemory')) return false;
    mcp.longmemory = longmemory_mcp_server();
    return true;
}
