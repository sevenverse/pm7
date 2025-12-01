# PM7 MCP Server

A Model Context Protocol (MCP) server for PM7, designed to streamline product manager workflows by integrating with Figma, Jira, and GitLab.

## Features

This server exposes the following tools to MCP clients (like Claude, Cursor, etc.):

### Figma
- `get-figma-file`: Get details of a Figma file (name, last modified, thumbnail)
- `list-figma-projects`: List projects in a Figma team
- `get-figma-comments`: Get comments from a Figma file

### Jira
- `get-jira-issue`: Get details of a Jira issue
- `create-jira-issue`: Create a new Jira issue
- `search-jira-issues`: Search for Jira issues using JQL

### GitLab
- `get-gitlab-project`: Get details of a GitLab project
- `list-gitlab-issues`: List issues in a GitLab project
- `list-gitlab-merge-requests`: List merge requests in a GitLab project

## Setup

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Configure Environment**
   Copy `.env.example` to `.env` and fill in your credentials:
   ```bash
   cp .env.example .env
   ```

   **Required Credentials:**
   - **Figma:** Access Token (Personal Access Token)
   - **Jira:** API Token, Email, Domain
   - **GitLab:** Access Token (Personal Access Token)

3. **Build and Run**
   ```bash
   npm run build
   npm start
   ```

   Or for development with auto-reload:
   ```bash
   npm run dev
   ```

## Usage with MCP Clients

### Claude Desktop / MCP Inspector
You can use the [MCP Inspector](https://github.com/modelcontextprotocol/inspector) to test the server:

```bash
npx @modelcontextprotocol/inspector
```
Connect to: `http://localhost:3000/mcp`

### VS Code (Claude Dev)
Add to your MCP settings:
```json
{
  "mcpServers": {
    "pm7": {
      "command": "node",
      "args": ["/path/to/pm7-mcp-server/dist/index.js"],
      "env": {
        "PORT": "3000"
      }
    }
  }
}
```
*Note: Since this server uses HTTP transport, you might need to run it separately and connect via HTTP if the client supports it, or use the stdio transport adapter if needed.*

## API Documentation

The server runs on port 3000 by default.
- **MCP Endpoint:** `http://localhost:3000/mcp` (POST)
