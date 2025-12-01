import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../config.js';
import { ApiClient } from '../utils/api-client.js';

export function registerFigmaTools(server: McpServer) {
    const client = new ApiClient('https://api.figma.com/v1', {
        'X-Figma-Token': config.FIGMA_ACCESS_TOKEN || '',
    });

    server.registerTool(
        'get-figma-file',
        {
            description: 'Get details of a Figma file',
            inputSchema: {
                fileKey: z.string().describe('The key of the Figma file'),
            },
        },
        async ({ fileKey }) => {
            if (!config.FIGMA_ACCESS_TOKEN) {
                return {
                    content: [{ type: 'text' as const, text: 'Figma access token not configured.' }],
                    isError: true,
                };
            }
            try {
                const data = await client.get<any>(`/files/${fileKey}`);
                return {
                    content: [{
                        type: 'text' as const,
                        text: `File: ${data.name}\nLast Modified: ${data.lastModified}\nThumbnail: ${data.thumbnailUrl}`
                    }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error fetching Figma file: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'list-figma-projects',
        {
            description: 'List projects in a Figma team',
            inputSchema: {
                teamId: z.string().describe('The ID of the Figma team').optional(),
            },
        },
        async ({ teamId }) => {
            if (!config.FIGMA_ACCESS_TOKEN) {
                return {
                    content: [{ type: 'text' as const, text: 'Figma access token not configured.' }],
                    isError: true,
                };
            }
            const id = teamId || config.FIGMA_TEAM_ID;
            if (!id) {
                return {
                    content: [{ type: 'text' as const, text: 'Team ID is required either as argument or in configuration.' }],
                    isError: true,
                };
            }

            try {
                const data = await client.get<any>(`/teams/${id}/projects`);
                const projects = data.projects.map((p: any) => `- ${p.name} (ID: ${p.id})`).join('\n');
                return {
                    content: [{ type: 'text' as const, text: `Projects in Team ${data.name}:\n${projects}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error fetching Figma projects: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'get-figma-comments',
        {
            description: 'Get comments from a Figma file',
            inputSchema: {
                fileKey: z.string().describe('The key of the Figma file'),
            },
        },
        async ({ fileKey }) => {
            if (!config.FIGMA_ACCESS_TOKEN) {
                return {
                    content: [{ type: 'text' as const, text: 'Figma access token not configured.' }],
                    isError: true,
                };
            }
            try {
                const data = await client.get<any>(`/files/${fileKey}/comments`);
                const comments = data.comments.map((c: any) =>
                    `- ${c.user.handle}: ${c.message} (at ${c.created_at})`
                ).join('\n');

                return {
                    content: [{ type: 'text' as const, text: `Comments on file ${fileKey}:\n${comments}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error fetching Figma comments: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
}
