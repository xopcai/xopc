import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReadFileTool } from '../filesystem.js';
import { WriteFileTool } from '../write.js';
import { EditFileTool } from '../edit.js';
import { ListDirTool } from '../listdir.js';

// Mock fs module with default export
vi.mock('fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
    lstatSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

// Mock child_process for EditFileTool
vi.mock('child_process', () => ({
  execSync: vi.fn(),
}));

import * as fs from 'fs';
import { execSync } from 'child_process';

describe('ReadFileTool', () => {
  let tool: ReadFileTool;

  beforeEach(() => {
    tool = new ReadFileTool();
    vi.clearAllMocks();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('read_file');
    expect(tool.description).toBe('Read the contents of a file at the given path.');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to read' },
      },
      required: ['path'],
    });
  });

  it('should read file successfully', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('file contents');

    const result = await tool.execute({ path: '/test/file.txt' });

    expect(result).toBe('file contents');
  });

  it('should return error for non-existent file', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await tool.execute({ path: '/nonexistent/file.txt' });

    expect(result).toContain('Error');
    expect(result).toContain('File not found');
  });

  it('should handle read errors', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = await tool.execute({ path: '/test/file.txt' });

    expect(result).toContain('Error');
    expect(result).toContain('Permission denied');
  });
});

describe('WriteFileTool', () => {
  let tool: WriteFileTool;

  beforeEach(() => {
    tool = new WriteFileTool();
    vi.clearAllMocks();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('write_file');
    expect(tool.description).toBe('Write content to a file at the given path.');
  });

  it('should write file successfully', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const result = await tool.execute({
      path: '/test/file.txt',
      content: 'Hello World',
    });

    expect(result).toContain('Successfully wrote');
    expect(result).toContain('11 bytes');
  });

  it('should create parent directories', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    await tool.execute({
      path: '/deep/nested/path/file.txt',
      content: 'content',
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith('/deep/nested/path', { recursive: true });
  });

  it('should handle write errors', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('Disk full');
    });

    const result = await tool.execute({
      path: '/test/file.txt',
      content: 'content',
    });

    expect(result).toContain('Error');
    expect(result).toContain('Disk full');
  });
});

describe('EditFileTool', () => {
  let tool: EditFileTool;

  beforeEach(() => {
    tool = new EditFileTool();
    vi.clearAllMocks();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('edit_file');
    expect(tool.description).toBe('Edit a file by replacing old_text with new_text.');
  });

  it('should replace text successfully', async () => {
    vi.mocked(execSync).mockReturnValue('ok');

    const result = await tool.execute({
      path: '/test/file.txt',
      old_text: 'World',
      new_text: 'Universe',
    });

    expect(result).toContain('Successfully edited');
    expect(execSync).toHaveBeenCalled();
  });

  it('should handle old_text not found', async () => {
    vi.mocked(execSync).mockReturnValue('old_text_not_found');

    const result = await tool.execute({
      path: '/test/file.txt',
      old_text: 'notfound',
      new_text: 'replacement',
    });

    expect(result).toContain('not found');
  });

  it('should handle command errors', async () => {
    vi.mocked(execSync).mockImplementation(() => {
      throw new Error('Command failed');
    });

    const result = await tool.execute({
      path: '/test/file.txt',
      old_text: 'old',
      new_text: 'new',
    });

    expect(result).toContain('Error');
  });
});

describe('ListDirTool', () => {
  let tool: ListDirTool;

  beforeEach(() => {
    tool = new ListDirTool();
    vi.clearAllMocks();
  });

  it('should have correct metadata', () => {
    expect(tool.name).toBe('list_dir');
    expect(tool.description).toBe('List the contents of a directory.');
  });

  it('should list directory contents', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['file1.txt', 'subdir'] as any);
    vi.mocked(fs.lstatSync).mockImplementation((path) => {
      const isDir = String(path).includes('subdir');
      return {
        isDirectory: () => isDir,
      } as any;
    });

    const result = await tool.execute({ path: '/test/dir' });

    expect(result).toContain('file1.txt');
    expect(result).toContain('subdir');
  });

  it('should return error for non-existent directory', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await tool.execute({ path: '/nonexistent' });

    expect(result).toContain('Error');
    expect(result).toContain('not found');
  });

  it('should handle empty directory', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);

    const result = await tool.execute({ path: '/empty' });

    expect(result).toContain('empty');
  });

  it('should handle list errors', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = await tool.execute({ path: '/restricted' });

    expect(result).toContain('Error');
  });
});
