/**
 * ACP Event Mapper
 * 
 * Maps between ACP protocol events and Gateway events.
 */

export interface GatewayAttachment {
  type: string;
  mimeType: string;
  content: string;
}

const TOOL_LOCATION_PATH_KEYS = [
  "path",
  "filePath",
  "file_path",
  "targetPath",
  "target_path",
  "targetFile",
  "target_file",
  "sourcePath",
  "source_path",
  "destinationPath",
  "destination_path",
  "oldPath",
  "old_path",
  "newPath",
  "new_path",
  "outputPath",
  "output_path",
  "inputPath",
  "input_path",
] as const;

const TOOL_LOCATION_LINE_KEYS = ["line", "lineNumber", "line_number", "startLine", "start_line"] as const;

interface ToolCallLocation {
  path?: string;
  line?: number;
}

/**
 * Extract text content from a PromptRequest
 */
export function extractTextFromPrompt(req: { text?: string; attachments?: GatewayAttachment[] }): string {
  return req.text || "";
}

/**
 * Extract attachments from a PromptRequest
 */
export function extractAttachmentsFromPrompt(
  req: { text?: string; attachments?: GatewayAttachment[] }
): Array<{ mediaType: string; data: string }> {
  if (!req.attachments) {
    return [];
  }
  
  return req.attachments
    .filter((a) => a.type === "attachment")
    .map((a) => ({
      mediaType: a.mimeType,
      data: a.content,
    }));
}

/**
 * Extract tool call content from a tool call event
 */
export function extractToolCallContent(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    return {};
  }
  return input as Record<string, unknown>;
}

/**
 * Extract tool call locations from input
 */
export function extractToolCallLocations(input: Record<string, unknown>): ToolCallLocation[] {
  const locations: ToolCallLocation[] = [];
  
  // Try to find path-like keys
  for (const key of TOOL_LOCATION_PATH_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value) {
      locations.push({ path: value });
    }
  }
  
  // Try to find line number keys
  for (const key of TOOL_LOCATION_LINE_KEYS) {
    const value = input[key];
    if (typeof value === "number") {
      const lastLocation = locations[locations.length - 1];
      if (lastLocation) {
        lastLocation.line = value;
      }
    }
  }
  
  return locations;
}

/**
 * Format tool title from tool call
 */
export function formatToolTitle(name: string, input?: Record<string, unknown>): string {
  if (!input) {
    return name;
  }
  
  // Try to extract a meaningful name from input
  const nameKey = input.name || input.fileName || input.file_name || input.target;
  if (typeof nameKey === "string") {
    return `${name} (${nameKey})`;
  }
  
  return name;
}

/**
 * Infer tool kind from tool name
 */
export function inferToolKind(title: string): string {
  const lowerTitle = title.toLowerCase();
  
  if (lowerTitle.includes("read") || lowerTitle.includes("view") || lowerTitle.includes("grep") || lowerTitle.includes("search")) {
    return "read";
  }
  if (lowerTitle.includes("write") || lowerTitle.includes("edit") || lowerTitle.includes("create") || lowerTitle.includes("str_replace")) {
    return "write";
  }
  if (lowerTitle.includes("bash") || lowerTitle.includes("shell") || lowerTitle.includes("cmd") || lowerTitle.includes("run")) {
    return "background";
  }
  if (lowerTitle.includes("web") || lowerTitle.includes("fetch") || lowerTitle.includes("goto")) {
    return "browser";
  }
  
  return "interactive";
}
