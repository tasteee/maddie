type SavePickerT = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ createWritable: () => Promise<{ write: (blob: Blob) => Promise<void>; close: () => Promise<void> }> }>;

export const saveEditorFile = async (blob: Blob, filename: string, description: string, extension: string) => {
  const picker = (window as Window & { showSaveFilePicker?: SavePickerT }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker.call(window, {
        suggestedName: filename,
        types: [{ description, accept: { [blob.type]: [extension] } }],
      });
      const file = await handle.createWritable();
      await file.write(blob);
      await file.close();
      return;
    } catch (error) {
      const wasCancelled = error instanceof DOMException && error.name === 'AbortError';
      if (wasCancelled) return;
      const canDownload = error instanceof DOMException && error.name === 'SecurityError';
      if (!canDownload) throw error;
    }
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
