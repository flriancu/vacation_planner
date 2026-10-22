/** Offers `text` as a file download (on phones: the share or save sheet). */
export function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  // Some browsers start the download only after the click returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Lets the user pick one file; resolves with its text, or null when nothing was picked. */
export function pickFile(accept: string): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return resolve(null);
      file.text().then(
        (text) => resolve({ name: file.name, text }),
        () => resolve(null),
      );
    });
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}
