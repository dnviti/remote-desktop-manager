export function openConnectionWindow(connectionId: string) {
  const width = 1024;
  const height = 768;
  const left = Math.round((window.screen.width - width) / 2);
  const top = Math.round((window.screen.height - height) / 2);

  window.open(
    `/connection/${connectionId}`,
    `arsenale-${connectionId}`,
    `width=${width},height=${height},left=${left},top=${top},menubar=no,toolbar=no,location=no,status=no`
  );
}
