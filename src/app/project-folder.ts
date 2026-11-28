import { parseProject, type MaddieProject } from './project-file';

const readWrite = { mode: 'readwrite' } as const;
const storeName = 'settings';
const folderKey = 'project-folder';

export interface ProjectFolder extends FileSystemDirectoryHandle {
  queryPermission(options: typeof readWrite): Promise<PermissionState>;
  requestPermission(options: typeof readWrite): Promise<PermissionState>;
  values(): AsyncIterable<FileSystemHandle>;
}

type FolderPicker = (options: typeof readWrite & { id: string }) => Promise<ProjectFolder>;

export function projectFolderPicker() {
  const picker = (window as Window & { showDirectoryPicker?: FolderPicker }).showDirectoryPicker;
  return picker ? () => picker.call(window, { ...readWrite, id: 'maddie-projects' }) : undefined;
}

export function folderPermission(folder: ProjectFolder, request = false) {
  return request ? folder.requestPermission(readWrite) : folder.queryPermission(readWrite);
}

export async function listFolderProjects(folder: ProjectFolder) {
  const names: string[] = [];
  for await (const entry of folder.values()) {
    if (entry.kind === 'file' && /\.maddie$/i.test(entry.name)) names.push(entry.name);
  }
  return names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export async function openFolderProject(folder: ProjectFolder, filename: string) {
  const handle = await folder.getFileHandle(filename);
  const file = await handle.getFile();
  return parseProject(await file.text());
}

export async function saveFolderProject(folder: ProjectFolder, filename: string, project: MaddieProject, replace = false) {
  const contents = JSON.stringify(project);
  if (!replace) {
    try {
      await folder.getFileHandle(filename);
      return 'exists';
    } catch (error) {
      if (!(error instanceof DOMException && error.name === 'NotFoundError')) throw error;
    }
  }

  const handle = await folder.getFileHandle(filename, { create: true });
  const writable = await handle.createWritable();
  try {
    await writable.write(contents);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => {});
    throw error;
  }
  return 'saved';
}

async function folderStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('maddie.project-folders', 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(storeName, mode);
      const request = action(transaction.objectStore(storeName));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export function loadProjectFolder(): Promise<ProjectFolder | undefined> {
  return folderStore('readonly', (store) => store.get(folderKey));
}

export async function rememberProjectFolder(folder: ProjectFolder | null) {
  if (folder) await folderStore('readwrite', (store) => store.put(folder, folderKey));
  else await folderStore('readwrite', (store) => store.delete(folderKey));
}
