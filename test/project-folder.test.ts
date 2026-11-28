import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDoc } from '../src/core';
import { projectFilename, type MaddieProject } from '../src/app/project-file';
import {
  folderPermission, listFolderProjects, openFolderProject, projectFolderPicker, saveFolderProject, type ProjectFolder,
} from '../src/app/project-folder';

const project: MaddieProject = { format: 'maddie', version: 1, name: 'Sketch', doc: createDoc() };

function memoryFolder(initialFiles: Record<string, string> = {}) {
  const files = new Map(Object.entries(initialFiles));
  const abort = vi.fn(async () => {});
  const write = vi.fn(async (_contents: string) => {});
  const folder = {
    async *values() {
      yield { kind: 'directory', name: 'Archive.maddie' };
      for (const name of files.keys()) yield { kind: 'file', name };
    },
    async getFileHandle(name: string, options?: { create: boolean }) {
      if (!files.has(name)) {
        if (!options?.create) throw new DOMException('File not found', 'NotFoundError');
        files.set(name, '');
      }
      return {
        getFile: async () => new Blob([files.get(name)!]),
        createWritable: async () => {
          let pending = '';
          return {
            write: async (contents: string) => { await write(contents); pending = contents; },
            close: async () => { files.set(name, pending); },
            abort,
          };
        },
      };
    },
    queryPermission: vi.fn(async () => 'prompt'),
    requestPermission: vi.fn(async () => 'granted'),
  };
  return { folder: folder as unknown as ProjectFolder, files, write, abort };
}

afterEach(() => vi.unstubAllGlobals());

describe('local project folder', () => {
  it('requests read/write access through the picker or a user-triggered permission request', async () => {
    const { folder } = memoryFolder();
    vi.stubGlobal('window', {});
    expect(projectFolderPicker()).toBeUndefined();
    const picker = vi.fn(async () => folder);
    vi.stubGlobal('window', { showDirectoryPicker: picker });
    expect(await projectFolderPicker()?.()).toBe(folder);
    expect(picker).toHaveBeenCalledWith({ id: 'maddie-projects', mode: 'readwrite' });
    expect(await folderPermission(folder)).toBe('prompt');
    expect(folder.requestPermission).not.toHaveBeenCalled();
    expect(await folderPermission(folder, true)).toBe('granted');
    expect(folder.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
  });

  it('lists only project files and validates a file before opening it', async () => {
    const { folder } = memoryFolder({
      'Take 10.maddie': JSON.stringify(project), 'Take 2.MADDIE': '{}', 'Notes.txt': 'notes',
    });
    expect(await listFolderProjects(folder)).toEqual(['Take 2.MADDIE', 'Take 10.maddie']);
    expect(await openFolderProject(folder, 'Take 10.maddie')).toEqual(project);
    await expect(openFolderProject(folder, 'Take 2.MADDIE')).rejects.toThrow('not a Maddie project');
  });

  it('saves a project and keeps an existing file until replacement is authorized', async () => {
    const { folder, files } = memoryFolder();
    const filename = projectFilename('Sketch / Intro.MADDIE');
    expect(filename).toBe('Sketch - Intro.maddie');
    expect(projectFilename('CON')).toBe('_CON.maddie');
    expect(await saveFolderProject(folder, filename, project)).toBe('saved');
    expect(await openFolderProject(folder, filename)).toEqual(project);
    const changed = { ...project, name: 'New title' };
    expect(await saveFolderProject(folder, filename, changed)).toBe('exists');
    expect(files.get(filename)).toBe(JSON.stringify(project));
    expect(await saveFolderProject(folder, filename, changed, true)).toBe('saved');
    expect(await openFolderProject(folder, filename)).toEqual(changed);
  });

  it('aborts a failed write without changing the previous file', async () => {
    const filename = projectFilename(project.name);
    const { folder, files, write, abort } = memoryFolder({ [filename]: JSON.stringify(project) });
    write.mockRejectedValueOnce(new DOMException('Disk full', 'QuotaExceededError'));
    await expect(saveFolderProject(folder, filename, { ...project, name: 'Edit' }, true)).rejects.toThrow('Disk full');
    expect(abort).toHaveBeenCalledOnce();
    expect(files.get(filename)).toBe(JSON.stringify(project));
  });
});
