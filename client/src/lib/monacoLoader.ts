import loader from '@monaco-editor/loader';

let loaderConfigured = false;

export function ensureLocalMonacoLoader(): void {
  if (loaderConfigured) {
    return;
  }

  loader.config({
    paths: {
      vs: '/monaco/vs',
    },
  });

  loaderConfigured = true;
}
