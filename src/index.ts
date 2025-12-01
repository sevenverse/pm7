import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { config, validateConfig } from './config.js';
import { registerFigmaTools } from './integrations/figma.js';
import { registerJiraTools } from './integrations/jira.js';
import { registerGitLabTools } from './integrations/gitlab.js';
import { registerWebCrawler } from './integrations/web-crawler.js';

async function main() {
    // Validate configuration on startup
    validateConfig();

    // Create MCP Server
    const server = new McpServer({
        name: 'pm7-mcp-server',
        version: '1.0.0',
    });

    // Register tools from integrations
    registerFigmaTools(server);
    registerJiraTools(server);
    registerGitLabTools(server);
    registerWebCrawler(server);

    // Check for stdio flag
    const isStdio = process.argv.includes('--stdio');

    if (isStdio) {
        const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js');
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error('PM7 MCP Server running on stdio');
    } else {
        // Set up Express server with Streamable HTTP transport
        const app = express();
        app.use(express.json());

        app.post('/mcp', async (req, res) => {
            const transport = new StreamableHTTPServerTransport({
                sessionIdGenerator: undefined,
                enableJsonResponse: true
            });

            res.on('close', () => {
                transport.close();
            });

            await server.connect(transport);
            await transport.handleRequest(req, res, req.body);
        });

        const PORT = config.PORT;
        app.listen(PORT, () => {
            console.log(`PM7 MCP Server running on http://localhost:${PORT}`);
            console.log(`MCP Endpoint: http://localhost:${PORT}/mcp`);
        });
    }
}

main().catch((error) => {
    console.error('Server error:', error);
    process.exit(1);
});
