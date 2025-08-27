# Memory MCP Server

A Model Context Protocol (MCP) server that provides memory management capabilities for LLM agents like GitHub Copilot and Cline. This server allows you to store, retrieve, modify, and delete memories across chat sessions.

## Features

- **reflect**: Store new memories with content, tags, context, importance levels, and types
- **recall**: Search and retrieve memories using flexible filtering options
- **modify**: Update existing memories by their unique ID
- **erase**: Delete individual memories or perform bulk deletions with confirmation

## Memory Structure

Each memory contains:
- **id**: Unique identifier (UUID)
- **content**: Main memory content (required)
- **tags**: Array of categorization tags
- **context**: Additional contextual information
- **timestamp**: Creation/modification timestamp
- **session_id**: Optional session grouping identifier
- **importance**: Level (low, medium, high)
- **type**: Category (conversation, decision, preference, fact, other)

## Installation

The server has been automatically configured in your Cline MCP settings. Memories are stored in `memories.json` in the project directory.

## Usage Examples

### Store a Memory (reflect)
```json
{
  "content": "User prefers TypeScript over JavaScript for new projects",
  "tags": ["preference", "programming"],
  "context": "Discussing project setup choices",
  "importance": "high",
  "type": "preference"
}
```

### Search Memories (recall)
```json
{
  "query": "TypeScript",
  "tags": ["programming"],
  "importance": "high",
  "limit": 5
}
```

### Update a Memory (modify)
```json
{
  "id": "memory-uuid-here",
  "content": "Updated memory content",
  "importance": "medium"
}
```

### Delete Memories (erase)
```json
{
  "id": "memory-uuid-here"
}
```

## Development

- **Build**: `npm run build`
- **Start**: `npm start`
- **Dev**: `npm run dev`

## Files

- `src/index.ts`: Main server implementation
- `build/index.js`: Compiled server executable
- `memories.json`: Memory storage file (created automatically)
- `package.json`: Project configuration
- `tsconfig.json`: TypeScript configuration

The server integrates seamlessly with Cline and other MCP-compatible LLM agents to provide persistent memory capabilities across chat sessions.
