import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { config } from '../config.js';
import { ApiClient } from '../utils/api-client.js';
import { GitLabCrawler } from '../services/gitlab-crawler.js';
import { searchEngine } from '../services/search-engine.js';
import { resourceManager, ResourceManager } from '../services/resource-manager.js';
import * as jsYaml from 'js-yaml';

function parseGitLabInput(input: string): string {
    try {
        // Check if input is a URL
        if (input.startsWith('http://') || input.startsWith('https://')) {
            const url = new URL(input);
            // Remove leading slash and .git extension if present
            let path = url.pathname.replace(/^\//, '').replace(/\.git$/, '');

            // If URL contains /blob/ or /tree/, strip everything after it to get project path
            // e.g. gitlab.com/group/project/blob/main/README.md -> group/project
            const blobIndex = path.indexOf('/blob/');
            if (blobIndex !== -1) path = path.substring(0, blobIndex);

            const treeIndex = path.indexOf('/tree/');
            if (treeIndex !== -1) path = path.substring(0, treeIndex);

            return path;
        }
        // Assume it's already a project ID/path
        return input;
    } catch (e) {
        return input;
    }
}

export function registerGitLabTools(server: McpServer) {
    const client = new ApiClient(`${config.GITLAB_URL}/api/v4`, {
        'PRIVATE-TOKEN': config.GITLAB_ACCESS_TOKEN || '',
    });

    server.registerTool(
        'get-gitlab-project',
        {
            description: 'Get details of a GitLab project',
            inputSchema: {
                projectId: z.string().describe('The ID or URL-encoded path of the project, or the full project URL'),
            },
        },
        async ({ projectId }) => {
            if (!config.GITLAB_ACCESS_TOKEN) {
                return {
                    content: [{ type: 'text' as const, text: 'GitLab access token not configured.' }],
                    isError: true,
                };
            }
            const parsedId = parseGitLabInput(projectId);
            try {
                const data = await client.get<any>(`/projects/${encodeURIComponent(parsedId)}`);
                return {
                    content: [{
                        type: 'text' as const,
                        text: `Project: ${data.name_with_namespace}\nID: ${data.id}\nWeb URL: ${data.web_url}\nDescription: ${data.description}`
                    }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error fetching GitLab project: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    // Initialize Crawler
    const crawler = new GitLabCrawler(client);

    server.registerTool(
        'crawl-gitlab',
        {
            description: 'Crawl and index personal and private GitLab projects, files, and folders. If you know the project full URL you can crawl a specific project by providing it as an input parameter. If you omit the input parameter, it will crawl all projects. Use this tool whenever you are initiating a new search session to ensure the search engine has the latest data.',
            inputSchema: {
                project: z.string().optional().describe('The project name, full URL, or ID. If omitted, crawls ALL projects.'),
            },
        },
        async ({ project }) => {
            if (!config.GITLAB_ACCESS_TOKEN) {
                return {
                    content: [{ type: 'text' as const, text: 'GitLab access token not configured.' }],
                    isError: true,
                };
            }

            try {
                // Helper to build YAML for a project
                const buildProjectYaml = (projectData: any, resources: any[]) => {
                    const projectId = projectData.id;
                    const projectRes = resources.filter(r => r.projectPath === projectData.path_with_namespace || r.uri.startsWith(`gitlab://${projectData.path_with_namespace}/`));

                    // Build nested structure
                    const pathMap = new Map<string, any>();

                    // First pass: create objects for all resources
                    for (const r of projectRes) {
                        const relPath = r.uri.replace(`gitlab://${projectData.path_with_namespace}/`, '');
                        // Parse the stored YAML text back to object
                        let obj;
                        try {
                            obj = JSON.parse(r.text || '{}');
                        } catch (e) {
                            obj = {};
                        }
                        pathMap.set(relPath, obj);
                    }

                    // Second pass: nest them
                    const rootContents: any = {};

                    for (const [relPath, obj] of pathMap.entries()) {
                        const parts = relPath.split('/');
                        const name = parts[parts.length - 1];
                        const parentPath = parts.slice(0, -1).join('/');

                        if (parentPath === '') {
                            // Root item
                            rootContents[name] = obj;
                        } else {
                            // Child item
                            const parentObj = pathMap.get(parentPath);
                            if (parentObj) {
                                if (obj.isFolder) {
                                    parentObj.folders = parentObj.folders || [];
                                    parentObj.folders.push(name);
                                } else {
                                    parentObj.files = parentObj.files || [];
                                    parentObj.files.push(name);
                                }
                            }
                        }
                    }

                    return {
                        project: {
                            name: projectData.name,
                            id: projectData.id,
                            url: projectData.url
                        },
                        contents: rootContents
                    };
                };

                if (project) {
                    const parsedId = parseGitLabInput(project);
                    const result = await crawler.crawlProject(parsedId, false);

                    const resources = resourceManager.getAllResources()
                        .filter(r => r.projectPath === parsedId);

                    const yamlObj = buildProjectYaml(result.project, resources);
                    const yamlStr = jsYaml.dump(yamlObj);

                    return {
                        content: [{ type: 'text' as const, text: yamlStr }]
                    };
                } else {
                    // Crawl all
                    const result = await crawler.crawlAllProjects(false);
                    const allRes = resourceManager.getAllResources();

                    const allYaml = result.projects.map((p: any) => buildProjectYaml(p, allRes));

                    let yamlStr;
                    if (allYaml.length === 1) {
                        yamlStr = jsYaml.dump(allYaml[0]);
                    } else {
                        yamlStr = jsYaml.dump(allYaml);
                    }

                    return {
                        content: [{ type: 'text' as const, text: yamlStr }]
                    };
                }
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error crawling GitLab: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'search-gitlab-context',
        {
            description: 'Search for context within crawled GitLab projects. If projectId is provided, results from that project are prioritized.',
            inputSchema: {
                projectId: z.string().optional().describe('The ID or URL-encoded path of the project, or the full project URL. Optional for global search.'),
                query: z.string().describe('The search query'),
                limit: z.number().optional().default(5).describe('Max number of results'),
            },
        },
        async ({ projectId, query, limit }) => {
            const parsedId = projectId ? parseGitLabInput(projectId) : undefined;
            try {
                const results = searchEngine.search(parsedId, query, limit);

                if (results.length === 0) {
                    const scopeMsg = parsedId ? `project ${parsedId}` : 'any project';
                    return {
                        content: [{ type: 'text' as const, text: `No results found for "${query}" in ${scopeMsg}. Make sure to run 'crawl-gitlab' first.` }],
                    };
                }

                const formattedResults = results.map((result, index) => {
                    const chunk = result.chunk;
                    const score = result.score.toFixed(2);

                    // Extract snippet
                    const lines = chunk.content.split('\n');
                    let bestLineIndex = 0;

                    if (result.matchDetails.length > 0) {
                        const firstTerm = result.matchDetails[0].term;
                        const idx = lines.findIndex(l => l.toLowerCase().includes(firstTerm));
                        if (idx !== -1) bestLineIndex = idx;
                    }

                    const start = Math.max(0, bestLineIndex - 1);
                    const end = Math.min(lines.length, bestLineIndex + 3);
                    const snippet = lines.slice(start, end).join('\n');

                    return `[Result ${index + 1}] (Score: ${score})
Project: ${chunk.projectId}
File: ${chunk.filePath} (Lines ${chunk.metadata.startLine}-${chunk.metadata.endLine})
Snippet:
${snippet}
...
`;
                }).join('\n---\n\n');

                return {
                    content: [{ type: 'text' as const, text: `Found ${results.length} matches:\n\n${formattedResults}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error searching GitLab context: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'list-gitlab-issues',
        {
            description: 'List issues in a GitLab project',
            inputSchema: {
                projectId: z.string().describe('The ID or URL-encoded path of the project, or the full project URL'),
                state: z.enum(['opened', 'closed', 'all']).optional().default('opened'),
            },
        },
        async ({ projectId, state }) => {
            if (!config.GITLAB_ACCESS_TOKEN) {
                return {
                    content: [{ type: 'text' as const, text: 'GitLab access token not configured.' }],
                    isError: true,
                };
            }
            const parsedId = parseGitLabInput(projectId);
            try {
                const data = await client.get<any[]>(`/projects/${encodeURIComponent(parsedId)}/issues`, { state });
                const issues = data.map((i: any) =>
                    `- #${i.iid}: ${i.title} (${i.state}) - ${i.web_url}`
                ).join('\n');

                return {
                    content: [{ type: 'text' as const, text: `Issues in project ${parsedId}:\n${issues}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error listing GitLab issues: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'list-gitlab-merge-requests',
        {
            description: 'List merge requests in a GitLab project',
            inputSchema: {
                projectId: z.string().describe('The ID or URL-encoded path of the project, or the full project URL'),
                state: z.enum(['opened', 'closed', 'locked', 'merged', 'all']).optional().default('opened'),
            },
        },
        async ({ projectId, state }) => {
            if (!config.GITLAB_ACCESS_TOKEN) {
                return {
                    content: [{ type: 'text' as const, text: 'GitLab access token not configured.' }],
                    isError: true,
                };
            }
            const parsedId = parseGitLabInput(projectId);
            try {
                const data = await client.get<any[]>(`/projects/${encodeURIComponent(parsedId)}/merge_requests`, { state });
                const mrs = data.map((mr: any) =>
                    `- !${mr.iid}: ${mr.title} (${mr.state}) - ${mr.web_url}`
                ).join('\n');

                return {
                    content: [{ type: 'text' as const, text: `Merge Requests in project ${parsedId}:\n${mrs}` }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error listing GitLab MRs: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );

    server.registerTool(
        'get-gitlab-file',
        {
            description: 'Get the content of a specific file from a GitLab project',
            inputSchema: {
                projectId: z.string().describe('The ID or URL-encoded path of the project, or the full project URL'),
                filePath: z.string().describe('The full path to the file (e.g. src/index.ts) or the full file URL'),
            },
        },
        async ({ projectId, filePath }) => {
            if (!config.GITLAB_ACCESS_TOKEN) {
                return {
                    content: [{ type: 'text' as const, text: 'GitLab access token not configured.' }],
                    isError: true,
                };
            }

            const parsedProjectId = parseGitLabInput(projectId);
            let parsedFilePath = filePath;

            // Handle full file URL in filePath
            if (filePath.startsWith('http')) {
                try {
                    const url = new URL(filePath);
                    // Extract path after /blob/main/ or similar
                    // gitlab.com/group/project/blob/main/src/index.ts
                    const blobIndex = url.pathname.indexOf('/blob/');
                    if (blobIndex !== -1) {
                        // +1 to skip the slash, then find next slash for branch
                        const afterBlob = url.pathname.substring(blobIndex + 6); // "main/src/index.ts"
                        const slashIndex = afterBlob.indexOf('/');
                        if (slashIndex !== -1) {
                            parsedFilePath = afterBlob.substring(slashIndex + 1);
                        }
                    }
                } catch (e) {
                    // Fallback to raw input
                }
            }

            try {
                // Try to get from cache first
                const uri = ResourceManager.getUri(parsedProjectId, parsedFilePath);
                const resource = resourceManager.getResource(uri);

                // If resource is YAML metadata, we might want to check if it has content?
                // But get-gitlab-file is supposed to return content.
                // If the resource is just metadata, we still need to fetch content.
                // The resource.text might be YAML now.

                // Check if resource.text is valid content or YAML metadata
                if (resource && resource.text) {
                    // If it looks like our YAML metadata, ignore it and fetch fresh?
                    // Or check if it has "content" field?
                    try {
                        const meta = JSON.parse(resource.text);
                        if (meta.content && meta.content.text) {
                            return {
                                content: [{ type: 'text' as const, text: meta.content.text }],
                            };
                        }
                    } catch (e) {
                        // Not JSON, so it's probably raw content (legacy or plain text)
                        return {
                            content: [{ type: 'text' as const, text: resource.text }],
                        };
                    }
                }

                // If not in cache or no content in metadata, fetch live
                const project = await client.get<any>(`/projects/${encodeURIComponent(parsedProjectId)}`);
                const defaultBranch = project.default_branch || 'main';

                const content = await client.getText(`/projects/${encodeURIComponent(parsedProjectId)}/repository/files/${encodeURIComponent(parsedFilePath)}/raw`, {
                    ref: defaultBranch
                });

                return {
                    content: [{ type: 'text' as const, text: content }],
                };
            } catch (error: any) {
                return {
                    content: [{ type: 'text' as const, text: `Error fetching file content: ${error.message}` }],
                    isError: true,
                };
            }
        }
    );
    server.registerResource(
        'gitlab-file',
        new ResourceTemplate('gitlab://{projectId}/{+filePath}', {
            list: async () => {
                const resources = resourceManager.getAllResources();
                return {
                    resources: resources.map(r => ({
                        uri: r.uri,
                        name: r.name,
                        mimeType: r.mimeType,
                        title: r.isFolder ? 'GitLab Folder' : 'GitLab File',
                        description: r.webUrl,
                    }))
                };
            }
        }),
        {
            mimeType: 'application/x-yaml',
        },
        async (uri, { projectId, filePath }) => {
            if (!config.GITLAB_ACCESS_TOKEN) {
                throw new Error('GitLab access token not configured.');
            }

            // 1. Try to find in cache first using the full URI
            const uriStr = String(uri);
            const resource = resourceManager.getResource(uriStr);

            if (resource && resource.text) {
                return {
                    contents: [{
                        uri: uriStr,
                        text: resource.text, // This is now the YAML string
                        mimeType: 'application/x-yaml'
                    }],
                };
            }

            throw new Error(`Resource not found: ${uriStr}. Run 'crawl-gitlab' to discover resources.`);
        }
    );
}
