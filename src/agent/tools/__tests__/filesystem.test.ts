import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ReadFileTool, WriteFileTool, EditFileTool, ListDirTool } from '../filesystem.js';
import fs from 'fs';

// Mock fs module
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  statSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

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

    expect(fs.readFileSync).toHaveBeenCalledWith('/test/file.txt', 'utf-8');
    expect(result).toBe('file contents');
  });

  it('should return error for non-existent file', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await tool.execute({ path: '/nonexistent/file.txt' });

    expect(result).toContain('Error');
    expect(result).toContain('File not found');
    expect(fs.readFileSync).not.toHaveBeenCalled();
  });

  it('should handle read errors', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = await tool.execute({ path: '/test/file.txt' });

    expect(result).toContain('Error reading file');
    expect(result).toContain('Permission denied');
  });

  it('should convert path to string', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('content');

    await tool.execute({ path: 123 as any });

    expect(fs.readFileSync).toHaveBeenCalledWith('123', 'utf-8');
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
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to write' },
        content: { type: 'string', description: 'The content to write' },
      },
      required: ['path', 'content'],
    });
  });

  it('should write file successfully', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const result = await tool.execute({
      path: '/test/file.txt',
      content: 'Hello World',
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith('/test', { recursive: true });
    expect(fs.writeFileSync).toHaveBeenCalledWith('/test/file.txt', 'Hello World', 'utf-8');
    expect(result).toContain('successfully');
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

  it('should handle nested directory creation from relative path', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    await tool.execute({
      path: './relative/path/file.txt',
      content: 'content',
    });

    expect(fs.mkdirSync).toHaveBeenCalledWith('./relative/path', { recursive: true });
  });

  it('should handle file in current directory', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    await tool.execute({
      path: 'file.txt',
      content: 'content',
    });

    // No directory to create for current dir
    expect(fs.mkdirSync).toHaveBeenCalledWith('.', { recursive: true });
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

  it('should convert parameters to strings', async () => {
    vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    await tool.execute({
      path: 123 as any,
      content: 456 as any,
    });

    expect(fs.writeFileSync).toHaveBeenCalledWith('123', '456', 'utf-8');
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
    expect(tool.description).toBe('Edit a file by replacing old text with new text.');
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The file path to edit' },
        oldText: { type: 'string', description: 'The text to replace' },
        newText: { type: 'string', description: 'The replacement text' },
      },
      required: ['path', 'oldText', 'newText'],
    });
  });

  it('should replace text successfully', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('Hello World');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    const result = await tool.execute({
      path: '/test/file.txt',
      oldText: 'World',
      newText: 'Universe',
    });

    expect(fs.writeFileSync).toHaveBeenCalledWith('/test/file.txt', 'Hello Universe', 'utf-8');
    expect(result).toContain('successfully');
  });

  it('should replace all occurrences', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('foo bar foo baz foo');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    await tool.execute({
      path: '/test/file.txt',
      oldText: 'foo',
      newText: 'qux',
    });

    expect(fs.writeFileSync).toHaveBeenCalledWith('/test/file.txt', 'qux bar qux baz qux', 'utf-8');
  });

  it('should return error for non-existent file', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await tool.execute({
      path: '/nonexistent/file.txt',
      oldText: 'old',
      newText: 'new',
    });

    expect(result).toContain('Error');
    expect(result).toContain('File not found');
  });

  it('should return error when oldText not found', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('Hello World');

    const result = await tool.execute({
      path: '/test/file.txt',
      oldText: 'not-in-file',
      newText: 'replacement',
    });

    expect(result).toContain('not found in file');
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('should handle multiline text replacement', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('line1\nline2\nline3');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    await tool.execute({
      path: '/test/file.txt',
      oldText: 'line2',
      newText: 'newLine2',
    });

    expect(fs.writeFileSync).toHaveBeenCalledWith('/test/file.txt', 'line1\nnewLine2\nline3', 'utf-8');
  });

  it('should handle special regex characters safely', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('price: $100.00');
    vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

    await tool.execute({
      path: '/test/file.txt',
      oldText: '$100.00',
      newText: '$200.00',
    });

    expect(fs.writeFileSync).toHaveBeenCalledWith('/test/file.txt', 'price: $200.00', 'utf-8');
  });

  it('should handle read errors', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockImplementation(() => {
      throw new Error('Permission denied');
    });

    const result = await tool.execute({
      path: '/test/file.txt',
      oldText: 'old',
      newText: 'new',
    });

    expect(result).toContain('Error');
    expect(result).toContain('Permission denied');
  });

  it('should handle write errors', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readFileSync).mockReturnValue('content');
    vi.mocked(fs.writeFileSync).mockImplementation(() => {
      throw new Error('Disk full');
    });

    const result = await tool.execute({
      path: '/test/file.txt',
      oldText: 'content',
      newText: 'replaced',
    });

    expect(result).toContain('Error');
    expect(result).toContain('Disk full');
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
    expect(tool.parameters).toEqual({
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The directory path to list' },
      },
      required: ['path'],
    });
  });

  it('should list directory contents', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['file1.txt', 'file2.js', 'subdir'] as any);
    vi.mocked(fs.statSync).mockImplementation((path) => {
      const isDir = String(path).endsWith('subdir');
      return {
        isDirectory: () => isDir,
        isFile: () => !isDir,
        size: isDir ? 0 : 1024,
        mtime: new Date('2024-01-01'),
      } as any;
    });

    const result = await tool.execute({ path: '/test/dir' });

    expect(result).toContain('file1.txt');
    expect(result).toContain('file2.js');
    expect(result).toContain('subdir');
    expect(result).toContain('[DIR]');
  });

  it('should return error for non-existent directory', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(false);

    const result = await tool.execute({ path: '/nonexistent' });

    expect(result).toContain('Error');
    expect(result).toContain('Directory not found');
  });

  it('should handle path that is a file not directory', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      const error = new Error('ENOTDIR: not a directory');
      (error as any).code = 'ENOTDIR';
      throw error;
    });

    const result = await tool.execute({ path: '/test/file.txt' });

    expect(result).toContain('not a directory');
  });

  it('should handle permission errors', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockImplementation(() => {
      const error = new Error('EACCES: permission denied');
      (error as any).code = 'EACCES';
      throw error;
    });

    const result = await tool.execute({ path: '/restricted' });

    expect(result).toContain('Error');
    expect(result).toContain('permission denied');
  });

  it('should format file sizes', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['small.txt', 'large.bin'] as any);
    vi.mocked(fs.statSync).mockImplementation((path) => {
      const isLarge = String(path).includes('large');
      return {
        isDirectory: () => false,
        isFile: () => true,
        size: isLarge ? 1024 * 1024 : 100, // 1MB vs 100 bytes
        mtime: new Date('2024-01-01'),
      } as any;
    });

    const result = await tool.execute({ path: '/test' });

    expect(result).toContain('100B');
    expect(result).toContain('1.00MB');
  });

  it('should format dates', async () => {
    const testDate = new Date('2024-06-15T10:30:00');
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['file.txt'] as any);
    vi.mocked(fs.statSync).mockReturnValue({
      isDirectory: () => false,
      isFile: () => true,
      size: 100,
      mtime: testDate,
    } as any);

    const result = await tool.execute({ path: '/test' });

    expect(result).toContain('2024-06-15');
  });

  it('should handle empty directory', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue([] as any);

    const result = await tool.execute({ path: '/empty' });

    expect(result).toContain('Empty directory');
  });

  it('should sort entries by type then name', async () => {
    vi.mocked(fs.existsSync).mockReturnValue(true);
    vi.mocked(fs.readdirSync).mockReturnValue(['zebra.txt', 'subdir', 'alpha.js'] as any);
    vi.mocked(fs.statSync).mockImplementation((path) => {
      const isDir = String(path).endsWith('subdir');
      return {
        isDirectory: () => isDir,
        isFile: () => !isDir,
        size: 0,
        mtime: new Date(),
      } as any;
    });

    const result = await tool.execute({ path: '/test' });

    // Directories should come before files
    expect(result.indexOf('subdir')).toBeLessThan(result.indexOf('alpha.js'));
    expect(result.indexOf('alpha.js')).toBeLessThan(result.indexOf('zebra.txt'));
  });
});
