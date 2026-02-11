---
name: summarize
description: Summarize URLs, files, and YouTube videos.
---

# Summarize Skill

Summarize content from URLs, files, and YouTube videos.

## Usage

### Summarize a URL
Use the `web_fetch` tool to fetch and summarize web pages:
```bash
web_fetch url="https://example.com/article"
```

### Summarize a File
```bash
read_file path="/path/to/file.md"
```

### Summarize a YouTube Video
```bash
web_fetch url="https://yewtu.be/watch?v=VIDEO_ID"
```

## Techniques

### For Long Content
1. Split into chunks (~2000 tokens each)
2. Summarize each chunk
3. Combine summaries

### For Technical Docs
1. Extract code examples
2. Note prerequisites
3. List key concepts/terms

## Example Prompts

**For a URL:**
"Read the URL and summarize: Main topic, Key points (3-5 bullet points), Any actionable items"

**For a file:**
"Analyze this file and provide: File type and purpose, Key functions/classes, Dependencies"
