import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../config.js';
import { ApiClient } from '../utils/api-client.js';

export function registerJiraTools(server: McpServer) {
    const auth = Buffer.from(`${config.JIRA_EMAIL || ''}:${config.JIRA_API_TOKEN || ''}`).toString('base64');
    const client = new ApiClient(`https://${config.JIRA_DOMAIN || 'jira.atlassian.net'}/rest/api/3`, {
        'Authorization': `Basic ${auth}`,
        'Accept': 'application/json',
    });

    const checkCredentials = () => {
        if (!config.JIRA_API_TOKEN || !config.JIRA_DOMAIN || !config.JIRA_EMAIL) {
            return {
                content: [{ type: 'text' as const, text: 'Jira credentials (domain, email, token) not configured.' }],
                isError: true,
            };
        }
        return null;
    };

    server.registerTool(
        'list-jira-projects',
        {
            description: 'List all accessible Jira projects. Use this tool to see what projects are available. After listing, ASK THE USER to select a project by its Key (e.g., "PROJ") so you can use it for subsequent actions like searching issues.',
            inputSchema: {
                limit: z.number().optional().default(50).describe('Maximum number of projects to return'),
            },
        },
        async ({ limit }) => {
            const error = checkCredentials();
            if (error) return error;

            try {
                const data = await client.get<any[]>('/project');
                // Slice to limit and map to useful info
                const projects = data.slice(0, limit).map((p: any) =>
                    `- [${p.key}] ${p.name} (ID: ${p.id})`
                ).join('\n');

                return {
                    content: [{ type: 'text' as const, text: `Found ${data.length} projects (showing top ${limit}):\n${projects}\n\nPlease ask the user to specify which Project Key they would like to work with.` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error listing Jira projects: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'get-jira-issue',
        {
            description: 'Get details of a Jira issue',
            inputSchema: {
                issueKey: z.string().describe('The key of the Jira issue (e.g. PROJ-123)'),
            },
        },
        async ({ issueKey }) => {
            const error = checkCredentials();
            if (error) return error;

            try {
                const data = await client.get<any>(`/issue/${issueKey}`);
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Issue: ${data.key} - ${data.fields.summary}\nStatus: ${data.fields.status.name}\nAssignee: ${data.fields.assignee ? data.fields.assignee.displayName : 'Unassigned'}\nDescription: ${data.fields.description ? JSON.stringify(data.fields.description) : 'No description'}`
                    }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error fetching Jira issue: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'create-jira-issue',
        {
            description: 'Create a new Jira issue',
            inputSchema: {
                projectKey: z.string().describe('The project key (e.g. PROJ)'),
                summary: z.string().describe('Issue summary'),
                description: z.string().describe('Issue description'),
                issuetype: z.string().default('Task').describe('Issue type (Task, Bug, Story, etc.)'),
            },
        },
        async ({ projectKey, summary, description, issuetype }) => {
            const error = checkCredentials();
            if (error) return error;

            try {
                const body = {
                    fields: {
                        project: { key: projectKey },
                        summary: summary,
                        description: {
                            type: 'doc',
                            version: 1,
                            content: [{
                                type: 'paragraph',
                                content: [{ type: 'text', text: description }]
                            }]
                        },
                        issuetype: { name: issuetype },
                    },
                };

                const data = await client.post<any>('/issue', body);
                return {
                    content: [{ type: 'text' as const, text: `Created Jira issue: ${data.key} (ID: ${data.id})` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error creating Jira issue: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'list-project-issues',
        {
            description: 'List issues in a specific Jira project. Use this tool after you have a Project Key (from list-jira-projects) to see the issues within it. This is the preferred tool for exploring a project.',
            inputSchema: {
                projectKey: z.string().describe('The key of the project (e.g. PROJ)'),
                maxResults: z.number().optional().default(50).describe('Maximum number of issues to return'),
            },
        },
        async ({ projectKey, maxResults }) => {
            const error = checkCredentials();
            if (error) return error;

            try {
                // Use JQL to filter by project
                const jql = `project = "${projectKey}" ORDER BY created DESC`;
                const data = await client.get<any>('/search', { jql, maxResults: maxResults.toString() });

                if (data.issues.length === 0) {
                    return {
                        content: [{ type: 'text' as const, text: `No issues found in project ${projectKey}.` }],
                    };
                }

                const issues = data.issues.map((i: any) =>
                    `- [${i.key}] ${i.fields.summary} (Status: ${i.fields.status.name}, Type: ${i.fields.issuetype.name})`
                ).join('\n');

                return {
                    content: [{ type: 'text' as const, text: `Found ${data.total} issues in project ${projectKey} (showing top ${data.issues.length}):\n${issues}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error listing issues for project ${projectKey}: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'search-jira-issues',
        {
            description: 'Advanced search for Jira issues using JQL (Jira Query Language). Use this ONLY if you need complex filtering (e.g. by assignee, priority, or multiple criteria) that list-project-issues cannot handle. For JQL documentation and examples, refer to: https://support.atlassian.com/jira-software-cloud/docs/use-advanced-search-with-jira-query-language-jql/',
            inputSchema: {
                jql: z.string().describe('JQL search query (e.g. "project = TEST AND assignee = currentUser()")'),
                maxResults: z.number().optional().default(10),
            },
        },
        async ({ jql, maxResults }) => {
            const error = checkCredentials();
            if (error) return error;

            try {
                const data = await client.get<any>('/search', { jql, maxResults: maxResults.toString() });
                const issues = data.issues.map((i: any) =>
                    `- ${i.key}: ${i.fields.summary} (${i.fields.status.name})`
                ).join('\n');

                return {
                    content: [{ type: 'text' as const, text: `Found ${data.total} issues (showing ${data.issues.length}):\n${issues}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error searching Jira issues: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
    server.registerTool(
        'get-jira-api',
        {
            description: 'Execute a custom GET request to the Jira API. Use this tool if you need to perform an action or retrieve data that is not covered by the other specific tools. Refer to the official Jira API documentation to construct the path and parameters: https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/',
            inputSchema: {
                path: z.string().describe('The API endpoint path (e.g., "/myself", "/project/{projectIdOrKey}/components"). Do not include the base URL.'),
                queryParams: z.record(z.string()).optional().describe('Optional query parameters as key-value pairs.'),
            },
        },
        async ({ path, queryParams }) => {
            const error = checkCredentials();
            if (error) return error;

            try {
                // Ensure path starts with /
                const cleanPath = path.startsWith('/') ? path : `/${path}`;
                const data = await client.get<any>(cleanPath, queryParams);

                return {
                    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error executing Jira API request: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
}
