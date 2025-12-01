
import { ApiClient } from '../utils/api-client.js';
import { config } from '../config.js';
import { DocumentProcessor } from './document-processor.js';
import { searchEngine } from './search-engine.js';
import { resourceManager, ResourceManager } from './resource-manager.js';

export class GitLabCrawler {
    private client: ApiClient;

    constructor(client: ApiClient) {
        this.client = client;
    }

    /**
     * Crawls a GitLab project, processes files, and indexes them.
     */
    /**
     * Crawls a GitLab project, processes files, and indexes them.
     */
    async crawlProject(projectId: string, metadataOnly: boolean = false) {
        console.error(`Starting crawl for project ${projectId}...`);

        try {
            // 0. Get project details to find default branch
            const project = await this.client.get<any>(`/projects/${encodeURIComponent(projectId)}`);
            const defaultBranch = project.default_branch || 'main';
            console.error(`Using default branch: ${defaultBranch}`);

            // 1. Get the recursive file tree
            const tree = await this.getRecursiveTree(projectId, defaultBranch);
            console.error(`Found ${tree.length} files in project ${projectId}`);

            const chunks = [];
            let processedCount = 0;

            // 2. Iterate and fetch content for supported files
            for (const file of tree) {
                const uri = ResourceManager.getUri(project.path_with_namespace, file.path);
                const webUrl = `${config.GITLAB_URL}/${project.path_with_namespace}/-/blob/${defaultBranch}/${file.path}`;
                const folderUrl = `${config.GITLAB_URL}/${project.path_with_namespace}/-/tree/${defaultBranch}/${file.path}`;

                if (file.type === 'tree') { // Folder
                    // Register folder resource as YAML
                    const folderYaml = {
                        name: file.name,
                        isFolder: true,
                        url: folderUrl,
                        folders: [], // Populated later or on-demand? The schema implies nested structure. 
                        // But here we are registering individual resources. 
                        // The crawl output will have the full structure.
                        // For the resource itself, maybe just basic info + instruction?
                        instructionToLLM: `The folder contents should be retrieved using the tool - get-gitlab-folder and folderUrl`
                    };

                    resourceManager.registerResource({
                        uri,
                        name: file.name,
                        isFolder: true,
                        mimeType: 'application/x-yaml',
                        text: JSON.stringify(folderYaml), // Store as stringified JSON/YAML for now, or just object? ResourceManager expects string text.
                        webUrl: folderUrl,
                        projectPath: project.path_with_namespace,
                        instructionToLLM: `The folder contents should be retrieved using the tool - get-gitlab-folder and folderUrl.`
                    });
                } else { // File
                    const shouldProcess = this.shouldProcessFile(file.path);
                    let content = '';
                    let yamlContent: any = undefined;

                    // EXCEPTION: Always fetch README files
                    const isReadme = file.name.toLowerCase() === 'readme.md';

                    if (isReadme) {
                        try {
                            content = await this.fetchFileContent(projectId, file.path, defaultBranch);
                            yamlContent = {
                                format: 'markdown',
                                text: content
                            };
                        } catch (err: any) {
                            console.error(`Failed to fetch README ${file.path}: ${err.message}`);
                        }
                    } else if (shouldProcess && !metadataOnly) {
                        // Indexing logic remains for search engine, but resource registration changes
                        try {
                            content = await this.fetchFileContent(projectId, file.path, defaultBranch);
                            // Index for search
                            const fileChunks = DocumentProcessor.chunkDocument(project.path_with_namespace, file.path, content);
                            chunks.push(...fileChunks);
                            processedCount++;
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (err: any) {
                            console.error(`Failed to process file ${file.path}: ${err.message}`);
                        }
                    }

                    // Register file resource as YAML
                    const fileYaml = {
                        Name: file.name,
                        isFolder: false,
                        Url: webUrl,
                        instructionToLLM: `The file content should be retrieved using the tool - get-gitlab-file and the fileUrl: ${webUrl}`,
                        ...(yamlContent ? { content: yamlContent } : {})
                    };

                    resourceManager.registerResource({
                        uri,
                        name: file.name,
                        isFolder: false,
                        mimeType: 'application/x-yaml',
                        text: JSON.stringify(fileYaml), // Store as stringified JSON/YAML
                        webUrl: webUrl,
                        projectPath: project.path_with_namespace
                    });
                }
            }

            // 3. Index the chunks
            searchEngine.indexProject(project.path_with_namespace, chunks);
            console.error(`Crawl complete. Indexed ${chunks.length} chunks from ${processedCount} files.`);

            return {
                filesProcessed: processedCount,
                chunksIndexed: chunks.length,
                resourcesRegistered: resourceManager.getAllResources().length,
                project: {
                    name: project.name,
                    id: String(project.id),
                    url: project.web_url,
                    path_with_namespace: project.path_with_namespace
                }
            };

        } catch (error: any) {
            console.error(`Crawl failed for project ${projectId}: ${error.message}`);
            throw error;
        }
    }

    private async getRecursiveTree(projectId: string, ref: string): Promise<any[]> {
        let allFiles: any[] = [];
        let page = 1;
        const perPage = 100;

        while (true) {
            const files = await this.client.get<any[]>(`/projects/${encodeURIComponent(projectId)}/repository/tree`, {
                recursive: 'true',
                per_page: String(perPage),
                page: String(page),
                ref
            });

            if (files.length === 0) {
                break;
            }

            allFiles = allFiles.concat(files);
            page++;

            // Safety break for extremely large repos to avoid infinite loops if API behaves unexpectedly
            if (page > 100) {
                console.warn('Reached 100 pages limit for tree fetching. Stopping.');
                break;
            }
        }

        return allFiles;
    }

    private async fetchFileContent(projectId: string, filePath: string, ref: string): Promise<string> {
        // Get raw file content
        return await this.client.getText(`/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(filePath)}/raw`, {
            ref
        });
    }

    async crawlAllProjects(metadataOnly: boolean = false) {
        console.error('Starting crawl for all accessible projects...');
        let allResults = {
            filesProcessed: 0,
            chunksIndexed: 0,
            resourcesRegistered: 0,
            projectsCrawled: 0,
            projects: [] as any[]
        };

        try {
            // Fetch all projects the user has access to
            // Using membership=true to get projects the user is a member of
            const projects = await this.client.get<any[]>('/projects', {
                membership: 'true',
                simple: 'true', // Minimal details
                per_page: '100'
            });

            console.error(`Found ${projects.length} projects.`);

            for (const project of projects) {
                try {
                    const result = await this.crawlProject(String(project.id), metadataOnly);
                    allResults.filesProcessed += result.filesProcessed;
                    allResults.chunksIndexed += result.chunksIndexed;
                    allResults.projectsCrawled++;
                    allResults.projects.push(result.project);
                } catch (err: any) {
                    console.error(`Failed to crawl project ${project.path_with_namespace}: ${err.message}`);
                }
            }

            allResults.resourcesRegistered = resourceManager.getAllResources().length;
            return allResults;

        } catch (error: any) {
            console.error(`Failed to fetch projects: ${error.message}`);
            throw error;
        }
    }

    private shouldProcessFile(filePath: string): boolean {
        const excludedDirs = ['node_modules', 'dist', 'build', '.git', 'coverage'];
        // Only process markdown files for content indexing
        const supportedExtensions = ['.md', '.markdown'];

        // Check exclusions
        if (excludedDirs.some(dir => filePath.includes(`${dir}/`))) return false;

        // Check extension
        const ext = filePath.substring(filePath.lastIndexOf('.')).toLowerCase();
        return supportedExtensions.includes(ext);
    }
}
